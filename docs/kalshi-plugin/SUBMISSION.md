# Kalshi release and public-directory application

Prepared against official documentation checked November 12, 2026. This is an application preparation package, not an approved or published listing.

## Eligibility comes first

Two builds are provided:

| Build | Purpose | Trading |
| --- | --- | --- |
| `kalshi-plugin-1.0.0.zip` | Local desktop installation | Full tool profile; paper mode by default, with live trading requiring explicit configuration and user authorization |
| `kalshi-insights-1.0.0.zip` | Account/market read-only review candidate | Launch configuration sets `KALSHI_MCP_READ_ONLY=1`; trading tools are not registered. Requested PNG exports still create private local files. |

Both builds use the same server bundle. The read-only build is a configuration-selected profile, not a removal of trading code from the binary. Tell reviewers this explicitly. Do not change the read-only configuration after approval to enable trading without a new review.

Public distribution has unresolved prerequisites:

1. **Local MCP access:** OpenAI currently limits local/stdio MCP submissions to approved partners. Obtain confirmation from an OpenAI representative that the submitting organization is allowlisted. A working ZIP or local marketplace installation does not establish access.
2. **Third-party authorization:** The published guidelines prohibit plugins that primarily function as unofficial third-party connectors or pass-through layers. This is a community Kalshi integration. Obtain Kalshi authorization and written OpenAI confirmation of eligibility; do not imply affiliation or endorsement.
3. **Prediction-market scope:** The guidelines prohibit executing investment trades and facilitating real-money gambling services. Seek explicit review of the proposed Kalshi use case. A read-only build narrows functionality but does not establish that prediction-market research is acceptable.
4. **Credential handling:** Keys are entered in a separate local setup page, never in chat, model tool arguments, a ZIP, or reviewer instructions. Ask OpenAI to confirm that this local onboarding pattern meets submission requirements. The guidelines restrict collecting authentication secrets through plugin experiences.

These constraints come from [desktop-only submission instructions](https://developers.openai.com/plugins/deploy/desktop-only) and the [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines). Do not attest that the package meets public-directory requirements until the owner has resolved these issues. Approval is OpenAI's decision.

## Build and inspect

From the source checkout with Bun 1.3 or later, installed locked dependencies, and `zip`/`unzip` available:

```sh
bun install --frozen-lockfile
bun scripts/package-kalshi.ts
unzip -Z1 outputs/kalshi-plugin-1.0.0.zip
unzip -Z1 outputs/kalshi-insights-1.0.0.zip
```

The script bundles runtime JavaScript dependencies and copies an explicit file allowlist. It never copies the repository environment files, PEM files, databases, Git history, `node_modules`, or unrelated outputs. Bun remains an external runtime prerequisite. Each package contains per-file `SHA256SUMS`, and each ZIP has a companion `.sha256` file. Archive ordering, file timestamps, and permissions are normalized for repeatable builds on the same toolchain. Rebuild and compare hashes after any source, dependency, or manifest change.

Read `THIRD-PARTY-NOTICES.md` before redistribution. It includes installed upstream license texts, license sections from upstream README files, and the SPDX Unlicense reference for the Kalshi SDK's declared license. Packaging fails if a bundled package has no available license text. Bundling is not a legal license audit.

The build also creates `outputs/kalshi-marketplace/`, containing both extracted profiles and `.agents/plugins/marketplace.json` with relative source paths. Register it with `codex plugin marketplace add /absolute/path/to/kb2/outputs/kalshi-marketplace` and install the chosen profile in your desktop client. Keep the generated directory in place; it has no symlinks or machine-specific launch paths.

## Tool approval policy

Portable `mcp.json` declares how to start the server. It cannot declare Codex-specific tool approvals. A root portable manifest also takes precedence over the compatibility overlay; do not rely on `.mcp.json` approval fields being applied to a portable install.

Use the installed plugin identifier shown by your Codex client in its plugin-scoped config. For example, for a plugin identified as `kalshi`:

```toml
[plugins."kalshi".mcp_servers.kalshi]
enabled = true
default_tools_approval_mode = "prompt"

[plugins."kalshi".mcp_servers.kalshi.tools.exchange_status]
approval_mode = "approve"
```

Leave trading, mode changes, paper resets and file exports on `prompt`; approve individual read tools only if desired. If your client identifies a marketplace install using a qualified key, use that exact key instead of the example. For a direct `codex mcp add` installation, configure that connection's approval policy through the host. Other MCP clients must enforce their own confirmation policy; annotations are descriptive hints. The independent server-side live opt-in gate is enforced regardless of client annotations. See [installed server policy](https://developers.openai.com/plugins/build/plugins#configure-installed-server-policy).

Test an extracted ZIP in a fresh account or temporary home directory with no repository `.env` present. Use a dedicated Kalshi **demo** account for account workflows. Run the setup, MCP initialization, tool listing, pagination, authentication failure, credential deletion and reinstall workflows. Confirm the read-only build's actual `tools/list` response contains no trading or paper-trading tools. Record evidence and the exact ZIP hash.

## Owner-supplied publication materials

Complete these with real information; no identity, affiliation, domain ownership, or approval has been assumed:

- Verified individual or business developer identity and organization ID; publishing role in that organization.
- Explicit third-party permission and OpenAI eligibility/stdio-allowlist correspondence.
- Product homepage, customer support, published privacy policy and terms of service. All four listing URLs must be public HTTPS pages identifying the same publisher. GitHub document URLs can be used only if they are publicly accessible and acceptable to review.
- A monitored support contact and private security-report channel. Do not post private keys in GitHub issues.
- Accurate country availability, appropriate audience and legal review of prediction-market functionality. Do not assume US regulatory availability applies to every user or location.
- Reviewer access via the submission portal's secure review form. Use a dedicated demo account with sample data; do not use an actual customer's credentials or store reviewer secrets in this package.
- Five positive and three negative cases from `REVIEW-CASES.md`, actually run against the submitted build and reviewer account.
- A reviewer-accessible walkthrough recording demonstrating setup and those cases. No recording was fabricated by this release process.
- Exact release notes, version and bundle SHA-256, with any limitations disclosed.

## Submit after eligibility is confirmed

Follow the current [submission guide](https://developers.openai.com/plugins/deploy/submission); portal wording can change.

1. Confirm that the organization is verified, has submission permission, and has been allowlisted for local MCP submissions.
2. Open the OpenAI Platform plugin submission portal. For an approved local MCP submission, choose **Skills only**, as directed by the desktop-only guide, and upload the complete ZIP containing the stdio MCP configuration. This portal route does not make the package a skills-only integration.
3. Inspect imported metadata, icons, links, onboarding skill, MCP configuration and tool list. Address scan findings; do not hide or rename capabilities to evade review.
4. Enter private reviewer access only in the secure portal form. Add real walkthrough and test evidence, then complete the policy attestations truthfully.
5. Submit for review. Once approved, choose **Publish plugin** in the portal. Uploading, local marketplace installation, GitHub release creation, and merging source code do not publish a public listing.

This release does not create a remote service. A future hosted integration would need its own authenticated HTTPS MCP endpoint, domain verification, secure per-user credential isolation, privacy disclosures, operational controls and review. Do not expose this stdio process or loopback setup page as a public multi-user service.

## Source references

- [Package structure and portable manifests](https://developers.openai.com/plugins/build/plugins)
- [Desktop-only eligibility and upload flow](https://developers.openai.com/plugins/deploy/desktop-only)
- [Submission, reviewer materials and publication](https://developers.openai.com/plugins/deploy/submission)
- [Plugin guidelines, privacy and prohibited services](https://developers.openai.com/plugins/plugin-guidelines)
- [Portable manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)
