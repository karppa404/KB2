# Kalshi Toolkit

Independent Kalshi MCP for Codex and other local MCP clients. Includes market research, account reads, optional real orders, persistent paper trading, and date-range realized P&L PNGs. Not affiliated with Kalshi. Requires Bun 1.3.14+ on macOS or Linux. Windows local credential storage is unsupported; managed environment credentials are possible, but that platform has not been tested.

## Install a release

Extract `kalshi-plugin-1.0.0.zip` to a permanent directory. It contains the server and bundled JavaScript dependencies. Install Bun separately from https://bun.sh. There are no install scripts, lifecycle hooks, or hosted service.

Run credential setup yourself in a terminal:

```sh
bun --no-env-file /absolute/path/to/kalshi/setup.js setup
```

Open the temporary loopback URL printed in that terminal. Enter your API key ID, choose production or demo, and select the private key file downloaded from Kalshi. Ed25519 and RSA keys of at least 2048 bits are supported. Never paste keys into chat. Setup validates the key format; it does not contact Kalshi or verify account access.

Credentials are saved in `~/.config/kalshi-mcp/credentials.json`: a file restricted to your OS user (0600) inside a 0700 directory. **This is plaintext storage protected by filesystem permissions, not an encrypted vault.** Use full disk encryption and protect your OS account. Environment credentials from your own secret manager are supported instead: `KALSHI_API_ID` and `KALSHI_PRIVATE_KEY_PEM` (or `KALSHI_PRIVATE_KEY`, a local PEM path). These take precedence over saved credentials; supply the complete pair. The server allows only official production and demo API URLs.

```sh
bun --no-env-file /absolute/path/to/kalshi/setup.js status
bun --no-env-file /absolute/path/to/kalshi/setup.js remove
```

Restart the MCP connection after saving or removing credentials. Revoke the key in Kalshi settings to invalidate already running sessions or copies. Setup binds only to 127.0.0.1 on an ephemeral port, expires after ten minutes, and accepts one successful save from its own origin. Credentials never enter MCP tool arguments.

## Connect Codex directly

```sh
codex mcp add kalshi -- bun --no-env-file /absolute/path/to/kalshi/server.js
```

Restart your Codex session. Call `connection_status` and `trading_mode`. No credentials are needed to inspect paper state or export paper results. Market data and simulated fills use Kalshi quotes and require valid API access with this implementation.

The ZIP also includes portable `plugin.json` and `mcp.json`, a Codex compatibility manifest, skill instructions and an icon. `${PLUGIN_ROOT}` launch paths are resolved by the plugin host. For a repo marketplace, build the release and register the `outputs/kalshi-marketplace` directory:

```sh
bun --no-env-file scripts/package-kalshi.ts
codex plugin marketplace add /absolute/path/to/kb2/outputs/kalshi-marketplace
```

Install from that marketplace in your desktop client. Test a fresh conversation after installation. Direct `codex mcp add` does not apply `.mcp.json` approval defaults; review your host's tool approvals manually.

## Paper trading toggle

Each new MCP connection starts in paper mode; the shared paper account initially has $10,000 of simulated cash. Live mode requires fresh activation in that connection. `set_trading_mode({paper:true})` enables it; `trading_mode` reports the current mode, cash and holdings. `reset_paper_account` erases simulated data and sets starting cash. Both commands have explicit schemas and write annotations.

`buy`, `sell`, and `place_order` route to the selected mode. In paper mode, simulated buys consume asks inferred from the opposite YES/NO bid book; sells consume same-side bids. The whole order must fill within its limit and visible depth. The simulator uses average cost accounting and records realized P&L on sells, with zero simulated fees. It does not simulate resting orders, shorting, partial fills, exchange settlements, price impact, or mark-to-market equity. Repeated simulations can reuse the same displayed liquidity. YES and NO holdings are separate. Amend, cancel and batch writes are rejected in paper mode.

Account reads follow the toggle and label their source. Market data always comes from Kalshi. `live_balance`, `live_positions`, `live_orders`, `live_fills` and `live_settlements` explicitly inspect the real account even in paper mode. The read-only insights variant always reads the real account.

To permit real orders, set `KALSHI_MCP_ALLOW_LIVE=1` in your own launch environment and restart. Then explicitly call `set_trading_mode({paper:false})`. Without that environment opt-in, live execution remains disabled and each connection requires a fresh explicit live-mode selection. The allow flag is absent from shipped manifests. Set write approvals to `prompt` in Codex; portable manifests cannot enforce host approvals. Review exact ticker, action, YES/NO side, quantity and limit before every live order. Switching to paper does not cancel a live request already accepted for dispatch. Host approval settings are advisory to other MCP clients; the server enforces the separate live opt-in itself. Do not automatically retry an uncertain write result.

## Export a P&L PNG

Use `export_pnl_png` with `source` (`paper` or `live-settlements`) and inclusive `startTs`/`endTs` in Unix seconds. Example range: 2026-11-01 00:00 UTC through 2026-11-12 00:00 UTC is `1793491200` through `1794441600`. The tool returns an image plus the absolute `.png` path and summary. Ranges are limited to ten years and 100,000 records per export. Export files are created under `~/.local/share/kalshi-mcp/exports/` with private permissions.

Paper charts sum realized sale profits during the interval. Live charts sum settlement revenue less reported contract costs and settlement fees, **not complete trading/account returns**. Both start at zero for the chosen interval, exclude earlier profits and all unrealized gains, and keep the full requested range visible even when no results occur. No automatic closing or settlements occur for paper holdings.

## Storage and distribution

Paper state is stored separately in `~/.local/share/kalshi-mcp/paper.db`. `KALSHI_MCP_DATA_DIR` overrides this directory; it must be owner-only. `KALSHI_MCP_CREDENTIALS_PATH` overrides the credential file. These paths are chosen by the local user, never tool arguments. The portable server disables CLI command-history access and persistence of real account responses. Exported charts and paper state remain until you delete them.

`kalshi-insights-1.0.0.zip` is a read-only submission candidate: live order tools, mode mutation, reset and command history are omitted. It still writes requested local PNG exports. Both packages use the same auditable bundle with the read-only variant fixed in its launch environment. Users controlling their own machine can change that configuration.

Public-directory publication is **not guaranteed**. Local MCP submissions currently require approved-partner allowlisting. Current guidelines prohibit investment trade execution and unofficial pass-through connectors; prediction-market research eligibility needs confirmation too. See `SUBMISSION.md`, `REVIEW-CASES.md`, `PRIVACY.md` and `SECURITY.md`. The full trading package is for local distribution; do not submit it as a compliant public trading integration.

Source and issue tracker: https://github.com/karppa404/KB2. Use GitHub private vulnerability reporting for secrets/security findings. No API keys should be included in issues.
