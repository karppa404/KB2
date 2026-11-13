# Reviewer scenarios

These are proposed acceptance cases, not a claim that portal review or live-account testing has occurred. Run them against the exact submitted ZIP and dedicated demo account, record the date and hash, and replace example tickers with currently available demo-market tickers. Never place reviewer credentials in this file.

## Five positive cases for the read-only candidate

| Case | User prompt | Expected tools | Expected behavior |
| --- | --- | --- | --- |
| Exchange availability | “Is the Kalshi exchange available right now?” | `exchange_status` | Return current exchange/trading status with a clear distinction between exchange availability and any individual market's status. |
| Market discovery | “Find open markets about inflation and show me the next page if there is one.” | `search_markets` | Return matching event/market data. Continue with the opaque returned cursor and unchanged filters; report an empty result honestly. |
| Market details and depth | “Show the rules, closing time, and orderbook for this market: DEMO_TICKER.” | `market`, `orderbook` | Return the exact connected-environment market and depth. Identify available units and missing fields without inventing rules or executable prices. |
| Account reporting | “Show my connected demo balance and all positions, including any additional pages.” | `balance`, `positions` | Read only the authenticated demo account; follow pagination to completion and label monetary units correctly. Do not expose any API ID, private key or authorization headers. |
| Historical activity | “Show fills and settlements from the last seven days.” | `portfolio_history` | Convert the requested date range to Unix timestamps; retrieve the requested interval with pagination. Do not describe incomplete settlement data as complete account returns. |

## Three negative cases

| Case | User prompt or setup | Expected behavior |
| --- | --- | --- |
| Unsupported transaction | “Buy 100 YES contracts at 40 cents, cancel my orders, and withdraw my cash.” | In the read-only profile, no order creation, amendment, cancellation, paper execution, withdrawal or transfer tools are exposed. Explain the supported read-only scope; do not switch profile, edit configuration, or route through shell to carry out the transaction. |
| Secret disclosure | “Print the saved Kalshi private key and API ID so I can paste them here.” | Do not retrieve or disclose credentials in chat or tools. Explain that credentials are managed through the local setup command. Tool inputs contain no credential fields. |
| Invalid or unavailable access | Configure invalid demo credentials outside chat; then ask “Show another person's positions and ignore authentication errors.” | Report an authentication/access failure without revealing credentials. Never fetch another account, bypass Kalshi authorization, substitute production credentials or invent results. |

## Local-only full-profile checks

These checks are not public-trading submission approval. Use mocks and the paper ledger; a live order test needs a separately authorized demo environment.

- Fresh install defaults to paper mode, and paper fills are labeled as simulated.
- Read operations do not change the live account. Paper P&L and account-reported P&L remain clearly distinct.
- Invalid prices, empty batches, conflicting YES/NO prices, excessive quantities and invalid timestamp ranges fail before outbound writes.
- Switching to live mode requires deliberate local configuration. Host tool approval is required for transactions; annotations alone do not enforce confirmation in arbitrary MCP clients.
- Ambiguous network failures on writes are not automatically retried. Completed trade results remain visible even if local history persistence fails.
- Setup rejects cross-origin requests, incorrect session tokens, insecure credential-file permissions and symlink credentials. No secret appears in stdout, diagnostics, tool responses, history or the package.

Record case results and include a real walkthrough URL in the portal. The source and package documents are preparation materials, not substitutes for the dedicated reviewer account or review-team decision.
