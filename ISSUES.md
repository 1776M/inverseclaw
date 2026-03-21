# Inverse Claw — Known Issues & Technical Debt

Identified 2026-03-21. Work through these before any public launch.

---

## Critical — Could lose money or get you sued

### #1 Stripe confirmDeposit does not verify with Stripe API
- **File:** `packages/server/src/providers/stripe.ts`
- **Problem:** `confirmDeposit()` just checks the agent echoed back the same `payment_intent_id`. It never calls the Stripe API to verify the PaymentIntent status is actually `requires_capture` (i.e. the card hold succeeded). Any agent can bypass the deposit by echoing the ID back without the customer's card ever being authorized.
- **Fix:** Call `stripe.paymentIntents.retrieve(depositId)` and check `status === 'requires_capture'`.
- **Effort:** Small
- **Status:** Fixed

### #2 USDC tx_hash replay + no amount check
- **File:** `packages/server/src/providers/usdc.ts`
- **Problem:** (a) The same transaction hash can be reused to "confirm" unlimited tasks — no deduplication. (b) The amount check is `value > 0n` — a 0.000001 USDC transfer satisfies a £15 deposit. (c) Old transactions to the same wallet work — no recency check.
- **Fix:** (a) Store used tx hashes in the database and reject duplicates. (b) Check `value >= expectedAmount`. (c) Optionally check block timestamp is within a reasonable window.
- **Effort:** Medium
- **Status:** Fixed

### #3 USDC "release" is a no-op — not a real deposit hold
- **File:** `packages/server/src/providers/usdc.ts`
- **Problem:** USDC deposits are direct transfers to the business wallet. The `release()` method does nothing. The documentation says "the hold releases automatically" but for USDC, funds go directly to the business. Refund depends entirely on the business's good will. This is misleading and could be a consumer protection issue.
- **Fix:** Either (a) build an escrow smart contract on Base that holds funds until release/capture, or (b) be honest in the docs that USDC deposits are non-refundable booking fees, not holds. Option (b) is pragmatic for v1.
- **Effort:** Large (escrow contract) or Small (honest docs)
- **Status:** Fixed — escrow contract + provider escrow mode implemented

---

## High — Will break or cause real problems

### #4 `.well-known/inverseclaw` hardcodes localhost
- **Files:** `packages/server/src/routes.ts` (line 54), `packages/server/src/depositRoutes.ts` (line 74)
- **Problem:** The `endpoint` field in the discovery manifest returns `http://localhost:3000`. Useless for any real deployment — agents reading this from a remote domain get a URL that points to nothing.
- **Fix:** Add a `PUBLIC_URL` environment variable. Fall back to `http://localhost:${port}` only if not set.
- **Effort:** Trivial
- **Status:** Fixed

### #5 No deposit timeout / business cannot cancel pending_deposit
- **Files:** `packages/server/src/schemas.ts`, `packages/server/src/depositRoutes.ts`
- **Problem:** Tasks in `pending_deposit` sit there forever. The state machine only allows `pending_deposit → pending`. The business cannot decline or cancel a task stuck in `pending_deposit`. Stripe PaymentIntents pile up on the business's account with no cleanup.
- **Fix:** (a) Add `pending_deposit → cancelled` to the state machine. (b) Add a configurable timeout (e.g. 30 minutes) after which `pending_deposit` tasks auto-cancel. (c) On cancellation, void any Stripe PaymentIntent.
- **Effort:** Small-Medium
- **Status:** Fixed (state machine + cleanup). Timeout/auto-cancel is a future enhancement.

### #6 No auto-release of deposit on task completion
- **File:** `packages/server/src/depositRoutes.ts`
- **Problem:** The documentation says deposits release on normal completion, but the code doesn't do it. When a business pushes a task to `completed`, there is no automatic call to `provider.release()`. The business must separately call `POST /tasks/:id/deposit/release`. If they forget, Stripe holds stay for 7 days. For USDC, the funds are never returned.
- **Fix:** In the `POST /tasks/:task_id/events` handler, when the new status is `completed` or `cancelled` (by business), auto-call `provider.release()` and set `depositStatus = 'released'`.
- **Effort:** Small
- **Status:** Fixed

### #7 No rate limiting on any endpoint
- **Files:** All route handlers
- **Problem:** Zero rate limiting. `POST /tasks` accepts unlimited submissions from any IP. An attacker can flood the server with fake tasks, and for deposit services, create unlimited Stripe PaymentIntents on the business's account.
- **Fix:** Add `@fastify/rate-limit` plugin. Sensible defaults: 100 req/hour for search/read, 10 req/hour for task submission per IP.
- **Effort:** Small
- **Status:** Fixed

### #8 GDPR non-compliance
- **Files:** `packages/server/prisma/schema.prisma`, route handlers
- **Problem:** Tasks store PII (names, phones, emails, free-text details with addresses) with no data retention policy, no deletion endpoint, no DSAR mechanism, no privacy notice, no encryption at rest.
- **Fix:** (a) Add `DELETE /tasks/:task_id` endpoint (requires business API key). (b) Add configurable retention TTL with auto-purge. (c) Document data handling in the README.
- **Effort:** Medium
- **Status:** Fixed — DELETE endpoint added + Data Protection section in README. Business is data controller, not us.

### #9 No notification system — tasks arrive silently
- **Problem:** When a task is submitted, the business has no way to know. No email, no webhook, no SMS, no dashboard. A plumber has to poll their own API to see if someone booked them.
- **Fix:** Add optional webhook support (simplest): business sets `WEBHOOK_URL` env var, server POSTs task events to it. Email notification can be added later.
- **Effort:** Medium
- **Status:** Fixed

---

## Medium — Should fix before production

### #10 Race conditions in state transitions
- **File:** `packages/server/src/depositRoutes.ts`, `packages/server/src/routes.ts`
- **Problem:** State transitions use read-then-write without locking. Two concurrent requests could both read the same status, both pass validation, and both write — last write wins. Masked by SQLite's single-writer lock, but architecturally unsound and would break on PostgreSQL.
- **Fix:** Use `UPDATE ... WHERE status = :expected_status` pattern (optimistic locking) instead of separate read + write.
- **Effort:** Small
- **Status:** Fixed

### #11 "Mandatory research" is unenforceable
- **Files:** `ARCHITECTURE.md`, `THINKING.md`
- **Problem:** The docs say provider research before booking is "mandatory" and "enforced at the MCP level." But any HTTP client can call `POST /tasks` directly. Third-party MCP implementations can skip research. There is no protocol-level enforcement. Calling it "mandatory" is inaccurate and undermines the legal defense.
- **Fix:** Change documentation language from "mandatory/enforced" to "required by protocol convention." Consider adding an optional `research_token` field to `POST /tasks` that the server can check (issued by the MCP after research is completed).
- **Effort:** Small (docs) to Medium (research token)
- **Status:** Fixed — server-enforced. POST /tasks requires a `research` object (urls_checked + summary) when researchRequired is true (default). Manifest includes research_required flag.

### #12 SQLite will not survive real load
- **File:** `packages/server/prisma/schema.prisma`
- **Problem:** SQLite is single-writer, no connection pooling, no indexes beyond unique constraints. Fine for MVP, will break under concurrent load or when businesses have hundreds of tasks.
- **Fix:** (a) Add indexes on `status`, `serviceName`, `createdAt`. (b) Document PostgreSQL as the production recommendation. (c) The Prisma schema already supports swapping the datasource.
- **Effort:** Small (indexes) to Medium (PostgreSQL docs/testing)
- **Status:** Fixed (indexes added)

### #13 GBP-to-USD rate is fixed at startup
- **File:** `packages/server/src/providers/usdc.ts`
- **Problem:** The USDC provider uses a fixed GBP/USD rate set at server startup. It never updates. GBP/USD can move 2-5% in a week. Customers will systematically overpay or underpay.
- **Fix:** (a) Short term: document the limitation clearly. (b) Long term: fetch rate from a price API on each deposit creation, with a cached fallback.
- **Effort:** Small (docs) to Medium (live rate)
- **Status:** Fixed — eliminated the problem entirely. All deposits are now in USD. No currency conversion needed.

### #14 No HTTPS enforcement
- **Problem:** Server listens on HTTP. API keys and PII transmitted in cleartext. The README mentions reverse proxy but doesn't enforce or warn.
- **Fix:** (a) Add prominent warning in README that production MUST use HTTPS. (b) Optionally add `FORCE_HTTPS` env var that rejects non-TLS connections. (c) Document nginx/Caddy reverse proxy setup.
- **Effort:** Small
- **Status:** Closed — addressed in production checklist and deployment docs. Standard pattern: reverse proxy handles TLS.

### #15 No max length on text fields
- **Files:** `packages/server/src/schemas.ts`
- **Problem:** `details` and `message` fields accept arbitrary length strings. Someone could send megabytes of data per request, filling the database and causing DoS.
- **Fix:** Add `.max(5000)` (or similar) to `details` and `message` in the Zod schemas.
- **Effort:** Trivial
- **Status:** Fixed

### #16 Presence URLs as trust signals are gameable
- **Problem:** A scammer can create a Facebook page, a cheap website, and a Checkatrade listing in hours. The system checks that the node_id appears on the URL but creating fake presence is trivial. Domain age is useful but can be obtained with expired domains.
- **Fix:** (a) Document the limitation honestly. (b) The index (not yet built) should implement deeper reputation checks. (c) Consider requiring minimum domain age or multiple independent platforms.
- **Effort:** N/A (index not built yet)
- **Status:** Closed — design consideration for the index. Server-side research requirement mitigates this for now.

### #17 Stripe PaymentIntent expiry edge case
- **Problem:** Stripe PaymentIntents with `capture_method: manual` must be captured within 7 days. If a task takes longer than 7 days from deposit to no-show capture, the PaymentIntent expires and cannot be captured.
- **Fix:** Document the 7-day window. Consider re-creating the PaymentIntent if the task is still active after 5 days.
- **Effort:** Small (docs) to Medium (auto-renewal)
- **Status:** Closed — documented in README deposit section. 7-day window is a Stripe platform constraint, not a bug.

### #18 No CORS configuration
- **Problem:** No CORS headers. Browser-based agents or future dashboards will be blocked. If CORS is opened wide, any webpage can submit tasks.
- **Fix:** Add `@fastify/cors` with configurable allowed origins.
- **Effort:** Small
- **Status:** Fixed

### #19 Business API key stored in plain text / timing-vulnerable comparison
- **File:** `packages/server/src/config.ts`, route handlers
- **Problem:** API key stored in `data/node.json` unencrypted. Comparison uses `===` which is theoretically vulnerable to timing attacks.
- **Fix:** (a) Use `crypto.timingSafeEqual` for key comparison. (b) Consider hashing the stored key (though this complicates first-boot display).
- **Effort:** Small
- **Status:** Fixed (timingSafeEqual)

### #20 No chain reorg protection for USDC
- **File:** `packages/server/src/providers/usdc.ts`
- **Problem:** `confirmDeposit` checks the transaction receipt immediately with no minimum block confirmations. On Ethereum mainnet, a 1-confirmation tx can be reorganized. Less of an issue on L2s but still a theoretical risk.
- **Fix:** Wait for N confirmations before confirming. For Base L2: 1-2 blocks is fine. For Ethereum mainnet: wait for 12+ confirmations.
- **Effort:** Small
- **Status:** Fixed

---

## Business / Adoption Risks (not code fixes)

### #21 Cold start problem
- Needs simultaneous business supply, agent adoption, user demand, and index coverage. The onboarding fee model generates supply but not demand.

### #22 Setup too complex for target users
- A plumber is unlikely to edit YAML files and run Docker. The onboarding service mitigates this but limits organic adoption.

### #23 No business dashboard or UI
- All business operations require direct API calls with Bearer tokens. Unusable without a frontend.

### #24 Competitive threats
- If Google extends UCP to cover services, or if existing marketplaces add agent APIs, the protocol could be bypassed entirely.

---

## Resolution Log

| Issue | Date Fixed | Commit | Notes |
|-------|-----------|--------|-------|
| #1 Stripe confirmDeposit | 2026-03-21 | da78c6c | Now calls stripe.paymentIntents.retrieve() and checks status === 'requires_capture' |
| #2 USDC tx replay + amount | 2026-03-21 | f4696f9 | Added tx hash dedup (in-memory Set), amount check (>= 90% of expected), expected amount tracking per deposit |
| #3 USDC release no-op | 2026-03-21 | 805eb0c | InverseClawEscrow contract + escrow mode in EvmUsdcProvider. Capture/release are real on-chain txs. Direct transfer mode kept as fallback with warning. |
| #4 .well-known localhost | 2026-03-21 | 8e16c39 | Added PUBLIC_URL env var to AppConfig. Both routes.ts and depositRoutes.ts use it with localhost fallback. |
| #5 pending_deposit cancel | 2026-03-21 | f51ffb4 | Added pending_deposit → cancelled transition. Cancelling voids provider deposits (best effort). 3 new tests. |
| #6 Auto-release on complete | 2026-03-21 | c1c9c96 | Deposits auto-release when task reaches completed or cancelled (after confirmation). Manual release returns 409 if already released. |
| #7 Rate limiting | 2026-03-21 | 0ef3202 | @fastify/rate-limit: 100 req/min global, 10 req/min on POST /tasks per IP. |
| #8 GDPR compliance | 2026-03-21 | 5c362a7 | DELETE /tasks/:id endpoint + Data Protection section in README. Business is data controller. |
| #9 No notifications | 2026-03-21 | 5d18d0e | Webhook system: WEBHOOK_URL env var, fire-and-forget POST on task.created/task.updated/deposit.confirmed. |
| #10 Race conditions | 2026-03-21 | fd51a9c | Optimistic locking via updateMany WHERE status = expected. Returns 409 CONCURRENT_MODIFICATION on conflict. |
| #11 Research unenforceable | 2026-03-21 | d70fd12 | Server-enforced: POST /tasks always requires research object. No config opt-out. 5 tests. |
| #12 SQLite indexes | 2026-03-21 | (see commit) | Added indexes on status, serviceName, createdAt. |
| #15 Max length fields | 2026-03-21 | (see commit) | Added .max() to all text fields in Zod schemas. |
| #18 CORS | 2026-03-21 | (see commit) | @fastify/cors with CORS_ORIGIN env var (default: all origins). |
| #19 Timing-safe key | 2026-03-21 | (see commit) | crypto.timingSafeEqual for all API key comparisons. |
| #13 Fixed GBP/USD rate | 2026-03-21 | f0d0838 | Eliminated — all deposits now in USD cents. No conversion needed. |
| #14 HTTPS enforcement | 2026-03-21 | — | Closed — addressed in production checklist docs. Reverse proxy handles TLS. |
| #20 Chain reorg protection | 2026-03-21 | 287ccfa | waitForTransactionReceipt with confirmations: 12 (L1) or 2 (L2). 2min timeout. |
| #16 Gameable presence URLs | 2026-03-21 | — | Closed — index concern. Server research requirement mitigates for now. |
| #17 Stripe 7-day expiry | 2026-03-21 | — | Closed — documented in README. Platform constraint, not a bug. |
