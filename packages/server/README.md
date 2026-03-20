# inverse-claw-server

The open source server that businesses self-host to expose their real-world services to AI agents via the Inverse Claw protocol.

When an AI agent needs to hire a plumber, book a cleaner, or commission any physical service — this is the server that lets a business be found and contacted.

## Relationship to Google's UCP

Google's Universal Commerce Protocol (UCP) lets agents buy products online. Inverse Claw lets agents hire people for physical tasks. They're complementary — a user could buy a dishwasher via UCP and hire someone to install it via Inverse Claw.

Like UCP, Inverse Claw uses a `/.well-known/` endpoint for agent discovery.

## Quick Start (Docker)

```bash
docker-compose up -d
```

Edit `services.yaml` to describe your services, then set environment variables in `docker-compose.yml` or a `.env` file:

```bash
BUSINESS_NAME="My Business"
CONTACT_EMAIL="hello@mybusiness.co.uk"
CONTACT_PHONE="+441234567890"          # optional
PRESENCE_URLS="https://facebook.com/mybusiness,https://mybusiness.co.uk"
```

## Quick Start (npm)

```bash
# Clone and install
git clone https://github.com/1776M/inverseclaw.git
cd inverseclaw/packages/server
npm install

# Set up the database
npx prisma db push

# Create your services.yaml (see below)
# Set environment variables (see below)

# Run
npx tsx src/index.ts
```

On first boot, the server will:
1. Generate a unique **node ID** (6 alphanumeric chars, e.g. `a3f9b2`)
2. Generate a **Business API Key** (printed to console — save it)
3. Start serving your services to agents

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BUSINESS_NAME` | Yes | Your business name |
| `CONTACT_EMAIL` | Yes | Contact email for customers |
| `CONTACT_PHONE` | No | Contact phone number |
| `PRESENCE_URLS` | No | Comma-separated public profile URLs (Facebook, Checkatrade, website) |
| `INDEX_ENDPOINT` | No | Inverse Claw Index URL for auto-registration |
| `INDEX_API_KEY` | No | Write API key from index registration |
| `AUTO_PUBLISH` | No | Set to `true` to auto-register with the index on startup |
| `PORT` | No | Server port (default: 3000) |
| `DATABASE_URL` | No | SQLite path (default: `file:../data/inverseclaw.db`) |
| `SERVICES_FILE` | No | Path to services.yaml (default: `./services.yaml`) |

### services.yaml

Describe your services in plain language. No rigid schemas — just a name, description, and optional service area. Agents search over descriptions to find you.

```yaml
services:
  - name: Oven Cleaning
    description: >
      Professional domestic oven cleaning including racks, glass, and hob.
      We cover Greater Manchester (M, SK, OL, WA postcodes).
      Single ovens from £45, doubles from £65, range cookers from £85.
      Usually available within 3 days of booking.
    service_area:
      country: GB
      regions: [M, SK, OL, WA]

  - name: Kitchen Deep Clean
    description: >
      Full kitchen deep clean including appliances, cupboard fronts,
      floor, and surfaces. Takes 3-4 hours. From £120.
    service_area:
      country: GB
      regions: [M, SK, OL]
```

**Tips for good descriptions:**
- Include pricing (even rough ranges)
- Mention your service area
- Describe what's included
- Mention typical availability/lead times

## API Reference

### GET /.well-known/inverseclaw

Discovery manifest. Any agent that knows your domain can hit this URL to discover your services.

```json
{
  "protocol": "inverseclaw",
  "version": "1.0.0",
  "node_id": "a3f9b2",
  "business_name": "CleanRight Ltd",
  "contact_email": "bookings@cleanright.co.uk",
  "services": [{ "name": "...", "description": "...", "service_area": {...} }],
  "presence_urls": ["https://checkatrade.com/trades/cleanright"]
}
```

### GET /services

Returns your services array (same data as the manifest, without node metadata).

### GET /health

```json
{ "node_id": "a3f9b2", "version": "1.0.0", "uptime_seconds": 3600 }
```

### POST /tasks

Agent submits a service request. The business then contacts the customer directly.

**Request:**
```json
{
  "service_name": "Oven Cleaning",
  "details": "Double oven, postcode M1 2AB, prefer next week",
  "contact": {
    "name": "Jane Smith",
    "phone": "07700900123",
    "email": "jane@email.com"
  }
}
```

**Response (201):**
```json
{
  "task_id": "tsk_za3e7j6u97am",
  "transaction_id": "ic_a3f9b2_20260320T143022_k7x9m",
  "status": "pending"
}
```

### GET /tasks/:task_id

Returns task status and full event history.

### POST /tasks/:task_id/events

Business pushes status updates. Requires `Authorization: Bearer <business_api_key>`.

**Request:**
```json
{ "status": "accepted", "message": "Booked for Tuesday 10am, £65" }
```

**Task lifecycle:**
```
pending → accepted → in_progress → completed
                                  → declined
                                  → cancelled
```

## Transaction IDs

Every task gets a transaction ID that encodes the node and timestamp:

```
ic_a3f9b2_20260320T143022_k7x9m
│   │       │                │
│   │       │                └── random
│   │       └──────────────────── timestamp (UTC)
│   └──────────────────────────── node_id
└──────────────────────────────── protocol prefix
```

If there's a dispute, the customer quotes this ID to reach the right business.

## Registering with the Index

To be discoverable by agents searching the Inverse Claw Index, either:

1. Set `AUTO_PUBLISH=true` and `INDEX_ENDPOINT=https://index.inverseclaw.io` — the server will register itself on startup
2. Or register manually via the index API

Your node ID must appear on at least one of your `PRESENCE_URLS` for verification to succeed.

## Development

```bash
npm run dev          # Start with hot reload
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
npm run build        # Compile TypeScript
```

## Licence

MIT
