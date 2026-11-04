# Sol review ledger

Reviewer: gpt-6.1-sol, medium reasoning effort, Codex through T3 orchestration v2. Only this package and its CI workflow are in scope. No token usage was returned.

Round 1 requested changes. All four findings accepted:

| ID | Severity | Fix and proof |
| --- | --- | --- |
| S1 | blocker | Apply post-only rejection at initial submission only. Resting paper quotes can fill at their original limit. Regression crosses the book after placement and verifies holdings/cash. |
| S2 | should | Preserve cumulative Kalshi execution cost on refresh, normalized to the requested YES/NO leg. Adapter regression verifies both leg prices. |
| S3 | should | Compare the prior row status/result before persisting an asynchronous refresh. Regressions delay old responses behind a fill or cancellation and verify no state regression. |
| S4 | should | Attribute after-midnight catch-up to the previous local date. Regression checks the due key, one-time claim and expired window. |

After fixes: 59 tests passed / 612 assertions; TypeScript and whitespace checks passed. No live writes.
