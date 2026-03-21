# inverse-claw-server

The open source server that businesses self-host to expose their real-world services to AI agents via the Inverse Claw protocol.

When an AI agent needs to hire a plumber, book a cleaner, or commission any physical service — this is the server that lets a business be found and contacted.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Quick Start (Docker)](#quick-start-docker)
- [Quick Start (npm)](#quick-start-npm)
- [First Boot](#first-boot)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [services.yaml](#servicesyaml)
- [Deposit Holds](#deposit-holds)
  - [What Is a Deposit Hold?](#what-is-a-deposit-hold)
  - [Setting Up Deposits](#setting-up-deposits)
  - [How Deposits Work (Step by Step)](#how-deposits-work-step-by-step)
  - [Capturing vs Releasing a Deposit](#capturing-vs-releasing-a-deposit)
  - [Services Without Deposits](#services-without-deposits)
- [API Reference](#api-reference)
  - [GET /.well-known/inverseclaw](#get-well-knowninverseclaw)
  - [GET /services](#get-services)
  - [GET /health](#get-health)
  - [POST /tasks](#post-tasks)
  - [GET /tasks/:task_id](#get-taskstask_id)
  - [POST /tasks/:task_id/events](#post-taskstask_idevents)
  - [POST /tasks/:task_id/deposit](#post-taskstask_iddeposit)
  - [POST /tasks/:task_id/deposit/capture](#post-taskstask_iddepositcapture)
  - [POST /tasks/:task_id/deposit/release](#post-taskstask_iddepositrelease)
- [Task Lifecycle](#task-lifecycle)
  - [Without Deposit](#without-deposit)
  - [With Deposit](#with-deposit)
  - [State Machine](#state-machine)
- [Transaction IDs](#transaction-ids)
- [Registering with the Index](#registering-with-the-index)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)
- [FAQ](#faq)
- [Licence](#licence)

---

## How It Works

```
User tells AI agent: "book someone to clean my oven in Manchester"
    |
    v
AI agent searches the Inverse Claw Index for oven cleaners near Manchester
    |
    v
Index returns your business (if registered), with trust signals
    |
    v
Agent checks your /.well-known/inverseclaw manifest
Agent researches your online presence (Checkatrade, Facebook, etc.)
Agent presents findings to the user: "I found CleanRight Ltd — proceed?"
    |
    v
User confirms -> Agent submits a task to your server (POST /tasks)
    |
    v
You receive the request, contact the customer directly, do the work
    |
    v
You push status updates through your server (accepted -> in_progress -> completed)
    |
    v
Customer pays you directly (cash, card, bank transfer — whatever you agree)
```

The protocol handles **discovery and agreement**. Payment happens offline between you and the customer, exactly like a phone booking.

---

## Quick Start (Docker)

The fastest way to get running.

```bash
# 1. Clone the repository
git clone https://github.com/1776M/inverseclaw.git
cd inverseclaw/packages/server

# 2. Edit services.yaml to describe YOUR services (see below)

# 3. Create a .env file with your details
cat > .env << 'EOF'
BUSINESS_NAME=My Business Name
CONTACT_EMAIL=bookings@mybusiness.co.uk
CONTACT_PHONE=+441234567890
PRESENCE_URLS=https://facebook.com/mybusiness,https://mybusiness.co.uk
EOF

# 4. Start the server
docker-compose up -d

# 5. Check it's running
curl http://localhost:3000/health
```

Your services are now discoverable at `http://localhost:3000/.well-known/inverseclaw`.

---

## Quick Start (npm)

If you prefer running directly with Node.js.

**Prerequisites:** Node.js 18+ and npm.

```bash
# 1. Clone and install
git clone https://github.com/1776M/inverseclaw.git
cd inverseclaw/packages/server
npm install

# 2. Set up the database
npx prisma db push

# 3. Edit services.yaml to describe your services

# 4. Set environment variables
export BUSINESS_NAME="My Business Name"
export CONTACT_EMAIL="bookings@mybusiness.co.uk"
export CONTACT_PHONE="+441234567890"
export PRESENCE_URLS="https://facebook.com/mybusiness,https://mybusiness.co.uk"

# 5. Start the server
npx tsx src/index.ts
```

---

## First Boot

On first startup, the server will:

1. Create a `data/` directory
2. Generate a unique **node ID** (6 alphanumeric characters, e.g. `a3f9b2`) — this identifies your business in the protocol
3. Generate a **Business API Key** (e.g. `ic_biz_a1b2c3d4...`) — this is printed to the console

```
=== Inverse Claw Server — First Boot ===
  Node ID:          a3f9b2
  Business API Key: ic_biz_8f2a1c...

  Save your Business API Key — you need it to push task status updates.
  This key is stored locally in data/node.json and is NOT sent to the index.
=========================================
```

**Save your Business API Key.** You need it to accept tasks, update statuses, and manage deposits. It is stored in `data/node.json` on your machine and is never shared with the index or any third party.

The node ID and API key persist across restarts in `data/node.json`. If you lose the file, a new identity will be generated.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BUSINESS_NAME` | **Yes** | — | Your business name, shown to agents and customers |
| `CONTACT_EMAIL` | **Yes** | — | Contact email for customers to reach you |
| `CONTACT_PHONE` | No | — | Contact phone number |
| `PRESENCE_URLS` | No | — | Comma-separated URLs of your public profiles (Facebook, Checkatrade, Google Business, your website). Used for trust verification. |
| `STRIPE_SECRET_KEY` | Conditional | — | Your Stripe secret key. **Required only if any service has `deposit_required: true`**. Not needed otherwise. |
| `INDEX_ENDPOINT` | No | — | Inverse Claw Index URL for auto-registration |
| `INDEX_API_KEY` | No | — | Write API key from index registration |
| `AUTO_PUBLISH` | No | `false` | Set to `true` to auto-register with the index on startup |
| `PORT` | No | `3000` | Server port |
| `DATABASE_URL` | No | `file:inverseclaw.db` | SQLite database path |
| `SERVICES_FILE` | No | `./services.yaml` | Path to your services configuration file |

### services.yaml

This is where you describe what your business offers. Write in plain language — AI agents search over your descriptions to find you, so be descriptive.

```yaml
services:
  - name: Oven Cleaning
    description: >
      Professional domestic oven cleaning including racks, glass, and hob.
      We cover Greater Manchester and surrounding areas (M, SK, OL, WA postcodes).
      Single ovens from £45, doubles from £65, range cookers from £85.
      Usually available within 3 days of booking.
    service_area:
      country: GB
      regions: [M, SK, OL, WA]
    deposit_required: true
    deposit_amount_pence: 1500

  - name: Kitchen Deep Clean
    description: >
      Full kitchen deep clean including appliances, cupboard fronts, floor,
      and surfaces. Takes 3-4 hours. From £120.
      Greater Manchester area.
    service_area:
      country: GB
      regions: [M, SK, OL]
```

#### Service fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | **Yes** | Service name (must be unique across your services) |
| `description` | **Yes** | Free-text description. Include pricing, area, what's included, availability. The more detail the better — agents use this to match user requests. |
| `service_area` | No | Where you operate |
| `service_area.country` | Yes (if service_area) | ISO 3166-1 country code (e.g. `GB`, `US`) |
| `service_area.regions` | No | Array of postcode prefixes or region codes |
| `service_area.cities` | No | Array of city names |
| `service_area.radius_km` | No | Service radius in kilometres |
| `deposit_required` | No | Set to `true` to require a card deposit hold before accepting this service. Default: `false`. |
| `deposit_amount_pence` | Conditional | Amount in pence to hold on the customer's card. **Required if `deposit_required` is `true`.** You decide this amount per service. |

#### Tips for good service descriptions

- **Include pricing** — even rough ranges help agents filter. "From £45" or "£60-£120 depending on size."
- **Mention your area** — "Greater Manchester", "within 10 miles of M1", etc.
- **Describe what's included** — "including racks, glass, and hob" is much better than just "oven cleaning."
- **Mention lead times** — "Usually available within 3 days" or "Same-day emergency callouts."
- **Be specific** — "domestic ovens only, not commercial" helps agents avoid sending wrong requests.

---

## Deposit Holds

### What Is a Deposit Hold?

A deposit hold is a small pre-authorisation on the customer's payment card. It is **not a charge** — no money leaves the customer's account. It is a temporary hold (like a hotel booking hold) that:

- **Deters trolls** — someone sending fake bookings won't put a real card on hold
- **Proves identity** — the card links to a real person via Stripe's identity verification, so disputes can be traced
- **Protects your business** — if the customer no-shows, you can capture the hold amount as compensation

The hold **releases automatically** on normal completion or if you cancel the job. You only capture it in case of a customer no-show.

### Setting Up Deposits

**Step 1: Get a Stripe account**

Sign up at [stripe.com](https://stripe.com) if you don't have one. You need your **secret key** (starts with `sk_live_` for production or `sk_test_` for testing).

**Step 2: Set the environment variable**

```bash
export STRIPE_SECRET_KEY="sk_live_your_key_here"
```

Or in your `.env` file:

```
STRIPE_SECRET_KEY=sk_live_your_key_here
```

Or in `docker-compose.yml`:

```yaml
environment:
  - STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
```

**Step 3: Add deposit fields to your services**

In `services.yaml`, add `deposit_required: true` and `deposit_amount_pence` to any service you want to protect:

```yaml
services:
  - name: Oven Cleaning
    description: Professional domestic oven cleaning...
    deposit_required: true
    deposit_amount_pence: 1500    # £15.00 hold

  - name: Emergency Plumbing
    description: Emergency callout for leaks...
    deposit_required: true
    deposit_amount_pence: 3000    # £30.00 hold

  - name: Garden Maintenance
    description: Weekly garden maintenance...
    # No deposit — open to any agent
```

**You decide the deposit amount for each service.** A small amount (£10-20) is usually enough to deter trolls without putting off genuine customers. Emergency or high-value services might warrant more.

**Step 4: Start the server**

The server will detect that some services require deposits and initialise Stripe automatically:

```
Loaded 3 service(s) from services.yaml
  - Oven Cleaning (deposit: £15.00)
  - Emergency Plumbing (deposit: £30.00)
  - Garden Maintenance
Stripe initialized for deposit holds
```

If you set `deposit_required: true` on any service but forget to set `STRIPE_SECRET_KEY`, the server will fail to start with a clear error message.

### How Deposits Work (Step by Step)

Here's what happens when a customer's AI agent books a deposit-protected service:

```
1. Agent submits a task (POST /tasks)
   ← Server creates a Stripe hold and returns a stripe_client_secret
   ← Task starts in "pending_deposit" status

2. Agent confirms the card hold using the stripe_client_secret
   (This happens on the customer's side via Stripe.js)

3. Agent confirms deposit with server (POST /tasks/:id/deposit)
   ← Task moves to "pending" status
   ← depositStatus is now "held"

4. You see the task — the deposit is confirmed, the customer is real
   You accept it (POST /tasks/:id/events with status: "accepted")

5. You do the work, push status updates as normal
   accepted → in_progress → completed

6. Job done — you release the deposit hold
   (POST /tasks/:id/deposit/release)
   ← The hold disappears from the customer's card
   ← No money was ever charged
```

### Capturing vs Releasing a Deposit

| Situation | What to do | API call |
|-----------|-----------|----------|
| Job completed normally | **Release** — hold disappears, customer is not charged | `POST /tasks/:id/deposit/release` |
| You cancel the job | **Release** — not the customer's fault | `POST /tasks/:id/deposit/release` |
| Customer no-shows | **Capture** — the hold amount is charged to their card | `POST /tasks/:id/deposit/capture` |
| Customer cancels in time | **Release** — your cancellation policy determines what's fair | `POST /tasks/:id/deposit/release` |

Both capture and release require your Business API Key (`Authorization: Bearer <your_key>`).

**Important:** Deposit holds expire after 7 days (Stripe's default for manual capture). If you don't capture or release within 7 days, the hold releases automatically.

### Services Without Deposits

If a service does not have `deposit_required: true` (or the field is absent), it works exactly as it always has:

- Task starts in `pending` status immediately
- No Stripe interaction
- No `stripe_client_secret` in the response
- Full lifecycle: `pending → accepted → in_progress → completed`

You can mix deposit and non-deposit services freely. Each service is independent.

If **none** of your services require deposits, you do not need Stripe at all — don't set `STRIPE_SECRET_KEY` and the server runs without any Stripe dependency.

---

## API Reference

### GET /.well-known/inverseclaw

The discovery endpoint. Any AI agent that knows your domain can hit this URL to discover your services without touching the index.

**Response (200):**

```json
{
  "protocol": "inverseclaw",
  "version": "1.0.0",
  "node_id": "a3f9b2",
  "business_name": "CleanRight Ltd",
  "contact_email": "bookings@cleanright.co.uk",
  "contact_phone": "+441619871234",
  "endpoint": "http://localhost:3000",
  "services": [
    {
      "name": "Oven Cleaning",
      "description": "Professional domestic oven cleaning...",
      "service_area": { "country": "GB", "regions": ["M", "SK", "OL", "WA"] },
      "deposit_required": true,
      "deposit_amount_pence": 1500
    },
    {
      "name": "Kitchen Deep Clean",
      "description": "Full kitchen deep clean...",
      "service_area": { "country": "GB", "regions": ["M", "SK", "OL"] },
      "deposit_required": false,
      "deposit_amount_pence": null
    }
  ],
  "presence_urls": [
    "https://checkatrade.com/trades/cleanright",
    "https://facebook.com/cleanrightltd"
  ]
}
```

### GET /services

Returns your services array. Same data as the manifest but without node metadata.

**Response (200):**

```json
[
  {
    "name": "Oven Cleaning",
    "description": "Professional domestic oven cleaning...",
    "service_area": { "country": "GB", "regions": ["M", "SK", "OL", "WA"] },
    "deposit_required": true,
    "deposit_amount_pence": 1500
  },
  {
    "name": "Kitchen Deep Clean",
    "description": "Full kitchen deep clean...",
    "service_area": { "country": "GB", "regions": ["M", "SK", "OL"] },
    "deposit_required": false,
    "deposit_amount_pence": null
  }
]
```

### GET /health

Health check endpoint. Useful for monitoring and load balancers.

**Response (200):**

```json
{
  "node_id": "a3f9b2",
  "version": "1.0.0",
  "uptime_seconds": 3600
}
```

### POST /tasks

Agent submits a service request on behalf of a customer. The business then contacts the customer directly to arrange details.

**Request body:**

| Field | Required | Description |
|-------|----------|-------------|
| `service_name` | **Yes** | Name of the service (case-insensitive match) |
| `details` | **Yes** | Free-text description of what the customer needs |
| `contact.name` | **Yes** | Customer's name |
| `contact.phone` | No | Customer's phone number |
| `contact.email` | No | Customer's email (must be valid format if provided) |

**Example request:**

```json
{
  "service_name": "Oven Cleaning",
  "details": "Double oven, postcode M1 2AB, prefer next week. Dog in the house (friendly).",
  "contact": {
    "name": "Jane Smith",
    "phone": "07700900123",
    "email": "jane@email.com"
  }
}
```

**Response — service WITHOUT deposit (201):**

```json
{
  "task_id": "tsk_za3e7j6u97am",
  "transaction_id": "ic_a3f9b2_20260320T143022_k7x9m",
  "status": "pending"
}
```

**Response — service WITH deposit (201):**

```json
{
  "task_id": "tsk_za3e7j6u97am",
  "transaction_id": "ic_a3f9b2_20260320T143022_k7x9m",
  "status": "pending_deposit",
  "stripe_client_secret": "pi_3abc123_secret_xyz",
  "deposit_amount_pence": 1500
}
```

The `stripe_client_secret` is used by the agent/customer to confirm the card hold on their side via Stripe.js. Once confirmed, the agent calls `POST /tasks/:task_id/deposit` to transition the task to `pending`.

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Missing or invalid fields |
| 404 | `SERVICE_NOT_FOUND` | Service name doesn't match any in services.yaml |

### GET /tasks/:task_id

Returns full task details including contact information, current status, deposit information, and the complete event history.

**Response (200):**

```json
{
  "task_id": "tsk_za3e7j6u97am",
  "transaction_id": "ic_a3f9b2_20260320T143022_k7x9m",
  "service_name": "Oven Cleaning",
  "details": "Double oven, postcode M1 2AB, prefer next week.",
  "contact": {
    "name": "Jane Smith",
    "phone": "07700900123",
    "email": "jane@email.com"
  },
  "status": "accepted",
  "deposit_required": true,
  "deposit_amount_pence": 1500,
  "deposit_status": "held",
  "created_at": "2026-03-20T14:30:22.000Z",
  "updated_at": "2026-03-20T15:10:00.000Z",
  "events": [
    { "status": "pending_deposit", "message": "Task submitted — deposit hold of £15.00 required", "created_at": "2026-03-20T14:30:22.000Z" },
    { "status": "pending", "message": "Deposit confirmed — task is now pending", "created_at": "2026-03-20T14:31:05.000Z" },
    { "status": "accepted", "message": "Booked for Tuesday 25th March, 10am. £65.", "created_at": "2026-03-20T15:10:00.000Z" }
  ]
}
```

For tasks without deposits, `deposit_required` will be `false` and `deposit_amount_pence` and `deposit_status` will be `null`.

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 404 | `TASK_NOT_FOUND` | No task with that ID exists |

### POST /tasks/:task_id/events

Push a status update on a task. This is how you accept jobs, mark them in progress, and mark them complete.

**Authentication:** Required. Include your Business API Key:

```
Authorization: Bearer ic_biz_your_key_here
```

**Request body:**

| Field | Required | Description |
|-------|----------|-------------|
| `status` | **Yes** | New status: `accepted`, `in_progress`, `completed`, `declined`, or `cancelled` |
| `message` | No | Free-text message visible to the agent/customer |

**Example — accepting a job:**

```json
{
  "status": "accepted",
  "message": "Booked for Tuesday 25th March, 10am. Double oven = £65."
}
```

**Example — declining a job:**

```json
{
  "status": "declined",
  "message": "Sorry, fully booked this week. Try next week?"
}
```

**Response (200):**

```json
{ "updated": true }
```

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 400 | `VALIDATION_ERROR` | Invalid status value |
| 404 | `TASK_NOT_FOUND` | No task with that ID |
| 409 | `INVALID_TRANSITION` | Status change not allowed (e.g. `pending` directly to `completed`) |

### POST /tasks/:task_id/deposit

Agent confirms that the customer's card hold was successful. Transitions the task from `pending_deposit` to `pending`.

**Authentication:** None required (the agent calls this).

**Request body:**

| Field | Required | Description |
|-------|----------|-------------|
| `payment_intent_id` | **Yes** | The Stripe PaymentIntent ID (must match the one created when the task was submitted) |

**Example:**

```json
{
  "payment_intent_id": "pi_3abc123"
}
```

**Response (200):**

```json
{ "updated": true, "status": "pending" }
```

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | Missing payment_intent_id |
| 400 | `INVALID_PAYMENT_INTENT` | payment_intent_id doesn't match the task |
| 404 | `TASK_NOT_FOUND` | No task with that ID |
| 409 | `INVALID_STATE` | Task is not in `pending_deposit` state |

### POST /tasks/:task_id/deposit/capture

Capture the deposit hold — charges the held amount to the customer's card. Use this when a customer no-shows.

**Authentication:** Required. Include your Business API Key.

**No request body needed.**

**Response (200):**

```json
{ "captured": true }
```

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 400 | `NO_DEPOSIT` | Task doesn't have a deposit |
| 404 | `TASK_NOT_FOUND` | No task with that ID |
| 409 | `INVALID_DEPOSIT_STATE` | Deposit is not in `held` state (already captured or released) |

### POST /tasks/:task_id/deposit/release

Release the deposit hold — the hold disappears from the customer's card with no charge. Use this on normal completion, cancellation by you, or if the customer cancels fairly.

**Authentication:** Required. Include your Business API Key.

**No request body needed.**

**Response (200):**

```json
{ "released": true }
```

**Error responses:**

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 400 | `NO_DEPOSIT` | Task doesn't have a deposit |
| 404 | `TASK_NOT_FOUND` | No task with that ID |
| 409 | `INVALID_DEPOSIT_STATE` | Deposit is not in `held` state (already captured or released) |

---

## Task Lifecycle

### Without Deposit

```
pending ──> accepted ──> in_progress ──> completed
  │            │              │
  ├──> declined│              │
  └──> cancelled              └──> cancelled
               └──> cancelled
```

### With Deposit

```
pending_deposit ──> pending ──> accepted ──> in_progress ──> completed
(card hold          (deposit      │              │
 created)            confirmed)   ├──> declined  │
                       │          └──> cancelled  └──> cancelled
                       ├──> declined
                       └──> cancelled
```

### State Machine

Every status transition must follow valid paths. The server enforces this — invalid transitions return `409 INVALID_TRANSITION`.

| From | Allowed Next States |
|------|-------------------|
| `pending_deposit` | `pending` (via deposit confirmation only) |
| `pending` | `accepted`, `declined`, `cancelled` |
| `accepted` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `completed` | (terminal — no further transitions) |
| `declined` | (terminal — no further transitions) |
| `cancelled` | (terminal — no further transitions) |

You **cannot skip states**. For example, you cannot go directly from `pending` to `completed` — you must go through `accepted` and `in_progress` first.

---

## Transaction IDs

Every task gets a unique transaction ID that encodes the business node and timestamp:

```
ic_a3f9b2_20260320T143022_k7x9m
│   │       │                │
│   │       │                └── 5 random alphanumeric chars
│   │       └──────────────────── timestamp (UTC, ISO 8601)
│   └──────────────────────────── node_id (identifies your business)
└──────────────────────────────── protocol prefix
```

This ID is given to the customer. If there's a dispute:
1. The customer quotes the transaction ID
2. The node_id identifies which business handled the job
3. The timestamp shows when it was created
4. No central database lookup needed

---

## Registering with the Index

To be discoverable by agents searching the Inverse Claw Index (so agents can find you when users say "find me a plumber in Manchester"), you need to register.

**Option 1: Auto-registration**

Set these environment variables and the server registers itself on startup:

```bash
AUTO_PUBLISH=true
INDEX_ENDPOINT=https://index.inverseclaw.io
```

**Option 2: Manual registration**

Register via the index API directly.

**Verification requirement:** Your node ID must appear on at least one of your `PRESENCE_URLS` for verification to succeed. For example, if your Facebook page is listed as a presence URL, your node ID (e.g. `a3f9b2`) should appear somewhere on that page.

**Direct discovery:** Even without index registration, any agent that knows your domain can discover your services at `https://yourdomain.com/.well-known/inverseclaw`. Index registration is for agents that don't know your domain yet.

---

## Development

```bash
npm run dev          # Start with hot reload (watches for file changes)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled version (production)
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:push      # Push schema to database (development)
npm run db:migrate   # Run pending migrations (production)
```

### Project structure

```
packages/server/
  src/
    index.ts           # Entrypoint — loads config, starts Fastify
    config.ts          # Config loading from env vars + data/node.json
    services.ts        # Service YAML loading and validation
    schemas.ts         # Zod schemas + state machine
    routes.ts          # API route handlers (non-deposit)
    depositRoutes.ts   # API route handlers (deposit-aware)
    stripe.ts          # Stripe SDK wrapper for deposit holds
    transaction.ts     # Transaction and task ID generation
  prisma/
    schema.prisma      # Database schema (SQLite)
  tests/
    api.test.ts        # Core API tests
    schemas.test.ts    # Schema validation tests
    services.test.ts   # Service loader tests
    transaction.test.ts # ID generation tests
    walkthrough.test.ts # Full protocol walkthrough (agent + business)
    deposit.test.ts    # Deposit hold API tests
    deposit-schemas.test.ts  # Deposit schema tests
    deposit-services.test.ts # Deposit service config tests
  services.yaml        # Example service configuration
  docker-compose.yml   # Docker deployment config
  data/                # Generated on first boot (node.json, database)
```

---

## Testing

The server has comprehensive test coverage. All tests use Fastify's in-memory `.inject()` API — no server process, no ports, no network.

```bash
npm run test         # Run all tests once
npm run test:watch   # Run tests in watch mode (re-runs on file changes)
```

**Test suites:**

| Suite | Tests | What it covers |
|-------|-------|---------------|
| `api.test.ts` | 16 | Core API: health, services, discovery, task CRUD, auth, state machine |
| `schemas.test.ts` | 23 | Zod schema validation for all request/response types |
| `services.test.ts` | 7 | YAML service loading, validation, error messages |
| `transaction.test.ts` | 8 | Transaction ID and task ID format, uniqueness |
| `walkthrough.test.ts` | 17 | Full protocol walkthrough: discover, submit, accept, complete |
| `deposit.test.ts` | 26 | Deposit holds: lifecycle, capture, release, auth, edge cases |
| `deposit-schemas.test.ts` | 13 | Deposit state machine, ConfirmDepositBody validation |
| `deposit-services.test.ts` | 9 | Extended service schema with deposit fields |

**Total: 123 tests**

Deposit tests use a mocked Stripe client — no real Stripe API calls are made during testing.

---

## Deployment

### Docker (recommended)

```bash
docker-compose up -d
```

The included `docker-compose.yml` mounts:
- `./data` — persistent storage (node identity + database)
- `./services.yaml` — your service configuration (read-only mount)

All environment variables can be set in a `.env` file or in the `docker-compose.yml` `environment` section.

### Manual deployment

Build and run:

```bash
npm run build
export DATABASE_URL="file:./data/inverseclaw.db"
export BUSINESS_NAME="My Business"
export CONTACT_EMAIL="hello@mybusiness.co.uk"
# ... other env vars
node dist/index.js
```

### Reverse proxy

In production, put the server behind a reverse proxy (nginx, Caddy, Cloudflare Tunnel) with HTTPS. The `/.well-known/inverseclaw` endpoint must be accessible on your public domain for agents to discover you:

```
https://yourdomain.com/.well-known/inverseclaw
```

---

## FAQ

**Do I need Stripe?**
Only if you want deposit holds on any of your services. If none of your services have `deposit_required: true`, Stripe is not needed and the server runs without it.

**What happens to the deposit if I don't capture or release it?**
Stripe automatically releases uncaptured holds after 7 days.

**Can I set different deposit amounts for different services?**
Yes. Each service has its own `deposit_amount_pence` value. Set it per service in `services.yaml`.

**Does the deposit replace payment for the service?**
No. The deposit is a small hold to prove the customer is real. Actual payment for the service happens directly between you and the customer — cash, card, bank transfer, invoice, whatever you normally use.

**What currency are deposits in?**
Currently GBP only (amounts are in pence). Multi-currency support is planned.

**Can agents submit tasks without the index?**
Yes. If an agent knows your domain, it can hit `/.well-known/inverseclaw` to discover your services and submit tasks directly. The index is for agents that don't know which businesses exist.

**What if I lose my Business API Key?**
It's stored in `data/node.json`. If you lose that file entirely, a new identity (node ID + API key) will be generated on next boot.

**Is my data sent anywhere?**
No. All data stays on your server in a local SQLite database. The only external call is to Stripe (if you use deposits) and optionally to the index (if you enable auto-publish).

---

## Licence

MIT — use it however you want.
