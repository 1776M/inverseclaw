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
User → AI Agent → inverse-claw-mcp → inverse-claw-server (discovery + task submission)
                                    → Business contacts customer directly
```

Businesses self-host an `inverse-claw-server` which serves a manifest at
`/.well-known/inverseclaw` on their domain. Any agent that knows the domain
can discover services, research the business, and submit tasks directly.

For services that require it, the protocol also handles a small deposit
to deter no-shows and prove agreement — the deposit auto-releases on
normal completion.

---

## Components

| Component | What It Is | Licence |
|-----------|-----------|---------|
| [`inverse-claw-server`](packages/server/) | Server businesses self-host to expose their services | MIT |
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
- **Optional deposit holds** — businesses can require a small deposit (Stripe card hold, USDC, or USDT escrow) as proof of agreement and no-show deterrent
- **Mandatory provider research** — agents must research and surface provider reputation before booking (server-enforced)
- **Domain presence as trust signal** — the open web verifies providers, not us
- **`/.well-known/inverseclaw` discovery** — agents can find services directly from a domain
- **MIT licence** — businesses and developers can adopt without restriction

---

## Protocol Specification

See [`PROTOCOL.md`](PROTOCOL.md) for the full protocol specification — everything
an implementer needs to build a conformant server in any language.

---

## Documentation

| File | Contents |
|------|----------|
| [`PROTOCOL.md`](PROTOCOL.md) | Formal protocol specification (v1.1) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System design, data flows, discovery |
| [`THINKING.md`](THINKING.md) | Design decisions and trade-offs |
| [`ISSUES.md`](ISSUES.md) | Known issues and resolution log |
| [`packages/server/README.md`](packages/server/README.md) | Server installation, configuration, API reference |

---

## Status

The protocol and reference server implementation are complete (134 tests passing).
MCP server is in development.

---

## Licence

MIT. See [LICENSE](LICENSE).
