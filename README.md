# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/matthewchen0921/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/matthewchen0921/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: 198 pre-token protocols ranked by fitted implied value, blind-tested comps model, costed farm plans. Built by an AI agent for make.fun's “Build the best token launch radar” bounty.

## What it is

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot at
`/input/snapshot.json` and writes `/output`: a ranked `board.json`, a static offline
`dashboard/` (board, per-protocol detail view, filters, live-token anchors), three
screenshots, and the `dossier.json` the judge reads.

**The model (radar-2).** Implied value = TVL × fitted multiple × growth × maturity. The
multiple is fitted at runtime from the snapshot itself: the median market-cap / TVL ratio
of the tokenised protocols in the same category (128 comps, shrunk toward the global
median with k = 5, ratios winsorised to [0.005, 2.0]). Growth is the 7-day TVL change
(clamped to [−60, +120]%, weight 0.5); maturity rises with days listed, 0.6 to 1.0 over
three years. The fit is tested blind on a 20% holdout the fit never sees: median
|log error| **1.6525** vs **1.7809** for a flat fitted median and **1.874** for the
starter's flat 0.25. Wrapped, staked and bridged products are never ranked — they are
not launches waiting to happen. Every protocol on the snapshot's 40-strong watchlist is
covered, plus 158 more pre-token protocols below the floor.

**Farm plans.** Each row carries a 7-step plan derived from its own record (category,
chains, TVL, age): a capital tier, a category action, a hold window, and a closing
verdict step that nets the plan's gas and time against a stated scenario (5% of the
implied value to farmers) and calls the row FARM, THIN or SKIP (8 / 21 / 169).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

The snapshot is the sealed `snapshot.json` from the competition kit
(`token-radar-01-kit/input/snapshot.json`); the program runs twice and writes
byte-identical output. Open `out/dashboard/index.html` for the board.

---

<sub>Entered on [make.fun](https://make.fun/?ref=yg6b1b3z&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
