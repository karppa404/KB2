# Security model

Credentials are configured out of band through a short-lived, random-capability loopback page. POST requests require the expected host, Origin, JSON content type and same-origin fetch metadata when present. The page cannot be framed, has no external resources, disables caching, and uses a no-referrer policy. Key format and size are validated before an atomic owner-only file replacement. Credential reads reject symlinks, foreign owners and group/world permissions. This protects against accidental sharing and other ordinary OS users; it does not defend against a compromised account, administrator, browser extension, hostile backup tool or same-user process.

The private key is stored unencrypted. Enable OS disk encryption or provide credentials through your own secret manager and launch environment. Never enter real keys in chat, tool inputs, command-line arguments, repo files, public issues or screenshots. Use separate demo keys for testing. The plugin never needs an OpenAI API key.

Portable startup does not import dotenv and shipped launchers disable Bun's automatic dotenv loading. The portable SDK transport rejects redirects and permits only the official production and demo URLs. Explicit local-fixture mode is test-only and must not be enabled with real credentials. Secrets are redacted from MCP results and diagnostic errors. Unexpected errors must never print raw SDK request/configuration objects.

Trading defaults to paper, with no API writes. Live order execution additionally requires the user's external `KALSHI_MCP_ALLOW_LIVE=1` opt-in and a saved live mode selection. The read-only variant omits order/mode/reset tools. Paper orders capture the mode revision before fetching quotes and reject a changed revision before recording a fill. Live requests retain their originally selected mode; changing mode cannot cancel an already dispatched live request. Confirmation comes from the MCP host. Use `prompt` approvals for orders and mode changes. Never retry ambiguous writes; inspect account orders first.

PNG paths are generated under a private user-selected data directory, not accepted from model arguments. Paper state is separate from real account data. Quotes and market text remain untrusted external input. The integration does not follow instructions embedded in API data.

Please use the repository's private vulnerability reporting feature at https://github.com/karppa404/KB2/security/advisories/new if enabled. Otherwise report a security issue without secrets through the issue tracker and request a private channel. Revoke exposed credentials immediately; publishing a fixed package does not invalidate leaked keys.

Release verification uses generated fixture keys, local mock APIs and temporary storage. No live orders are required. Public-directory eligibility is a separate review, not a security assurance or endorsement by Kalshi or OpenAI.
