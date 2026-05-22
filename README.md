# pi-fiale-plus

Fiale Plus Pi extensions, skills, and workflow plugins.

## Packages

- `@fiale-plus/pi` — bundle install for the full suite
- `@fiale-plus/pi-advisor` — phase-aware strategic advisor and advisor-coach replacement (SOTA escalation: gpt-5.5, claude-opus-4-6)
- `@fiale-plus/pi-goal` — session goal tracking
- `@fiale-plus/pi-guardrails` — shell risk checks and approvals with optional LLM review
- `@fiale-plus/pi-brain` — local project memory with branch tracking
- `@fiale-plus/pi-repo-arch` — repo-arch CLI integration bridge
- `@fiale-plus/pi-core` — shared helpers

## Install (local checkout)

This repo is not published yet. Use the local workspace checkout:

```bash
npm install
```

If you only want specific workspaces while developing:

```bash
npm install --workspace packages/advisor --workspace packages/goal
```

## Repo layout

```txt
packages/
  core/
  advisor/
  goal/
  guardrails/
  brain/
  repo-arch/
  bundle/
.autoresearch/     # optimization cycles (test coverage, quality)
```

Each feature package can be installed on its own, or through the bundle.

If you’re migrating from advisor-coach, wire the local `packages/advisor` workspace in and remove the old package.

## Development

```bash
npm install
npx vitest run    # 31+ tests
npx vitest run --coverage
```
