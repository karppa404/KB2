---
name: kalshi-cli
description: >
  Use this skill whenever the user wants to interact with Kalshi prediction markets via the
  terminal CLI tool. Triggers include: checking account balance or positions, searching for
  markets or events, placing or canceling orders, viewing order history or fills, getting
  candlestick or trade data, checking the orderbook, or anything related to trading on Kalshi.
  Also use when the user asks how to construct a CLI command, what arguments a command takes,
  or wants to chain multiple Kalshi commands together for a trading workflow. Use this skill
  even if the user just says "check my Kalshi balance" or "find a market about X" — map their
  intent to the right command proactively.
---

# Kalshi CLI Skill

A terminal CLI tool for trading and querying Kalshi prediction markets. All commands are run
as `python main.py <command> [args]`. Output is always pretty-printed JSON.

**API host:** `https://external-api.kalshi.com/trade-api/v2`  
**Auth:** RSA key pair via `.env` (`KALSHI_API_ID`) and `./bot.pem`

---

## Market Hierarchy

Kalshi organizes markets in three levels — knowing this helps pick the right command:

```
Series  (e.g. FED)
  └── Event  (e.g. FED-26)
        └── Market  (e.g. FED-26-B)   ← this is what you trade
```

When a user describes a topic rather than a ticker, start with `get-events` or `get-markets`
to discover the right ticker before placing orders.

---

## Command Reference

### Account

| Command | Description |
|---|---|
| `get-balance` | Current account balance |
| `get-positions` | Open positions |
| `get-settlements` | Settled contract history |
| `get-fills` | Individual fill records (granular P&L) |
| `get-portfolio-history` | Balance snapshots over time |

```bash
python main.py get-balance

python main.py get-positions [--ticker TICKER] [--event-ticker EVENT_TICKER]
               [--limit 100] [--cursor CURSOR] [--count-filter FILTER]

python main.py get-settlements [--ticker TICKER] [--event-ticker EVENT_TICKER]
               [--limit 100] [--cursor CURSOR] [--min-ts TS] [--max-ts TS]

python main.py get-fills [--ticker TICKER] [--order-id ID]
               [--min-ts TS] [--max-ts TS] [--limit 100] [--cursor CURSOR]

python main.py get-portfolio-history [--limit 100] [--cursor CURSOR]
               [--start-ts TS] [--end-ts TS]
```

---

### Market Discovery

```bash
python main.py get-exchange-status        # Always run this first in automated sessions

python main.py get-series --series-ticker FED

python main.py get-events [--status open|closed|settled] [--series-ticker TICKER]
               [--with-nested-markets] [--limit 100] [--cursor CURSOR]

python main.py get-event --event-ticker FED-26

python main.py get-markets [--status open|closed|settled] [--ticker TICKER]
               [--series-ticker TICKER] [--limit 100] [--cursor CURSOR]

python main.py get-market --ticker FED-26-B
```

**`--with-nested-markets`** on `get-events` returns the child markets inline — useful for
discovering all tradeable contracts under an event without a second round-trip.

---

### Market Data

```bash
python main.py get-orderbook --ticker FED-26-B

python main.py get-trades --ticker FED-26-B [--limit 100] [--cursor CURSOR]

python main.py get-candles --ticker FED-26-B --series-ticker FED
               [--period 60] [--limit 100] [--start-ts TS] [--end-ts TS]
```

**`--period`** is in minutes. Common values: `1`, `60`, `1440` (daily).

> **Orderbook note:** Kalshi only returns bids (not asks). A YES bid at 45¢ implies a NO ask
> at 55¢ — they are equivalent positions on opposite sides.

---

### Order Management

```bash
# Place a single order
python main.py place-order --ticker FED-26-B --action buy|sell --side yes|no
               --count N --yes-price CENTS [--client-order-id ID]

# Amend a resting order (price and/or quantity)
python main.py amend-order --order-id ID [--count N] [--yes-price CENTS]

# Cancel a single order
python main.py cancel-order --order-id ID

# Batch operations
python main.py batch-create-orders --orders '[{"ticker":"FED-26-B","action":"buy","side":"yes","count":2,"yes_price":45}]'
python main.py batch-cancel-orders --order-ids "id1,id2,id3"

# View orders
python main.py get-orders [--status resting|filled|canceled] [--ticker TICKER] [--limit 100]
```

**Pricing:** `--yes-price` is in cents (1–99). Buying YES at 60 means you pay $0.60 per
contract and win $1.00 if YES resolves. Buying NO at 40 is equivalent (100 - 60 = 40).

**`--client-order-id`** is an idempotency key — useful for retries in automated sessions to
avoid duplicate orders.

---

## Common Workflows

### Discover and trade a market
```bash
# 1. Check exchange is open
python main.py get-exchange-status

# 2. Find the event
python main.py get-events --status open --series-ticker FED --with-nested-markets

# 3. Inspect the specific market
python main.py get-market --ticker FED-26-B

# 4. Check liquidity
python main.py get-orderbook --ticker FED-26-B

# 5. Place order
python main.py place-order --ticker FED-26-B --action buy --side yes --count 5 --yes-price 62
```

### Review open exposure
```bash
python main.py get-positions
python main.py get-orders --status resting
```

### Leg into a position across multiple contracts
```bash
python main.py batch-create-orders --orders '[
  {"ticker":"FED-26-B","action":"buy","side":"yes","count":3,"yes_price":60},
  {"ticker":"FED-26-C","action":"buy","side":"no","count":3,"yes_price":38}
]'
```
# Broad market research
```bash

python main.py search --query "What is the current probability the Fed cuts rates at the June 2026 FOMC meeting?"
```
# Recent news on a specific topic
```bash
python main.py search --query "Latest polling data for 2026 midterm elections" --recency week
```
# Breaking news
```bash
python main.py search --query "Did the Supreme Court rule on X?" --recency day
```
# Quick news check — cheap and fast
```bash
python main.py search --model sonar --query "Fed meeting outcome today" --recency day
```
# Probability reasoning — "should I buy YES on this?"
```bash
python main.py search --model sonar-reasoning-pro --query "Given current inflation data, what is the probability the Fed cuts rates in June 2026?"
```
# Full deep dive on an unfamiliar market
```bash
python main.py search --model sonar-deep-research --query "Comprehensive analysis of US-China tariff negotiations and likelihood of resolution by end of 2026"
```
---

## Key Notes for Automated / LLM Sessions

1. **Always call `get-exchange-status` first.** If the exchange is halted, orders will be
   rejected and you'll waste API calls.
2. **Tickers are case-sensitive.** `FED-26-B` ≠ `fed-26-b`.
3. **`amend-order` may only support quantity reduction** on the elections API endpoint —
   verify before trying to reprice a resting order.
4. **Pagination:** all list commands return a `cursor` field. Pass it to `--cursor` to fetch
   the next page. An empty cursor means no more pages.
5. **Unix timestamps:** `--min-ts`, `--max-ts`, `--start-ts`, `--end-ts` all take integer
   Unix seconds. Use `int(datetime.now().timestamp())` in Python to generate them.
6. **Session cleanup:** the client closes its aiohttp session automatically via `atexit`.
   No manual teardown needed.