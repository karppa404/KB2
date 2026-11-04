# Verification

Observed November 4, 2026:

- New package: 53 tests passed, 0 failed; 428 assertions. Includes actual stdio MCP initialization and its configure/model/feedback/wake/snapshot/run lifecycle, mock exchange transports, all YES/NO buy/sell mappings, Ed25519/RSA signing, uncertainty, idempotency, budgets, inventory, timezone/DST, midnight catch-up, stale-refresh/cancel races, resting maker fills and same-origin HTTP checks.
- Agent TypeScript check passed. A clean checkout rebased on main installed dependencies and ran the package checks successfully.
- Existing working-copy kb2 tests: 103 passed, 0 failed; 609 assertions. Those existing uncommitted changes are outside this PR.
- Actual pandas/NumPy/scikit-learn example execution passed; see modeling.md. Its dataset is synthetic and establishes plumbing only.
- Authenticated balance reads passed for Kalshi with locally configured credentials. The Kalshi-only change also checked real public market volume and best bid/ask depth parsing. Credentials remain in ignored local configuration.
- Shared-browser visual checks at 1280px desktop and 390px phone widths: empty desk, create strategy, persist feedback, record equity and render return chart, seeded paper fill/open maker quote timeline, and follow-up queue. No horizontal page overflow at phone width. Visual fixture records were isolated in /tmp; they are not real account trades. The new UI uses local assets without a CDN.

No live orders were placed, canceled or modified. No unattended schedule was activated. Matching-engine behavior (including real partial fills and cancel/fill races) still needs venue demo/preproduction verification before real-money use. Paper simulation does not model fees, depth or queue priority.

Run the same package checks with `cd agent && bun install --frozen-lockfile && bun run python:setup && bun run typecheck && bun run test`. The agent CI workflow runs these checks on Linux/Python 3.12. Local proof used macOS/Bun 1.3.14/Python 3.14.

Kalshi-only change: removed the other venue adapter and its tests. Added enforced non-sports and liquidity checks, a persisted default preset, and tests for legacy-setting migration. A headless browser verified the preset, absence of venue/sports selection, liquidity edit/save roundtrip, and a 390px layout without page errors. Existing modes, budgets and pauses are preserved.

Review regression: unsupported historical venue orders are retained unchanged and skipped during reconciliation so later Kalshi orders still refresh. Sol raised this finding; the focused mixed-history regression and full suite pass after the fix.

Trade table / strike-price change: Current/Pending/Past views and the event-strike column were exercised in a headless browser with synthetic holdings, filled and open orders, linked exits, entry-rule save/cancel, and a 390px viewport. No page errors or document overflow. Price-rule tests cover both outcomes, trigger direction, linked-exit cancellation, concurrent ticks, uncertainty without replay, pause/expiry/mode/budget controls, and protection cancellation after a flat holding. All execution used mocks; no live order writes.
