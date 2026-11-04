# KB2 agent desk

A standalone agent trading package for Kalshi, with user-authored strategies, Python forecasting, T3 orchestration v2 procedures, and a local control desk. It coexists with the original kb2 CLI/dashboard without changing their configuration or source.

```sh
cd agent
bun install
bun run python:setup
bun run start                  # http://127.0.0.1:3100
bun run mcp                    # stdio tools, for your agent host
bun src/cli.ts t3-plan          # portable MCP configuration + native schedule plan
bun run test
bun run typecheck
```

The desk starts with a “Liquid non-sports” strategy for Kalshi: politics, economics, weather, technology and entertainment. It requires at least 10,000 contracts of 24-hour volume, a spread no wider than $0.03, and at least 100 contracts at each best bid/ask. Entry size must also fit that displayed depth. Discovery and every new buy enforce these checks against a fresh book; missing liquidity data fails closed. Sells can reduce existing holdings after liquidity deteriorates. Edit these thresholds, timezone and spending limits in the dashboard. Defaults are paper execution, paused, 03:00 local exploration, and no automatic follow-ups. Enable and install the T3 clock using [the T3 procedure](docs/t3.md). An agent can request reasoned follow-ups only when allowed. Feedback on individual trades or the strategy is carried into the next run.

[Python modeling](docs/modeling.md) covers pandas/NumPy/scikit-learn setup, editable source, JSON forecasts, version hashes, chronological evaluation and costs. Python runs as your local user, **not in a sandbox**. Use only trusted model code. Removing exchange variables from the child environment does not prevent code from reading your files.

## Credentials

The package reads root `.env`, then `agent/.env`, without overriding variables already supplied by the process. Local files and state are ignored by Git. See [.env.example](.env.example). Only Kalshi is supported. Other venue inputs are rejected by the tool and model schemas. Existing history is retained; no other exchange is contacted.

`KB2_ENABLE_LIVE=true` is a separate startup gate. It does not change a paper strategy into a live one. After any strategy trades, its mode and starting capital cannot change; create another strategy. No live execution or external schedule is activated by installation.

## Guarantees and limits

- Trade intent is persisted before exchange submission; duplicate operation IDs do not send another request. Different payloads cannot reuse an ID. Ambiguous writes keep their budget reserved and stop further orders for that strategy.
- Each order checks the current strategy, verified venue category, maximum order size, exposure, daily buy budget, capital allocation, and sell inventory. Unknown/unclassified categories are excluded. Budgets are per strategy; they are not an account-wide capital allocator. Fees can take actual expenditure above the requested notional limit; reserve fee headroom in your allocation.
- SQLite transactions coordinate local processes against one state file. Do not copy state to multiple machines and expect shared locks. All local agents have the same user authority; this is not a hosted multi-tenant service.
- Maker quotes require post-only and expiry; no automatic short selling. Pausing does not remove already resting orders. Cancellation checks exchange status afterward to preserve fills during a cancel/fill race.
- Paper fills use best-quote crossing, full size, zero fees and no queue simulation. Paper returns are illustrative, not executable performance. Live marks use recorded fill quantity, price and fees; only trades made by this package are included. Deposits, withdrawals, external holdings and settlements are not automatically imported. Settled/closed instruments may lack marks; valuation then fails rather than inventing equity.
- T3 wakes need T3 and the machine online. The minute clock checks local time and pending UTC wakes; missed daily runs are caught only within two hours. Crashed runs remain locked until reviewed and released.
- The dashboard binds to loopback, requires same-origin JSON for changes, loads assets locally, refreshes every 15 seconds, and exposes no credentials. Keep it local. Serve it continuously with your process manager if you want it available after terminal exit.

## Files

`state/agents.db` stores strategy configuration, intent/result ledger, runs, feedback, wakes and equity marks. `state/models/` stores editable model sources. Back up state privately. `KB2_AGENT_DB` overrides the DB path and `KB2_AGENT_PORT` changes the dashboard port. Model source remains under this package's ignored state directory.
