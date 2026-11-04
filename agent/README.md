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

## Trade table and price rules

The desk opens on a trade table. **Current** shows KB2-owned holdings; **Pending** shows resting/uncertain orders and waiting/executing price rules; **Past** shows executions and closed or failed records. Executed buys remain in Past as order history while their resulting holdings appear in Current. Old records without a market snapshot show “Not recorded” for their event strike.

The Event strike column comes from Kalshi's market metadata: greater/less thresholds, ranges, functional definitions and custom strikes. Threshold units come from the market's title and resolution rules; a 3% CPI strike is not a $0.03 contract price. Strike metadata is captured with new trade intents and pending rules, including zero and negative thresholds.

Use **Entry / exit rule** to queue a target entry or an exit. **Set exits** on a holding creates linked take-profit and stop-loss rules. Entry compares the selected outcome's executable ask; exits compare its bid. Entries trigger at or below the target, take-profit at or above it, and stop-loss at or below it. Exit limit prices use the observed bid minus the configured offset; entries use the target as their limit. All submissions still pass strategy budgets, inventory, liquidity and execution-mode controls. A triggered rule never retries an uncertain write under a new ID.

These are KB2 polling rules, **not exchange-native stops**. The T3 minute clock must be installed and online, and the strategy must be enabled. `claim_due_runs` (and the CLI `claim`) checks price rules even when no daily research or follow-up is due, so existing KB2 clock prompts still work. The optional research follow-up toggle does not disable explicitly saved price rules. Pause the strategy or cancel a waiting rule to stop it.

A linked exit cancels its sibling when one submits, even if the limit order has not filled. Partial fills, fast markets or a tight offset can leave exposure; inspect the Pending view and reconcile orders. Waiting protection is canceled if a tick observes the holding has been closed. Cancel old rules before replacing a holding. A crashed executing rule or uncertain trade remains locked for review; do not create replacement intents until its exchange outcome is known. Rules expire within 30 days and never change a strategy's paper/live mode.
