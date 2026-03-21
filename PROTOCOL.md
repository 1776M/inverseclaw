# Inverse Claw Protocol Specification

**Version:** 1.1
**Status:** Draft
**Licence:** MIT

---

## 1. Overview

Inverse Claw is an open protocol that connects AI agents to real-world service providers. It defines how businesses expose their services, how agents discover and book them, and how tasks are tracked from request to completion.

The protocol covers:
- **Discovery** — how agents find what a business offers
- **Task submission** — how agents request services on behalf of users
- **Task lifecycle** — how tasks move from request to completion
- **Deposits** — how both parties prove commitment
- **Research** — how agents verify a business before booking

The protocol does NOT cover:
- Payment for the service (arranged offline between business and customer)
- Dispute resolution (transaction IDs route disputes to the right business)
- Service quality verification (trust signals are informational, not guarantees)

---

## 2. Discovery

### 2.1 Well-Known Endpoint

Every Inverse Claw server MUST serve a discovery manifest at:

```
GET /.well-known/inverseclaw
```

**Response (200 OK):**

```json
{
  "protocol": "inverseclaw",
  "version": "1.1",
  "node_id": "<string, 6 alphanumeric chars>",
  "business_name": "<string>",
  "contact_email": "<string, valid email>",
  "contact_phone": "<string | null>",
  "endpoint": "<string, public URL of this server>",
  "services": [
    {
      "name": "<string>",
      "description": "<string, free-text>",
      "service_area": {
        "country": "<string, ISO 3166-1>",
        "regions": ["<string>"],
        "cities": ["<string>"],
        "radius_km": "<number>"
      },
      "deposit": {
        "amount_cents": "<integer, USD cents>",
        "providers": ["<string>"]
      }
    }
  ],
  "presence_urls": ["<string, URL>"],
  "research_required": true
}
```

**Notes:**
- `service_area` is optional per service. If present, `country` is required.
- `deposit` is optional per service. If present, `amount_cents` and `providers` are required.
- `research_required` is always `true`. Agents MUST research the business before submitting tasks.
- `presence_urls` are the business's public web presence (Checkatrade, Facebook, website, etc.).

### 2.2 Service Listing

```
GET /services
```

Returns the same `services` array as the manifest, without node metadata.

### 2.3 Health Check

```
GET /health
```

**Response (200 OK):**

```json
{
  "node_id": "<string>",
  "version": "<string, semver>",
  "uptime_seconds": "<integer>"
}
```

---

## 3. Research Requirement

Before submitting a task, the agent MUST research the business. This is a protocol-level requirement enforced by the server.

The agent SHOULD:
1. Read the `presence_urls` from the discovery manifest
2. Check each URL for signs of legitimacy (reviews, activity, domain age)
3. Summarise findings for the user
4. Get explicit user confirmation before proceeding

When submitting a task, the agent MUST include a `research` object (see section 4.1). The server rejects task submissions without it.

---

## 4. Task Lifecycle

### 4.1 Task Submission

```
POST /tasks
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `service_name` | string | Yes | 1-200 chars. Case-insensitive match against service names. |
| `details` | string | Yes | 1-5000 chars. Free-text description of what the customer needs. |
| `contact.name` | string | Yes | 1-200 chars. |
| `contact.phone` | string | No | Max 50 chars. |
| `contact.email` | string | No | Valid email, max 200 chars. |
| `research.urls_checked` | string[] | Yes | 1-20 valid URLs. Presence URLs the agent checked. |
| `research.summary` | string | Yes | 1-5000 chars. What the agent found. |

**Response (201 Created) — without deposit:**

```json
{
  "task_id": "<string, tsk_ + 12 alphanumeric>",
  "transaction_id": "<string, ic_{node_id}_{timestamp}_{random}>",
  "status": "pending"
}
```

**Response (201 Created) — with deposit:**

```json
{
  "task_id": "<string>",
  "transaction_id": "<string>",
  "status": "pending_deposit",
  "deposit_amount_cents": "<integer>",
  "deposit_providers": {
    "<provider_type>": { "<provider-specific fields>" }
  }
}
```

**Error responses:**

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `VALIDATION_ERROR` | Missing or invalid fields |
| 400 | `RESEARCH_REQUIRED` | Missing `research` object |
| 404 | `SERVICE_NOT_FOUND` | Service name not recognised |

### 4.2 Task Status

```
GET /tasks/:task_id
```

Returns full task details including contact information, current status, deposit information, and the complete event history. No authentication required — task IDs are unguessable secrets.

**Response (200 OK):**

```json
{
  "task_id": "<string>",
  "transaction_id": "<string>",
  "service_name": "<string>",
  "details": "<string>",
  "contact": {
    "name": "<string>",
    "phone": "<string | null>",
    "email": "<string | null>"
  },
  "status": "<string, see state machine>",
  "deposit_required": "<boolean>",
  "deposit_amount_cents": "<integer | null>",
  "deposit_provider": "<string | null>",
  "deposit_status": "<string | null, held|captured|released>",
  "created_at": "<string, ISO 8601>",
  "updated_at": "<string, ISO 8601>",
  "events": [
    {
      "status": "<string>",
      "message": "<string | null>",
      "created_at": "<string, ISO 8601>"
    }
  ]
}
```

### 4.3 Status Updates

```
POST /tasks/:task_id/events
Authorization: Bearer <business_api_key>
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `status` | string | Yes | One of: `accepted`, `in_progress`, `completed`, `declined`, `cancelled` |
| `message` | string | No | Max 2000 chars. |

**Response (200 OK):**

```json
{ "updated": true }
```

**Error responses:**

| Status | Code | Meaning |
|--------|------|---------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 400 | `VALIDATION_ERROR` | Invalid status value |
| 404 | `TASK_NOT_FOUND` | Task does not exist |
| 409 | `INVALID_TRANSITION` | Status transition not allowed |
| 409 | `CONCURRENT_MODIFICATION` | Status changed since read — retry |

### 4.4 Task Deletion

```
DELETE /tasks/:task_id
Authorization: Bearer <business_api_key>
```

Permanently deletes a task and all its event history.

**Response (200 OK):**

```json
{ "deleted": true }
```

---

## 5. State Machine

Tasks follow a strict state machine. Invalid transitions are rejected with `409 INVALID_TRANSITION`.

```
pending_deposit ──> pending ──> accepted ──> in_progress ──> completed
      │                │            │              │
      └──> cancelled   ├──> declined│              │
                       └──> cancelled              └──> cancelled
                                    └──> cancelled
```

**Transition table:**

| From | Allowed transitions |
|------|-------------------|
| `pending_deposit` | `pending` (deposit confirmed), `cancelled` (business cancels) |
| `pending` | `accepted`, `declined`, `cancelled` |
| `accepted` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `completed` | *(terminal)* |
| `declined` | *(terminal)* |
| `cancelled` | *(terminal)* |

**Automatic behaviours:**
- When a task reaches `completed` or `cancelled` (after deposit confirmation), the deposit is auto-released.
- When a `pending_deposit` task is cancelled, any created deposits are voided.

---

## 6. Deposits

Deposits are optional, small holds that deter fake bookings and prove the customer has skin in the game. They are NOT payment for the service.

### 6.1 Provider Model

The protocol is provider-agnostic. Each deposit provider implements:
- **Create** — set up the deposit and return provider-specific data for the agent
- **Confirm** — verify the deposit was completed (agent provides proof)
- **Capture** — business takes the deposit (customer no-show)
- **Release** — deposit returned to customer (normal completion)

Built-in providers: `stripe` (card pre-auth holds), `usdc_base` (USDC escrow on Base L2). The protocol supports any number of providers.

### 6.2 Deposit Confirmation

```
POST /tasks/:task_id/deposit
Content-Type: application/json
```

**Request body:**

| Field | Type | Required |
|-------|------|----------|
| `provider` | string | Yes — which provider was used |
| *(provider-specific)* | varies | Yes — e.g. `payment_intent_id` for Stripe, `tx_hash` for USDC |

**Response (200 OK):**

```json
{ "updated": true, "status": "pending" }
```

### 6.3 Deposit Capture

```
POST /tasks/:task_id/deposit/capture
Authorization: Bearer <business_api_key>
```

Business captures the deposit (customer no-show). No request body.

### 6.4 Deposit Release

```
POST /tasks/:task_id/deposit/release
Authorization: Bearer <business_api_key>
```

Business releases the deposit (refund). No request body. Note: deposits auto-release on task completion or business cancellation.

---

## 7. Transaction IDs

Every task receives a unique transaction ID:

```
ic_{node_id}_{timestamp}_{random}
```

| Segment | Format | Example |
|---------|--------|---------|
| Prefix | `ic_` | `ic_` |
| Node ID | 6 alphanumeric chars | `a3f9b2` |
| Timestamp | `YYYYMMDDTHHmmss` (UTC) | `20260321T143022` |
| Random | 5 alphanumeric chars | `k7x9m` |

**Example:** `ic_a3f9b2_20260321T143022_k7x9m`

Given any transaction ID, you can identify the business (node_id), when it was created (timestamp), and route a dispute without a central database.

---

## 8. Task IDs

Task IDs are unguessable identifiers:

```
tsk_{random}
```

Where `{random}` is 12 alphanumeric characters (a-z, 0-9).

**Example:** `tsk_f7h2k9x1m4q8`

Task IDs serve as the only access control for `GET /tasks/:task_id`. They MUST be generated with cryptographically secure randomness.

---

## 9. Authentication

| Endpoint | Authentication |
|----------|---------------|
| `GET /.well-known/inverseclaw` | None |
| `GET /services` | None |
| `GET /health` | None |
| `POST /tasks` | None (agent submits on behalf of user) |
| `GET /tasks/:task_id` | None (task ID is the secret) |
| `POST /tasks/:task_id/deposit` | None (agent confirms deposit) |
| `POST /tasks/:task_id/events` | `Authorization: Bearer <business_api_key>` |
| `POST /tasks/:task_id/deposit/capture` | `Authorization: Bearer <business_api_key>` |
| `POST /tasks/:task_id/deposit/release` | `Authorization: Bearer <business_api_key>` |
| `DELETE /tasks/:task_id` | `Authorization: Bearer <business_api_key>` |

The business API key is generated on first boot and stored locally. It is never shared with the index or any third party.

---

## 10. Webhooks

Servers SHOULD support optional webhook notifications. When configured, the server POSTs a JSON payload to the webhook URL on task events.

**Event types:**

| Event | When |
|-------|------|
| `task.created` | New task submitted |
| `task.updated` | Task status changed |
| `deposit.confirmed` | Deposit verified |

**Payload format:**

```json
{
  "event": "<string>",
  "timestamp": "<string, ISO 8601>",
  "data": { "<event-specific fields>" }
}
```

Webhooks are fire-and-forget. Failures MUST NOT block API responses. Implementations SHOULD use a 5-second timeout and no retries.

---

## 11. Rate Limiting

Servers SHOULD implement rate limiting to protect against abuse.

**Recommended defaults:**

| Endpoint | Limit |
|----------|-------|
| `POST /tasks` | 10 requests per minute per IP |
| All other endpoints | 100 requests per minute per IP |

Rate-limited requests receive `429 Too Many Requests`.

---

## 12. Conformance

An implementation is conformant with the Inverse Claw protocol if it:

1. Serves a valid discovery manifest at `GET /.well-known/inverseclaw`
2. Accepts task submissions at `POST /tasks` with the specified request format
3. Enforces the research requirement (rejects tasks without `research` object)
4. Returns task status at `GET /tasks/:task_id` with the specified response format
5. Accepts status updates at `POST /tasks/:task_id/events` with the specified state machine
6. Generates transaction IDs in the format `ic_{node_id}_{timestamp}_{random}`
7. Generates task IDs with cryptographically secure randomness
8. Uses timing-safe comparison for API key authentication

Deposit support, webhooks, rate limiting, and task deletion are RECOMMENDED but not required for basic conformance.

---

## 13. Reference Implementation

The reference implementation is `inverse-claw-server`, written in TypeScript with Fastify and SQLite. It is MIT licensed and available at:

```
https://github.com/1776M/inverseclaw
```

---

## 14. Versioning

The protocol version follows semver. The current version is `1.1`.

- **Major** version changes indicate breaking changes to endpoints, formats, or the state machine.
- **Minor** version changes add new optional features (e.g. deposits, webhooks).
- **Patch** version changes fix specification ambiguities without changing behaviour.

The version is included in the discovery manifest (`version` field) and in the health check response.
