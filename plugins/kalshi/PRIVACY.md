# Privacy disclosure

This independent, local-only integration has no hosted backend, telemetry, analytics, advertising or developer-operated credential collection endpoint. It runs on the user's computer. The developer receives no credentials or account records through this software.

Users enter a Kalshi API key ID and private key through a temporary local browser form. The form uses no external scripts, styles, images or analytics. Credentials are stored as plaintext in an owner-only file (0600, parent 0700), not encrypted by this application. OS administrators, software running as your user and backups may access them. Environment-based credentials can instead be supplied through a user-managed secret system. File storage is supported on POSIX systems only.

The local server signs outgoing requests and sends the API ID, signature, timestamp, request parameters and authorized order details to the selected official Kalshi API endpoint over HTTPS. The private key is used locally for signing, not sent to Kalshi. Kalshi's own policies govern that service. MCP responses, including balances, positions, fills, market data and graph images, are visible to the connected client and may become part of its conversation, logs or model context under that client's settings and policies.

Paper balances, positions, fills and selected mode are retained locally in a separate SQLite database. Requested PNG exports are retained as local files. Real account responses are not persisted by the portable integration's command history. The original KB2 CLI and legacy plugin have separate history behavior outside this release. There are no automatic uploads or exports to third parties.

To remove saved credentials, run `bun --no-env-file setup.js remove`, restart connected MCP sessions, and revoke the key through Kalshi settings. Removing a local file cannot revoke copies, environment variables or credentials already loaded into running processes. Delete the plugin data directory to erase paper state and PNGs. Filesystem deletion is not guaranteed secure erasure of disk blocks or backups. Uninstalling the plugin alone does not delete user data.

Maintainer contact: https://github.com/karppa404/KB2/issues. Never post credentials or private account information publicly. Before any public store submission, the publisher must host this policy at a stable public URL, supply the required verified identity and support contact, and keep the policy consistent with deployed behavior.
