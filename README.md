# kb2

To install dependencies:

```bash
bun install
```

Run the CLI or dashboard:

```bash
bun run dev --help
bun run dashboard
```

Configure `KALSHI_API_ID` and either `KALSHI_PRIVATE_KEY` (file path) or
`KALSHI_PRIVATE_KEY_PEM`. `DB_PATH` optionally changes the command-history database.
`KALSHI_BASE_URL` optionally selects a different API base URL, including the local
HTTP server used in tests.

## Order compatibility

The CLI keeps `buy`/`sell`, YES/NO sides, and prices in cents. It translates these
to Kalshi V2 book sides and fixed-point dollar prices. Reduce-only orders default
to `immediate_or_cancel`, as required by V2. Amending an order first reads its
current ticker, direction, quantity, price, and shard to preserve omitted fields.

V2 does not support `buy_max_cost`; supplying it returns an explicit error. Use
an explicit limit price and count. Order commands return the V2 API response shape.
Batch JSON accepts the same fields as `place-order`; invalid batches fail before
any write is sent. Partial batch errors remain visible in the response and history.

Risk summaries and dashboard totals include all position pages. Portfolio history
includes all fill and settlement pages within the supplied date range. Keyword
search returns an opaque continuation cursor; pass it back with the same filters.

## Rate limits

```bash
bun run dev kalshi limits --pretty
bun run dev kalshi endpoint-costs --pretty
```

Kalshi requests check `/account/limits` and `/account/endpoint_costs` before the
first request and refresh that metadata after 60 seconds. Failed metadata checks
stop the request. Separate Read and Write token buckets use the returned refill
rates, capacities, and endpoint costs, including continuous refill and burst capacity.
Batches charge the endpoint cost for every order; batches exceeding capacity are
rejected with an instruction to reduce their size. Batches are not split automatically.

HTTP 429 responses retry up to four times with exponential backoff and jitter
(starting at 250 ms). Other errors, including ambiguous network failures on writes,
are not retried. Metadata requests use the same retry policy but bypass local pacing
to bootstrap the budgets.

Budgets are estimates within each process, not a measurement of remaining server
tokens. Other CLI processes and FIX clients share the server budgets; 429 handling
remains necessary. All writes conservatively share one local Write bucket, so
explicitly targeted shards do not gain extra parallel capacity. This project uses
Predictions endpoints; separate Perps budgets are not implemented.

## Codex plugin

`kb2-kalshi@kb2-local` exposes 28 typed MCP tools covering markets, account data,
keyword search, risk, history and trading. It imports the same services as the CLI,
including validation, pagination and rate limiting. Install into this Codex instance:

```bash
codex plugin marketplace add /Users/spro/code/kb2
codex plugin add kb2-kalshi@kb2-local
codex plugin list --marketplace kb2-local --json
```

Open a fresh Codex chat after installation (restart the desktop app if necessary).
Reads are automatically approved. `place_order`, `buy`, `sell`, `amend_order`,
`cancel_order`, `batch_create` and `batch_cancel` require Codex confirmation.
Approval is enforced by Codex before dispatch; a standalone MCP client has direct
access and must supply its own approval policy. Do not override these tools to auto-approve.

The local plugin launches `/Users/spro/.bun/bin/bun` with the repository as its
working directory, loading its existing `.env` and `data/log.db`. Keep the repository
and dependencies in place; update `plugins/kb2-kalshi/.mcp.json` if they move.
Credentials are never embedded in plugin metadata. MCP results and new MCP history
records redact credential fields and configured Kalshi secret values. Logs use command
names such as `mcp balance`; history includes existing CLI records. Protocol output
uses stdout, diagnostics stderr. A history write failure reports a diagnostic while
preserving a completed trade's result, preventing misleading retries.

Run `bun test src/mcp` for stdio protocol tests against a local Kalshi mock.
To test an installed copy, set `KB2_MCP_CONFIG` to its `.mcp.json` path. The tests
override credentials and use a temporary database. They exercise every tool and check
approval configuration. After installation, `bun run test:plugin` starts a fresh
Codex runtime with local model and Kalshi fixtures and verifies automatic read approval
plus actual confirmation, denial and acceptance for all seven trading tools.
No test sends live trades or calls an OpenAI model.

## Verification

```bash
bun run test
bun run typecheck
bun run build
bunx playwright install chromium
bun run test:browser
```

Tests use mocked trading calls and temporary databases; they do not place live orders.
Browser tests mock dashboard data and load React from the dashboard's existing CDN.
Opt-in live read-only checks: `KB2_LIVE_TESTS=1 bun tests/live-smoke.ts`.
See [TESTING.md](TESTING.md) for coverage, dependency updates, and verification results.
