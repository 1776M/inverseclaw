# Inverse Claw

**An open protocol that connects AI agents to real-world service providers.**

---

## What Is This?

Inverse Claw lets businesses expose their real-world services so AI agents can
discover them, submit requests, and track jobs on behalf of users.

When a user tells their AI agent "book someone to fix my boiler", the agent
uses Inverse Claw to find a local plumber, submit a request, and track the
job — without the user needing to do anything except confirm.

Payment is handled directly between the business and customer, just like in
real life. The protocol handles discovery and agreement, not money.

---

## How It Works

```
User → AI Agent → inverse-claw-mcp → inverse-claw-index (search)
                                    → inverse-claw-server (task submission)
                                    → Business contacts customer directly
```

Businesses self-host an `inverse-claw-server` which serves a manifest at
`/.well-known/inverseclaw` on their domain. Agents can discover services
directly from the domain, or search the index for providers by keyword and
location.

For services that require it, the protocol also handles a small deposit hold
to deter no-shows and prove agreement — the hold releases automatically on
normal completion.

---

## Components

| Component | What It Is | Licence |
|-----------|-----------|---------|
| [`inverse-claw-server`](packages/server/) | Server businesses self-host to expose their services | MIT |
| `inverse-claw-index` | Central discovery index for searching across providers | — |
| `inverse-claw-mcp` | MCP server for AI agents (npm package) | MIT |

---

## Quick Start (Server)

See the full [server README](packages/server/README.md) for details.

```bash
cd packages/server
npm install
npx prisma db push
npx tsx src/index.ts
```

Edit `services.yaml` to describe your services in plain language — no rigid
schemas required. Agents search over your descriptions to find you.

---

## Key Design Principles

- **Free-text service descriptions** — no rigid schemas, agents search semantically
- **No payment in the protocol** — payment is arranged directly between business and customer
- **Optional deposit holds for trust** — businesses can require a small card hold as proof of agreement and no-show deterrent
- **Mandatory provider research** — agents must research and surface provider reputation before booking
- **Domain presence as trust signal** — the open web verifies providers, not us
- **`/.well-known/inverseclaw` discovery** — agents can find services directly from a domain
- **MIT licence** on server and MCP — businesses can adopt without restriction

---

## Documentation

| File | Contents |
|------|----------|
| `ARCHITECTURE.md` | System design, data flows, discovery |
| `THINKING.md` | Design decisions and trade-offs |
| `TERMS_TEMPLATE.md` | Terms of service template |

---

## Status

Phase 1 (server) built. Index and MCP server in development.

---

## Licence

The server and MCP packages are MIT licensed. See [LICENSE](LICENSE).
