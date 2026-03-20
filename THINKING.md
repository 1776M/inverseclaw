# Inverse Claw — Origin and Evolution of the Concept

This document captures how the idea developed. It exists so anyone working on
the project understands not just what was built but why decisions were made.

---

## The Problem We Started With

The starting point was a simple observation: AI agents like OpenClaw can decide
what needs to be done, but they can't actually do most real-world things. They
can book a digital service, call an API, send an email. But they can't clean
your oven, fix your boiler, or wash your car.

OpenClaw (formerly Clawdbot/Moltbot) became in early 2026 the fastest-growing
open source project in history — 250,000+ GitHub stars, Jensen Huang calling it
"the operating system for personal AI." It can execute tasks. But only digital
ones. The gap between "agent decides to do X" and "X gets done in the physical
world" is entirely unaddressed.

Inverse Claw is the bridge.

---

## Google's UCP and Where Inverse Claw Fits

In January 2026, Google launched the Universal Commerce Protocol (UCP) — an
open standard for agentic commerce, co-developed with Shopify, Stripe, Walmart,
Target, Mastercard, Visa, and 20+ other partners.

UCP solves agent-driven commerce for **online retail**: product discovery, cart
management, checkout, order tracking. It uses a `/.well-known/ucp` manifest on
merchant domains so agents can auto-discover what a business sells and how to
buy it.

**UCP does not cover real-world services.** A plumber doesn't have a checkout
flow. An oven cleaner doesn't have a SKU. There is no "add to cart" for someone
coming to your house.

This is exactly the gap Inverse Claw fills:

| | UCP | Inverse Claw |
|---|---|---|
| **What** | Buy products online | Hire someone for a physical task |
| **Businesses** | Retailers (Walmart, Shopify stores) | Service businesses (plumbers, cleaners) |
| **Payment** | In-protocol (AP2, tokenised) | Offline (cash, bank transfer, invoice) |
| **Discovery** | `/.well-known/ucp` on domain | `/.well-known/inverseclaw` on domain + central index |
| **Task model** | Cart → Checkout → Order → Delivery | Request → Accept → In progress → Complete |

UCP validates the thesis that agents need standardised protocols to transact
with businesses. Inverse Claw extends that thesis to the physical world.

We adopt UCP's `/.well-known/` convention for domain-level discovery. A business
running inverse-claw-server automatically serves a manifest at
`/.well-known/inverseclaw` that any agent can read directly.

---

## What We Rejected and Why

### Rejected: TaskRabbit / marketplace clone

The obvious first instinct was a marketplace — list businesses, users find them,
rate them, pay through the platform. We rejected this because:

- Enormous operational burden (supply acquisition, quality control, disputes)
- Payment intermediation = financial regulation exposure
- Employment law risk if worker classification goes wrong
- Competing with established players on their own terms
- None of this is agent-native — it's just a website

### Rejected: Hardcoded task lists

The next idea was a skill that hardcodes specific tasks to specific providers —
"clean oven → call these APIs." Rejected because:

- Every new provider requires a code change
- The operator (us) becomes the bottleneck for all growth
- No way to scale without becoming an ops business
- Fundamentally not a protocol, just a directory disguised as one

### Rejected: Pure peer-to-peer

We considered letting users and businesses transact directly with no central
component. Rejected because:

- Discovery problem — how does an agent find providers?
- Cold start problem — no supply, no demand, no way to bootstrap
- Trust problem — no signals for agents to evaluate providers
- The index is precisely what has monetisable value

Note: The `/.well-known/inverseclaw` discovery mechanism partially addresses
the pure P2P case — an agent that already knows a business's domain can discover
services directly. But the index is still needed for search ("find me a plumber
in Manchester") where the agent doesn't know which domains to check.

### Rejected: Peer-to-peer with individual task doers

We explored individual workers rather than businesses. Rejected because:

- UK employment law worker classification risk
- Much harder to establish web presence / trust signals
- Lower transaction values
- Businesses already have ops systems, insurance, and accountability

### Rejected: Structured capability schemas

Early design used rigid capability definitions with typed input/output schemas,
payment rails, SLA fields, and versioned capability_ids (e.g. `domestic_oven_clean_v1`).
Rejected because:

- Businesses would need to learn a schema language to describe their services
- Capability taxonomy would fragment immediately (every plumber names things differently)
- Over-engineers what is fundamentally a description + contact details problem
- Free-text descriptions that agents search over semantically is simpler and more flexible

### Rejected: Payment in the protocol

Early design integrated Stripe x402 and USDC on Base directly into the task
lifecycle. Rejected because:

- You don't pay a plumber before they arrive — payment happens after agreement
- Adds enormous complexity (Stripe config, webhook handling, payment states)
- Makes "installation" a £2-5k consulting job instead of a 20-minute setup
- Payment can be layered on later (escrow, invoicing) once the core works
- The protocol's job is discovery and agreement, not money movement

---

## The Key Insight: Protocol + Index

The clean structure emerged from separating two things that had been conflated:

**The protocol** (open source, businesses self-host) handles:
- What a business can do (free-text service descriptions)
- How to request it (task submission with contact details)
- How to track it (status updates from business)

**The index** (proprietary, we host) handles:
- Discovery — which businesses offer what, where
- Trust signals — is this business real?
- The monetisable asset

This mirrors how the web works. HTTP is the open protocol. Google is the
proprietary index. Nobody owns HTTP. Google is worth $2 trillion.

UCP follows the same structural logic — open protocol, with Google's commerce
infrastructure as the discovery layer. We're doing the same for services.

---

## Two Discovery Paths

Following UCP's lead, Inverse Claw supports two discovery mechanisms:

**1. Central index (primary)**
Agent searches the index: "find me an oven cleaner in Manchester."
Index returns matching nodes with service descriptions, presence URLs,
and reputation signals. This is how most discovery will happen.

**2. Direct domain discovery (secondary)**
If an agent already knows a business's domain (e.g. from a Google search,
a recommendation, or a previous interaction), it can hit
`cleanright.co.uk/.well-known/inverseclaw` and get the service manifest
directly. No index needed.

The `/.well-known/inverseclaw` endpoint is served automatically by
inverse-claw-server. It returns the same data as `/services` but at a
standardised URL that any agent can check on any domain.

---

## The Trust Problem and How We Solved It

Initial thinking: we verify businesses before listing them. Check Companies House,
check insurance, do some kind of vetting.

Problem: this makes us responsible for verification quality. If we say "verified"
and a business turns out to be a scam, we own that. It also creates enormous
operational overhead that doesn't scale.

The elegant solution came from thinking about how humans actually evaluate businesses
before hiring them. You Google them. You check Checkatrade. You look at their Facebook
page. You see how long they've been operating.

So instead of us verifying businesses, we require businesses to prove they exist
somewhere on the public web and include their node ID there. Then we let the agent
(and ultimately the user) do what humans do — search the web and make their own
judgement.

The specific mechanism:
- Registration requires at least one public URL (Facebook, Checkatrade, website, etc.)
- We verify node_id appears on that URL (automated)
- Background job runs weekly web reputation checks per node
- Trust signals surfaced in search results
- Agent presents these to user before committing
- User decides

This means:
- Sole traders with thin web presence can still register (via social media)
- Scammers face a near-impossible task (fake credible web presence across
  multiple independent platforms over years)
- We carry no verification liability (we're a directory, not an endorser)
- The system self-cleans as web reputation updates

The latency objection to web searches is irrelevant — a plumber takes days to
arrive. A few seconds of web search is nothing.

---

## The Payment Decision

We expected to have to build payment infrastructure. We deliberately chose not to.

Real-world service transactions work like this:
1. Agree on the work
2. Work gets done
3. Pay

Nobody pays a plumber before they arrive. The protocol handles steps 1 and 2
(agreement and tracking). Step 3 happens offline between the business and
customer — cash, bank transfer, card on the day, invoice, whatever.

This means:
- Zero payment complexity in v1
- No financial regulation exposure
- Business uses whatever payment method they already use
- "Installation" is a 20-minute config job, not a Stripe integration project

Future versions may add optional payment features (escrow via USDC, in-protocol
invoicing), but only after the core discovery and agreement loop is proven.

---

## The Legal Structure

Three key legal points shaped the design:

**1. Contracts are valid**
UK law attributes AI agent actions to the person who deployed the agent. When
OpenClaw submits a task, the agreement is between the user and the business.
The service description is the published offer. Task submission is an enquiry
or acceptance. Standard contract formation, just automated.

**2. We are a directory, not an intermediary**
By never touching payments, never routing tasks, and never making verification
claims, we sit in the same legal position as Google Maps or Companies House.
We list information that businesses self-declare. We are not responsible for
what businesses do.

**3. Open source licence choice matters**
The server and MCP are MIT licensed. This means businesses can self-host,
modify, and use commercially without restriction. If we had used GPL, enterprise
adoption would be blocked (GPL requires derivative works to be open sourced too).

The index is proprietary. This is intentional — it's the asset.

---

## The Onboarding Angle

The open source server creates a natural onboarding business:

- Businesses want to be callable by AI agents
- They might need help describing their services effectively
- They might need help deploying the Docker container
- They might want someone to handle registration with the index

We sell that as a low-fee onboarding (£200-500 per business). The server
is simple enough that most tech-savvy businesses can do it themselves —
edit a YAML file, run `docker-compose up`, done.

For less technical businesses, onboarding can be subcontracted.

This:
- Generates immediate cash
- Grows the index organically (every client = one more indexed node)
- Builds our understanding of which service types are most demanded

The index only becomes valuable when it has real providers. Onboarding is
how we seed it without a marketplace chicken-and-egg problem.

---

## What We Explicitly Chose Not to Own

**Disputes:** The transaction ID encodes the node_id. Any dispute routes to
the business's contact details. We surface those details. We do not arbitrate.

**Service quality:** Trust signals are informational. We make no guarantees.
"Not endorsed by Inverse Claw" is in the terms and in the registration flow.

**Payment flow:** Payment is between business and customer. We are not in that chain.

**Employment relationships:** Businesses execute services. Their relationship
with their workers is theirs. We have no visibility into it.

**Physical delivery:** Same as a phone order. The business is responsible.

---

## Monetisation Path

**Now:** Onboarding fees (£200-500 per business setup)

**Near term:**
- Index subscription for businesses (£50-200/month to be listed)
- Subcontracted onboarding (collect fee, pay subcontractor)

**Later:**
- Enterprise features (analytics, audit logs)
- White-label protocol for specific verticals
- Sell the index (value comes from: provider count, usage data,
  being the default discovery layer for agent-callable real-world services)

---

## The One-Line Pitch

UCP is how agents buy things. Inverse Claw is how agents hire people.

---

## Current Status

Design complete. Ready to build.

Build order:
1. inverse-claw-server (open source, TypeScript + Fastify + SQLite + Docker)
2. inverse-claw-index (proprietary, TypeScript + Fastify + Supabase + Railway)
3. inverse-claw-mcp (open source, MCP SDK + npm + ClawHub)

See CLAUDE.md for full build instructions.
See ARCHITECTURE.md for system design.
