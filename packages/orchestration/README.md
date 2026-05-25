# PiRogue Orchestration

Session orchestration for PiRogue: scheduled loop, goal, and autoresearch controls.

`/goal` updates the status badge and kicks off the first check immediately when a loop is active; subsequent loop ticks resolve it. `/loop` announces each tick, sends the instruction back into the session, and requires at least 1m cadence. `/autoresearch` is now a facade over both: it sets a research-shaped goal, starts a 5m loop, and queues the first cycle immediately.

Install from npm:

```bash
npm install @fiale-plus/pi-rogue-orchestration
```

Or install locally from this repo root:

```bash
npm install
```
