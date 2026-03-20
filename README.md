# Inverse Claw

**The execution layer for tasks AI agents can define but cannot complete themselves.**

---

## What Is This?

Inverse Claw is an open protocol that lets businesses expose their real-world
services as machine-readable descriptions, so AI agents like OpenClaw can
discover, commission, and track those services.

When a user tells their AI agent "book someone to fix my boiler", the agent
uses Inverse Claw to find a local plumber, submit a request, and track the
job — without the user needing to do anything except confirm.

Payment is handled offline between the business and customer, just like in
real life. The protocol handles discovery and agreement, not money.

---

## Relationship to Google's UCP

Google's Universal Commerce Protocol (UCP), launched January 2026, solves a
similar problem for online retail — agents discovering and buying products.
Inverse Claw is the equivalent for real-world services.

**UCP** = how agents buy things (products, checkout, delivery tracking)
**Inverse Claw** = how agents hire people (services, agreement, task tracking)

They are complementary, not competing. A user could buy a dishwasher via UCP
and hire someone to install it via Inverse Claw.

Inverse Claw adopts UCP's `/.well-known/` discovery convention: businesses
serve a manifest at `/.well-known/inverseclaw` on their domain, allowing
agents to discover services directly without needing the central index.

---

## The Three Components

| Component | What It Is | Hosted By | Licence |
|-----------|-----------|-----------|---------|
| `inverse-claw-server` | The server businesses self-host | Each business | MIT |
| `inverse-claw-index` | The discovery layer (the asset) | You | Proprietary |
| `inverse-claw-mcp` | The agent entry point | npm / ClawHub | MIT |

---

## How It Works

```
User → OpenClaw → inverse-claw-mcp → inverse-claw-index (search)
                                   → inverse-claw-server (task submission)
                                   → Business contacts customer directly
                                   → Business executes service
```

Agents can also discover services directly via `/.well-known/inverseclaw` on
a business's domain, bypassing the index if they already know the domain.

Full flow documented in ARCHITECTURE.md.

---

## Documentation

| File | Contents |
|------|----------|
| `CLAUDE.md` | Full build instructions for Claude Code |
| `ARCHITECTURE.md` | System design, data flows, discovery |
| `THINKING.md` | Why decisions were made, what was rejected |
| `CAPABILITY_EXAMPLES.md` | Example service definitions for testing |
| `TERMS_TEMPLATE.md` | Terms of service template (review with solicitor) |

---

## Build Order

1. Read `CLAUDE.md` in full before writing any code
2. Build `inverse-claw-server` first
3. Build `inverse-claw-index` second
4. Build `inverse-claw-mcp` third
5. Run the integration test in `CLAUDE.md` to verify the full loop

---

## Key Design Decisions

- **MIT licence** on server and MCP — businesses can adopt without restriction
- **Proprietary index** — this is the monetisable asset, kept separate
- **No payment in the protocol** — payment is offline between business and customer
- **No verification claims** — we're a directory, liability stays with providers
- **Domain presence as trust signal** — the open web verifies providers, not us
- **`/.well-known/inverseclaw`** — follows UCP's convention for agent-native discovery
- **Free-text service descriptions** — no rigid schemas, agents search semantically

---

## Monetisation

- **Now:** Onboarding fee — help businesses set up and register (£200-500 each)
- **Soon:** Index subscription for providers (£50-200/month)
- **Later:** Enterprise features, sell the index

---

## Status

Design complete. Ready to build.
