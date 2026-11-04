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

Round 2: APPROVE on the changed behavior and S1–S4. All four resolved; no regressions found. Reviewer independently reran 59 tests / 612 assertions, TypeScript and whitespace checks. No findings declined. Diff grew from 2,252 to 2,302 lines during the review fixes (before this documentation-only approval note). No usage metrics returned.

## Kalshi-only follow-up

One gpt-6.1-sol review round found S1 (should): an old unsupported-venue open order could block subsequent Kalshi reconciliation. Fixed with a venue guard that preserves the old row unchanged. The mixed-history regression confirms the Kalshi read executes and holdings update. Full suite: 46 tests / 395 assertions; typecheck passes. No findings declined and no usage metrics returned. The small fix was verified directly without another delegate round.

## Trade table and price rules

One gpt-6.1-sol review round found S1 (blocker): changing strategy mode during an awaited quote could let a paper rule submit as live. Accepted and fixed by passing the captured rule mode into internal submission, checking it on duplicates, before quote reads, and inside the trade insertion transaction. The exact concurrent mode-change regression passes with zero exchange writes and zero trade intents. Full suite: 54 tests / 431 assertions, typecheck and whitespace checks pass. The small fix was verified directly; no findings declined or usage metrics returned.
