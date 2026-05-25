# Skills-to-flow map

This repo keeps the existing skill logic intact and routes it into the orchestration stack without flattening it into generic templates.

## Advisory

- `skill:advisor`
- Feeds `packages/advisor`
- Role: strategic advice, routing, preflight, and session guidance

## Orchestration core

- `loop` → primitive tick/heartbeat layer
- `goal` → session objective, retargeting, side-quest recovery, completion checks

## Research

### `autoresearch`

- Source skill: iterative optimization with measurement, implementation, checks, and stall detection
- In flow: `packages/orchestration` command `/autoresearch`
- Role: single-agent optimization over a measurable target
- Preserved goodness:
  - metric-first workflow
  - measurement + checks
  - backpressure / stall checks
  - resume support
  - explicit logging

### `autoresearch-lab`

- Source skill: parallel multi-agent research
- In flow: `packages/orchestration` command `/autoresearch-lab`
- Role: split the work into independent areas and run them in parallel worktrees
- Preserved goodness:
  - isolated worktrees
  - evaluator checkpoint
  - merge/cherry-pick discipline
  - wave-based redesign when plateauing

## No flattening guarantee

The commands remain distinct:

- `/autoresearch` = solo optimization
- `/autoresearch-lab` = parallel research lab

They are not collapsed into a single generic research template.
