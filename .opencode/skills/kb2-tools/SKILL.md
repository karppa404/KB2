---
name: kb2-tools
description: Use when another OpenCode instance needs to understand this repo's Kalshi, Perplexity, risk, history, and dashboard commands before making trades.
---

# KB2 Tools Reference

This repo is a Bun TypeScript CLI and dashboard for Kalshi trading, Perplexity research, portfolio risk, and command history.

Run commands from the repo root:

```bash
/Users/spro/code/kb2
```

## Environment

Required for live Kalshi trading:

- `KALSHI_API_ID`
- `KALSHI_PRIVATE_KEY` or `KALSHI_PRIVATE_KEY_PEM`

Required for Perplexity research:

- Perplexity API key supported by `@perplexity-ai/perplexity_ai`

Optional:

- `DB_PATH` for command history database path. Default is `./data/log.db`.
- `DASHBOARD_PORT` for dashboard server port. Default is `3000`.

## Verification Commands

Typecheck:

```bash
bunx tsc --noEmit
```

Run tests:

```bash
bun test
```

Note: this repo may not have test files. If `bun test` reports no matching test files, use typecheck and live CLI smoke tests.

## Kalshi Commands

Balance:

```bash
bun run src/cli/index.ts kalshi balance --pretty
```

Positions:

```bash
bun run src/cli/index.ts kalshi positions --pretty
bun run src/cli/index.ts kalshi positions --ticker SENATETX-26-R --pretty
```

Market search:

```bash
bun run src/cli/index.ts kalshi markets --keyword inflation --limit 10 --pretty
bun run src/cli/index.ts kalshi markets --keyword nba --limit 10 --pretty
bun run src/cli/index.ts kalshi markets --keyword taiwan --limit 10 --pretty
bun run src/cli/index.ts kalshi markets --keyword weather --limit 10 --status active --pretty
```

Market details:

```bash
bun run src/cli/index.ts kalshi market SENATETX-26-R --pretty
```

Orderbook:

```bash
bun run src/cli/index.ts kalshi orderbook SENATETX-26-R --pretty
```

Orders:

```bash
bun run src/cli/index.ts kalshi orders --pretty
bun run src/cli/index.ts kalshi orders --ticker SENATETX-26-R --pretty
```

Fills:

```bash
bun run src/cli/index.ts kalshi fills --pretty
bun run src/cli/index.ts kalshi fills --ticker SENATETX-26-R --pretty
```

Trades:

```bash
bun run src/cli/index.ts kalshi trades SENATETX-26-R --pretty
```

Buy:

```bash
bun run src/cli/index.ts kalshi buy SENATETX-26-R --side yes --count 1 --yes-price 61 --time-in-force immediate_or_cancel --pretty
```

Sell:

```bash
bun run src/cli/index.ts kalshi sell SENATETX-26-R --side yes --count 1 --yes-price 60 --time-in-force immediate_or_cancel --pretty
```

Generic order placement:

```bash
bun run src/cli/index.ts kalshi place-order --ticker SENATETX-26-R --action buy --side yes --count 1 --yes-price 61 --time-in-force immediate_or_cancel --pretty
```

Cancel order:

```bash
bun run src/cli/index.ts kalshi cancel-order <orderId> --pretty
```

## Perplexity Commands

Use `sonar-pro` for market research:

```bash
bun run src/cli/index.ts perplexity search "Research the current catalysts, official data sources, and market implications for this Kalshi thesis: <describe thesis>. Include citations and note settlement-rule risks." --model sonar-pro --max-tokens 2500 --pretty
```

The response shape is:

```json
{
  "answer": "...",
  "citations": ["..."]
}
```

## Risk Commands

Portfolio risk summary:

```bash
bun run src/cli/index.ts risk summary --pretty
```

Kelly helper:

```bash
bun run src/cli/index.ts risk kelly --prob 0.65 --odds 0.64 --bankroll 100 --fraction 0.5 --pretty
```

## History Commands

Recent command history:

```bash
bun run src/cli/index.ts history --limit 20 --pretty
```

Filter by command:

```bash
bun run src/cli/index.ts history --command "kalshi buy" --limit 10 --pretty
```

## Dashboard

Start the portfolio dashboard:

```bash
bun run dashboard
```

Open:

```text
http://localhost:3000
```

API endpoint:

```text
http://localhost:3000/api/dashboard
```

The dashboard polls every minute and includes:

- P&L & returns.
- Position & exposure.
- Win rate & edge.
- Risk.

## Trading Workflow For Another Instance

1. Run typecheck if code changed.
2. Check balance and positions.
3. Search target and adjacent markets.
4. Research with Perplexity `sonar-pro`.
5. Inspect market details and orderbooks.
6. Apply the liquidity and volume gate from `kalshi-adjacent-risk`.
7. Apply the resolution-rule gate from `kalshi-adjacent-risk`.
8. Decide fair probability and edge.
9. Size according to the `kalshi-adjacent-risk` skill.
10. Place incremental limit orders.
11. Confirm fills and positions.
12. Record the thesis and exit plan.

## Known Live Smoke Test

The `SENATETX-26-R` market was previously tested with:

```bash
bun run src/cli/index.ts kalshi buy SENATETX-26-R --side yes --count 1 --yes-price 61 --time-in-force immediate_or_cancel --pretty
bun run src/cli/index.ts kalshi sell SENATETX-26-R --side yes --count 1 --yes-price 60 --time-in-force immediate_or_cancel --pretty
bun run src/cli/index.ts kalshi positions --ticker SENATETX-26-R --pretty
```

The test buy and sell executed, and the final market position was confirmed flat.
