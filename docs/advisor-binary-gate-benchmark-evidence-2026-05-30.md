# Advisor binary-gate benchmark evidence (2026-05-30)

## What was run
- Terminal-Bench 2.1/2.0 core-slice generated from `/tmp/terminal-bench-core-0.1.1/task.yaml`:
  - `data/routing/binary-gate-terminal-bench-core-full.jsonl` (80 rows: 12 continue / 68 escalate)
  - `data/routing/binary-gate-terminal-bench-core-small.jsonl` (32-row sample: 12 continue / 20 escalate)
- Evaluated **old shipped model** (`data/routing/binary-gate-model.json`) vs **updated candidate** (`packages/advisor/assets/binary-gate-model.json`) using `scripts/eval-binary-gate-file.ts`.
- Ran performance benchmark with `npm run binary:benchmark` on both model files.

## CLI evidence

### Internal routing set (`data/routing/binary-gate.jsonl`)
- Old model report: `/tmp/eval-internal-old.json`
- New model report: `/tmp/eval-internal-new.json`

| metric | old | new |
|---|---:|---:|
| accuracy | 97.1370% | 97.2188% |
| escalate precision | 0.9758 | 0.9570 |
| escalate recall | 0.9642 | 0.9863 |
| continue precision | 0.9674 | 0.9871 |
| continue recall | 0.9780 | 0.9592 |

### Terminal-Bench core full (80 rows)
- Old model report: `/tmp/eval-core-full-old.json`
- New model report: `/tmp/eval-core-full-new.json`

| metric | old | new |
|---|---:|---:|
| accuracy | 32.500% | **95.000%** |
| escalate precision | 0.9375 | 0.9571 |
| escalate recall | 0.2206 | 0.9853 |
| continue precision | 0.1719 | 0.9000 |
| continue recall | 0.9167 | 0.7500 |

### Terminal-Bench core small (32 rows)
- Old model report: `/tmp/eval-core-small-old.json`
- New model report: `/tmp/eval-core-small-new.json`

| metric | old | new |
|---|---:|---:|
| accuracy | 43.750% | 90.625% |
| escalate precision | 0.7500 | 0.8696 |
| escalate recall | 0.1500 | 1.0000 |
| continue precision | 0.3929 | 1.0000 |
| continue recall | 0.9167 | 0.7500 |

### Runtime benchmark (`npm run binary:benchmark`)
- Old model (`data/routing/binary-gate-model.json`):
  - cold load 1.8ms
  - avg per prediction 0.026ms
  - throughput 38,100 preds/sec
- New model (`packages/advisor/assets/binary-gate-model.json`):
  - cold load 1.8ms
  - avg per prediction 0.025ms
  - throughput 39,365 preds/sec

## Why this looks 'incomplete' from git
- `data/routing/*` outputs are ignored by git in `.gitignore`, so all benchmark reports/bench slices are not shown by `git status`.
- The only tracked diff is the shipped model artifact:
  - `packages/advisor/assets/binary-gate-model.json`
- New model artifact hash changed from:
  - `6cc4991ccc0704fcca6bae61b1e4445b2b8ffc843f8af24cbfc3937f339eedc1`
  - to `1e5491eb4b571521d8fce3ca96384fd284a5f291ce0f62d4bc02dfd8b93a729d`