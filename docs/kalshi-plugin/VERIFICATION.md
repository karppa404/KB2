# Release verification

Verified November 12, 2026 from a separate checkout based on `origin/main`, with Bun 1.3.14 and the committed root lockfile. Existing unrelated working-directory edits were excluded.

- Root `bun --no-env-file test`: 93 passed, 664 assertions. The existing agent's stdio model test requires `python3 -m venv agent/.venv`; its fixture uses only Python's standard library.
- `bun run test:mcp`: 39 passed, covering schema validation, API pagination, fixed-point order conversion, rate budgets/retries, local form protections, private storage, paper accounting, mode races and PNG output.
- `bun run typecheck` and `bun run build`: passed.
- Standalone bundled `server.js` running outside the repository: five protocol integration tests passed, including paper-only HTTP behavior, live activation/restart, read-only tool exposure, PNG export, missing credentials and redirect rejection.
- Package validator tests reject symlinks, credential files, missing referenced assets and embedded credential configuration.
- Full and insights archives include bundled runtime dependencies and third-party notices; Bun itself remains a prerequisite. Manifest schemas and all referenced files were checked. Two consecutive builds on the same toolchain produced matching ZIP bytes.
- PNG visual inspection used synthetic data and confirmed a 1200x720 image with readable date/currency axes, period total and accounting limitations.

No real credentials, live Kalshi API requests, live orders, public-directory submission or approval were used as verification. Demo-account acceptance cases, publisher identity/URLs, third-party authorization and OpenAI eligibility/partner allowlisting remain owner tasks documented in SUBMISSION.md.
