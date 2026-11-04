# Dependency update and plugin verification — October 9, 2026

## Results

- `bun run test`: 103 passing tests, 609 assertions across six files.
- `bun run typecheck`: passed with TypeScript 7.
- Compiled executable: built and exercised for help, Kelly sizing, and history.
- Installed `kb2-kalshi@kb2-local` 0.1.0; Codex reports it enabled. Installed
  manifests match the repository copies, and installed-launch MCP tests passed.
- `bun run test:plugin`: a fresh Codex runtime discovers all 28 tools;
  reads run without confirmation; all seven trading tools prompt on every call.
  Declined calls send no Kalshi requests; accepted calls send exactly one write.
  Both the model and Kalshi API are local fixtures, with a temporary database.
- Previous October 8 checks: `bun run test:browser`, one Chromium scenario covering loading, all four cards,
  refresh, 60-second polling with a controlled clock, error recovery, charts,
  negative/zero formatting, a 375px viewport, and browser errors.
- Previous October 8 checks: `KB2_LIVE_TESTS=1 bun tests/live-smoke.ts`, 20 read-only checks passed.
- Previous October 8 checks: `bun outdated`, no outdated direct dependencies reported after the update.

No live orders were created, amended, canceled, or otherwise changed.

## Package versions

| Package | Before | After |
| --- | --- | --- |
| @libsql/client | 0.17.3 | 0.18.0 |
| axios | 1.16.1 | 1.20.0 |
| commander | 14.0.3 | 15.0.0 |
| dotenv | 17.4.2 | 18.0.6 |
| drizzle-orm | 0.45.2 | 0.45.4 |
| kalshi-typescript | 3.19.0 | 3.33.0 |
| zod | 4.4.3 | 4.6.5 |
| @types/bun | 1.3.14 | 1.4.2 |
| drizzle-kit | 0.31.10 | 0.31.11 |
| tsx | 4.22.3 | 4.23.15 |
| typescript | 5.9.3 | 7.0.2 |

Added `@playwright/test` 1.64.0 as a development dependency for repeatable browser checks.
Added `@modelcontextprotocol/sdk` 1.32.1 for the Bun stdio plugin server.

## Coverage

| Area | Checks |
| --- | --- |
| CLI | Help for all commands; missing required inputs; defaults; explicit options; JSON/pretty output; unknown commands; error exit codes. |
| Market/account reads | Each read command runs through the actual SDK against a local HTTP server; exact paths and query parameters, empty feeds, API failures. |
| Search | Event/market text, case/whitespace, status aliases, duplicate results, page cap, empty matches, API errors, continuation within and across pages. |
| Portfolio history | Both feeds paginate and receive start/end filters; reversed ranges fail. |
| Trading | Create, buy, sell, amend, cancel, and batches; YES/NO direction and prices; fractional counts; defaults, expiry, flags, invalid data, rejections, partial batch errors. All writes mocked. |
| Risk | Kelly examples and bounds; invalid inputs; empty portfolio; fees/losses; zero cash; signed exposure; multiple position pages. |
| History | Success/error persistence across processes; ordering, limits, filtering, duration, malformed legacy JSON, unusable database. |
| Dashboard data | Equity, realized/net P&L, fees, returns, win/loss averages, expectancy, concentration, exposure, and totals beyond the 30 displayed rows. |
| HTTP | Actual local server requests for static assets, content types, 404, API success/error JSON, and no-store on successful data. |
| Browser | Chromium desktop/mobile scenario described above. |
| Rate limits | Burst/refill/capacity, concurrent waiters, changed budgets, endpoint and batch costs, metadata failure/recovery, separate budgets, 429 retries/exhaustion, no replay of other failures. |
| Runtime | TypeScript, compilation, compiled CLI execution, configured temporary DB/API URL, and documented startup commands. |
| Removed research integration | CLI confirms the removed command is unavailable. |
| MCP | Initialize/discover 28 typed schemas; every read and write over stdio; filters, defaults, search continuation, all-page risk/history, validation errors, API errors, partial batches, secret redaction, cross-process history and database concurrency. |
| Codex plugin | Installed-runtime discovery; local model fixture forces each tool call; automatic read approval, explicit write prompts, declined calls with zero requests, accepted calls with one write. |

## Failures found and fixed

- The updated SDK removed legacy order methods. Migrated to typed V2 payloads,
  with YES-leg price and direction conversion and explicit validation.
- SDK read signatures shifted: corrected market filters and position ticker placement.
- TypeScript 7 removed `baseUrl` and required explicit runtime types in this setup.
- Commander interpreted `--no-price` as a negated option, including a truthy default;
  defined it as a regular value option so omitted prices stay omitted.
- Search previously skipped remaining matches when a limit cut through a page.
- Risk/dashboard previously read only the first position page.
- Portfolio history previously omitted settlement date filters and later pages.
- Added bounds checks for Kelly inputs, integer history limits, and batch/order data.
- Concurrent Codex discovery and chat startup could fail while creating the shared
  SQLite history schema. Added a one-second busy timeout and a concurrent-server test.
- MCP history failures preserve completed trade results and emit a stderr diagnostic.

The requested npm pages for [Kalshi](https://www.npmjs.com/package/kalshi-typescript),
[Commander](https://www.npmjs.com/package/commander), and
[TypeScript](https://www.npmjs.com/package/typescript) returned HTTP 403 to the web tool.
Used npm registry metadata and the installed npm packages' README, declarations,
and implementation, supplemented by Kalshi's official
[V2 order documentation](https://docs.kalshi.com/api-reference/orders/create-order-v2)
and [direction mapping](https://docs.kalshi.com/getting_started/order_direction).

The [MCP SDK npm page](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
also returned HTTP 403. Used the installed SDK's declarations and implementation to
resolve schema inference, and [official OpenAI plugin documentation](https://developers.openai.com/plugins/build/plugins)
for marketplace packaging and approval settings. An exact-equality Kelly fixture
was corrected to use floating-point tolerance.

## Limits of verification

Trading execution is verified against mocks, not a live or demo matching engine.
Browser checks cover Chromium only. Live read checks verify successful responses;
they do not independently audit the account's financial records. Search continuation
assumes upstream pages remain stable while paging; the API does not provide a snapshot.
