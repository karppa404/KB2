---
name: kalshi-adjacent-risk
description: Use when trading Kalshi adjacent or correlated markets, allocating portfolio risk, targeting weekly returns, or deciding buy/sell actions from this repo's CLI.
---

# Kalshi Adjacent Market Risk Skill

Use this skill when the task is to research, size, enter, rebalance, or exit positions across adjacent Kalshi markets in any category. This includes politics, sports, geopolitics, economics, weather, crypto, culture, companies, macro releases, and other Kalshi topics. Adjacent markets are markets whose outcomes, catalysts, participants, time horizons, geography, or event structures are related enough that one position changes the risk or edge of another.

## Objective

The portfolio objective is to pursue `+6%` account returns per week while keeping at least `50%` of the account balance actively deployed whenever positive-edge trades are available.

Treat the return target as a goal, not a guarantee. Do not force trades with negative or unclear edge just to meet deployment. If the 50% deployment target cannot be met without poor risk/reward, document the blocker and keep dry powder.

## Core Rules

- Keep at least `50%` of account balance in use across open positions or resting positive-edge orders when suitable markets exist.
- Prefer spreading exposure across adjacent markets instead of concentrating into one binary outcome.
- Never let one market dominate portfolio risk unless there is an explicit, documented reason.
- Check balance, positions, market details, and orderbook before placing orders.
- Use `sell` with reduce-only behavior for exits unless intentionally opening the opposite exposure.
- Prefer immediate-or-cancel test trades for execution checks.
- Avoid crossing wide spreads unless the expected edge clearly justifies paying the spread.
- If a market is illiquid, use smaller sizing and limit orders.
- Do not invest until the market passes the liquidity gate and resolution-rule gate below .

## Adjacent Market Workflow

1. Identify the focal thesis.

Examples:

- `A team wins a specific sports matchup or tournament`.
- `A geopolitical conflict escalates before a date`.
- `An inflation, jobs, GDP, or Fed decision market resolves above a threshold`.
- `A weather event reaches a stated severity or landfall condition`.
- `A crypto or macro asset closes above a price level`.
- `A political party or candidate wins an election`.

2. Search adjacent markets.

Look for markets tied to the same underlying event, participants, geography, timeframe, upstream catalysts, downstream consequences, substitute outcomes, exact outcomes, threshold ladders, and correlated category markets.

3. Research the thesis.

Use Perplexity with `sonar-pro` for current catalysts, data releases, injuries, lineups, weather, official statements, polling, ratings, news risk, legal/regulatory risk, settlement-source context, and any category-specific facts that affect probability.

4. Pull market prices.

For each candidate market, inspect market details and orderbook. Use best bid/ask to estimate entry cost and exit liquidity.

5. Estimate edge.

Translate research into a probability range. Compare estimated probability to market price after fees and spread.

6. Allocate across adjacent markets.

Spread risk across the highest-edge markets while accounting for correlation. Adjacent markets should reduce single-contract risk, not multiply the same hidden exposure.

7. Execute incrementally.

Enter in small clips, verify fills, then continue only if prices remain attractive.

8. Rebalance.

Sell or trim positions when the market moves past fair value, the thesis weakens, concentration rises too high, or better adjacent opportunities appear.

## Sizing Framework

Start with these constraints unless the user gives different limits:

- Target deployed capital: `50%` to `75%` of account equity.
- Max single-market exposure: `20%` of account equity.
- Max single-thesis exposure across adjacent markets: `40%` of account equity.
- Max illiquid-market exposure: `10%` of account equity.
- Max one execution clip: `5%` to `10%` of account equity.

If account equity is small, minimum viable contract size may force larger percentage clips. In that case, explicitly note the constraint before trading.

## Position Selection

Prioritize markets with:

- Clear catalyst path.
- Tight bid/ask spread.
- Good depth near fair value.
- Active volume and recent fills.
- A price meaningfully below estimated probability for buys or above estimated probability for sells.
- Low overlap with current largest exposure.

Avoid or de-prioritize markets with:

- Stale orderbooks.
- Large spreads.
- Ambiguous settlement rules.
- High correlation to already-large positions.
- News dependency that cannot be verified.

## Mandatory Market Gates

Do not invest in any market until both gates pass. If either gate fails, the only allowed actions are `hold`, `research more`, or place a tiny execution test that is immediately flattened.

### Liquidity And Volume Gate

A market passes the liquidity gate only if all are true:

- The market status is active/open.
- The bid/ask spread on the intended side is no wider than `8 cents`, or the estimated edge is at least `2x` the spread.
- There is enough visible depth within `3 cents` of the intended limit price to enter and exit the planned clip without taking more than `25%` of visible depth.
- 24h volume or recent fill activity is non-zero, unless the position is explicitly sized as an illiquid speculative position under the `10%` illiquid-market exposure cap.
- The orderbook is not obviously stale, crossed, empty, or one-sided.

If the market fails this gate but still has a strong thesis, cap exposure at `5%` of account equity and use resting limit orders only.

### Resolution Rule Gate

A market passes the resolution-rule gate only if all are true:

- The exact resolution source is understood from `rules_primary`, `rules_secondary`, market title, subtitle, and event context.
- The deciding condition, threshold, deadline, timezone, and early-close condition are clear.
- There is no unresolved ambiguity about what data source, official announcement, score, statistic, certification, or settlement authority determines the outcome.
- The thesis research directly maps to the rule language, not just to a similar real-world event.
- The model can explain one concrete scenario where `YES` resolves and one concrete scenario where `NO` resolves.

If this gate fails, do not trade. Research the rules or skip the market.

## Trading Commands

Use the project CLI from the repo root.

Search markets:

```bash
bun run src/cli/index.ts kalshi markets --keyword inflation --limit 10 --pretty
bun run src/cli/index.ts kalshi markets --keyword nba --limit 10 --pretty
bun run src/cli/index.ts kalshi markets --keyword taiwan --limit 10 --pretty
```

Inspect a market:

```bash
bun run src/cli/index.ts kalshi market SENATETX-26-R --pretty
```

Inspect orderbook:

```bash
bun run src/cli/index.ts kalshi orderbook SENATETX-26-R --pretty
```

Check balance and positions:

```bash
bun run src/cli/index.ts kalshi balance --pretty
bun run src/cli/index.ts kalshi positions --pretty
```

Research with Perplexity:

```bash
bun run src/cli/index.ts perplexity search "Research the current catalysts, official data sources, and market implications for this Kalshi thesis: <describe thesis>. Include citations and note settlement-rule risks." --model sonar-pro --max-tokens 2500 --pretty
```

Buy one contract, immediate-or-cancel:

```bash
bun run src/cli/index.ts kalshi buy SENATETX-26-R --side yes --count 1 --yes-price 61 --time-in-force immediate_or_cancel --pretty
```

Sell one contract, reduce-only by default:

```bash
bun run src/cli/index.ts kalshi sell SENATETX-26-R --side yes --count 1 --yes-price 60 --time-in-force immediate_or_cancel --pretty
```

## Pre-Trade Checklist

Before any live order, collect:

- Account balance and current portfolio positions.
- Current market details.
- Current orderbook.
- Recent fills or trades if needed.
- Research summary with citations for the thesis.
- Liquidity and volume gate result.
- Resolution-rule gate result.
- Estimated probability and fair value.
- Intended order side, count, limit price, and max downside.
- Portfolio deployment percentage before and after the order.
- Thesis exposure across adjacent markets before and after the order.

## Post-Trade Checklist

After every live order:

- Confirm order status and fill count.
- Re-check positions for the traded ticker.
- Confirm total deployed balance and exposure concentration.
- Log why the trade was made or exited.
- If the trade was only a test, immediately flatten with a reduce-only sell.

## Decision Output Format

When proposing or executing trades, summarize:

```markdown
Thesis: ...
Research Signal: ...
Market Price: ...
Liquidity Gate: pass/fail and why
Resolution Gate: pass/fail and why
Estimated Fair Probability: ...
Edge: ...
Action: buy/sell/hold
Ticker: ...
Side: yes/no
Count: ...
Limit Price: ...
Deployment After Trade: ...
Thesis Exposure After Trade: ...
Exit Plan: ...
```

## Safety Overrides

- Do not trade if API calls fail, positions cannot be confirmed, or orderbook data is missing.
- Do not trade if the command arguments are ambiguous.
- Do not trade settled, finalized, or inactive markets.
- Do not trade markets that fail the resolution-rule gate.
- Do not trade if available cash is insufficient.
- Do not ignore open exposure just to reach the weekly return target.
