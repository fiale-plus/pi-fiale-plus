---
name: advisor
description: Zero-config strategic advisor for Pi. Auto-detects best model, preflight + post-review + cache. Use for architecture, tradeoffs, planning.
---

# Advisor

Works out of the box. Just install and use `/advisor`.

## Quick start

- `/advisor` — status + config
- `/advisor <question>` — get immediate advice
- `/advisor on|off` — enable/disable

Zero config needed. Falls back through SOTA models (gpt-5.5 → claude-opus-4-6 → sonnet-4-6) automatically.

## When to call

Agent should call `advisor` tool before: new frameworks, refactoring, API design, concurrency, security, tradeoffs.
Skip: reads, small edits, one-liners.

## Commands

| Command | What it does |
|---------|-------------|
| `/advisor` | Show status, config, cached note |
| `/advisor <question>` | Get immediate strategic advice |
| `/advisor on` | Enable auto mode (preflight+post+cache) |
| `/advisor off` | Disable |
| `/advisor status` | Full status with model info |
| `/advisor config` | Show current 3-field config |
| `/advisor review light\|strict\|off` | Set review aggressiveness |

## Config (3 fields, all optional)

```json
{ "mode": "auto", "review": "light", "model": "gpt-5.5" }
```

All three can be set to sensible defaults — install and forget.
