# Inverse Claw — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        USER / HUMAN                          │
│              (deployed OpenClaw on their machine)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ natural language
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    OPENCLAW AGENT                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              inverse-claw-mcp                        │    │
│  │  (MCP server — translates agent intent to protocol) │    │
│  └──────────────┬──────────────────┬───────────────────┘    │
└─────────────────┼──────────────────┼───────────────────────-┘
                  │                  │
          PULL (search)        PUSH (task)
                  │                  │
                  ▼                  │
┌─────────────────────────────────┐  │
│      inverse-claw-index         │  │
│   (your hosted proprietary      │  │
│    discovery layer)             │  │
│                                 │  │
│  POST /nodes/register  ◄────────┼──┼── business registers
│  GET  /search          ◄────────┘  │
│  PUT  /nodes/:id                   │
│                                    │
└─────────────────────────────────┘  │
                                     │ direct call
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│              inverse-claw-server                             │
│         (open source — self-hosted by business)             │
│                                                              │
│   GET  /.well-known/inverseclaw ◄── agent direct discovery  │
│   GET  /services                ◄── index fetches services   │
│   POST /tasks                   ◄── agent submits task       │
│   GET  /tasks/:id               ◄── agent polls status       │
│                                                              │
│   ┌──────────────┐                                          │
│   │ services     │                                          │
│   │   .yaml      │                                          │
│   └──────────────┘                                          │
└──────────────────────────────────┬──────────────────────────┘
                                   │
                                   ▼ business contacts customer,
                                     arranges payment offline,
                                     executes service
                              REAL WORLD SERVICE
                         (plumber arrives, oven cleaned, etc.)
```

---

## Two Discovery Paths

Inverse Claw supports two ways for agents to find services, following the
convention established by Google's Universal Commerce Protocol (UCP).

### Path 1: Central Index (primary)

The agent doesn't know which businesses exist. It searches the index:

```
Agent → GET index.inverseclaw.io/search?q=oven+cleaning&location=M1
      ← Returns matching nodes with descriptions, contact info, trust signals
```

This is the primary discovery mechanism and the monetisable asset.

### Path 2: Direct Domain Discovery (secondary)

The agent already knows a business's domain (from a Google search, a
recommendation, a previous interaction, etc.). It checks:

```
Agent → GET cleanright.co.uk/.well-known/inverseclaw
      ← Returns service manifest: node_id, business name, services, contact
```

This follows UCP's `/.well-known/ucp` convention. Any agent that knows a
domain can discover its Inverse Claw services without touching the index.

The `/.well-known/inverseclaw` endpoint is served automatically by
inverse-claw-server. It returns:

```json
{
  "protocol": "inverseclaw",
  "version": "1.0.0",
  "node_id": "a3f9b2",
  "business_name": "CleanRight Ltd",
  "contact_email": "bookings@cleanright.co.uk",
  "contact_phone": "+441619871234",
  "endpoint": "https://cleanright.co.uk/rc",
  "services": [
    {
      "name": "Oven Cleaning",
      "description": "Professional domestic oven cleaning including racks, glass, and hob. Single ovens from £45, doubles from £65. Greater Manchester area.",
      "service_area": { "country": "GB", "regions": ["M", "SK", "OL", "WA"] }
    }
  ],
  "presence_urls": [
    "https://checkatrade.com/trades/cleanright",
    "https://facebook.com/cleanrightltd"
  ]
}
```

---

## Component Responsibilities

### inverse-claw-server
**Owner:** Business (self-hosted)
**Licence:** MIT
**Purpose:** Exposes what a business can do in a machine-readable way

Responsibilities:
- Serve `/.well-known/inverseclaw` manifest for direct agent discovery
- Serve service descriptions from local YAML config
- Accept task submissions from agents
- Allow business to push task status updates
- Generate unique transaction IDs
- Register with / update the index automatically

Does NOT:
- Handle payments (payment is offline between business and customer)
- Communicate with other nodes
- Handle disputes
- Store user personal data beyond what's in the task payload
- Know anything about the index internals

---

### inverse-claw-index
**Owner:** You (hosted on Railway)
**Licence:** Proprietary
**Purpose:** Discovery layer — the asset you eventually sell

Responsibilities:
- Accept node registrations with domain presence verification
- Store and serve service description search results
- Run background reputation checks via web search
- Surface trust signals (presence count, web presence, last seen)
- Provide lean LLM-optimised search API
- Handle GDPR deletion requests
- Accept abuse reports

Does NOT:
- Route tasks (agents call nodes directly after discovery)
- Handle payments
- Verify service quality
- Arbitrate disputes
- Endorse or guarantee any provider

---

### inverse-claw-mcp
**Owner:** You (published to npm + ClawHub)
**Licence:** MIT
**Purpose:** Entry point — how agents access the protocol

Responsibilities:
- Expose MCP tools for search, task submission, and status polling
- Call the index search API
- Call provider nodes directly for task operations
- Surface trust signals to agents before task submission
- Store nothing — stateless pass-through

---

## Data Flow: Full Transaction

```
1. User says to OpenClaw: "book someone to clean my oven in Manchester"

2. OpenClaw recognises physical task → invokes inverse-claw-mcp

3. MCP calls:
   GET index.inverseclaw.io/search?q=oven+cleaning&location=M1

4. Index returns 2-3 matching providers with presence URLs

5. MCP surfaces results to user:
   "I found CleanRight Ltd — they have profiles on Checkatrade and
   Facebook, and have been active since 2019. Shall I submit a request?"

6. User confirms, provides their contact details

7. MCP calls provider node directly:
   POST cleanright.co.uk/rc/tasks
   { service_name: "Oven Cleaning",
     details: "Double oven, postcode M1 2AB, prefer next week",
     contact: { name: "Jane Smith", phone: "07700900123",
                email: "jane@email.com" } }

8. Node creates task and returns:
   { task_id: "tsk_001",
     transaction_id: "ic_a3f9b2_20260320T143022_k7x9m",
     status: "pending" }

9. Business receives the request (via email/webhook/dashboard)

10. Business contacts customer directly to arrange details and price

11. Business pushes updates:
    POST cleanright.co.uk/rc/tasks/tsk_001/events
    { status: "accepted", message: "Booked for 25th March 10am, £65" }

12. MCP polls status and updates user

13. Business completes service, pushes final update:
    POST cleanright.co.uk/rc/tasks/tsk_001/events
    { status: "completed", message: "Job done" }

14. Customer pays business directly (cash, card, bank transfer —
    whatever they agreed). Inverse Claw is not involved in payment.

15. If dispute: customer contacts bookings@cleanright.co.uk
    quoting transaction_id ic_a3f9b2_20260320T143022_k7x9m.
    Inverse Claw is not involved.
```

---

## Transaction ID Anatomy

```
rc _ a3f9b2 _ 20260320T143022 _ k7x9m
│    │         │                 │
│    │         │                 └── 5 random alphanumeric chars
│    │         └──────────────────── ISO 8601 timestamp (UTC, no separators)
│    └────────────────────────────── node_id (6 chars, generated on install)
└─────────────────────────────────── protocol prefix
```

Given any transaction ID, you can:
- Identify which node processed it (node_id → index lookup → business contact)
- Know when it was created (timestamp)
- Route a dispute to the right business without any central database

---

## Trust Signal Hierarchy

Agents should evaluate providers in this order:

```
1. web_presence = "established"   (best signal — years of real presence)
2. presence_count >= 3            (multiple independent platforms)
3. verified_domain = true         (node_id confirmed on their domain)
4. last_seen < 7 days ago         (node is actively maintained)
```

Red flags to surface to user:
```
- web_presence = "flagged"        (negative signals found — warn strongly)
- presence_count = 0              (registration failed presence check — should never appear)
- last_seen > 14 days ago         (stale node — may not respond)
```

---

## Security Model

### Who can do what

| Actor | Can Do |
|-------|--------|
| Anyone | Search the index (rate limited) |
| Anyone | Read /.well-known/inverseclaw on any domain |
| Registered node | Update own details on index (with write API key) |
| Registered node | Delete own registration (GDPR) |
| Anyone | Submit abuse report |
| You (admin) | Suspend nodes |
| Agent | Submit tasks directly to provider nodes |
| Provider | Push task status updates (with local business API key) |

### Attack surfaces and mitigations

**Fake node registration:**
- Domain presence check — node_id must appear on a public URL they control
- Contact email domain must match presence URL domain
- Manual review window (pending state, 24-48 hours)

**Spamming the index:**
- Rate limiting by IP (100/hour for search)
- Write operations require write API key scoped to node_id

**Scam providers:**
- Background reputation checks via web search
- Abuse reporting endpoint
- You retain right to suspend any node at any time (in terms)
- Trust signals surfaced to agents — not hidden

**Task spam to nodes:**
- Nodes can implement their own rate limiting
- Task_id as a secret for status access limits exposure

---

## Deployment

### inverse-claw-server (business deploys)
```bash
docker run -d \
  -p 3000:3000 \
  -v ic-data:/app/data \
  -e BUSINESS_NAME="CleanRight Ltd" \
  -e CONTACT_EMAIL="bookings@cleanright.co.uk" \
  -e PRESENCE_URLS="https://checkatrade.com/trades/cleanright,https://facebook.com/cleanrightltd" \
  inverseclaw/server:latest
```

### inverse-claw-index (you deploy)
- Railway (recommended) — auto-deploys from GitHub
- Supabase for database
- Environment variables set in Railway dashboard
- Custom domain: index.inverseclaw.io

### inverse-claw-mcp (agents install)
```bash
# npm
npm install -g inverse-claw-mcp

# ClawHub
clawhub install inverseclaw/inverse-claw
```

---

## Relationship to UCP

Google's Universal Commerce Protocol (UCP) and Inverse Claw occupy
complementary positions in the agentic commerce stack:

```
┌─────────────────────────────────────────────┐
│              AI AGENT (e.g. OpenClaw)        │
│                                              │
│  ┌──────────────┐    ┌───────────────────┐  │
│  │  UCP client   │    │ inverse-claw-mcp  │  │
│  │  (buy stuff)  │    │ (hire people)     │  │
│  └──────┬───────┘    └──────┬────────────┘  │
└─────────┼───────────────────┼───────────────┘
          │                   │
          ▼                   ▼
   Online retailers     Local service
   (Shopify, Amazon)    businesses
   Products, checkout   Services, agreement
   /.well-known/ucp     /.well-known/inverseclaw
```

Both protocols:
- Use `/.well-known/` for domain-level discovery
- Support MCP bindings for agent integration
- Keep the merchant/business as the record owner
- Are transport-agnostic (REST/JSON)

They differ in:
- UCP handles payment in-protocol; Inverse Claw leaves payment offline
- UCP models products and carts; Inverse Claw models services and tasks
- UCP targets online retail; Inverse Claw targets physical services

An agent with both installed can seamlessly shop for products and hire
service providers in a single conversation.

---

## What This Is Not

- Not a marketplace (no escrow, no seller accounts, no reviews system)
- Not a job board (services, not gigs)
- Not a payment processor (payment is offline between business and customer)
- Not a dispute arbitrator (protocol surfaces contact details, that's it)
- Not a verification service (trust signals are informational, not guarantees)
- Not a competitor to UCP (complementary — services vs products)
