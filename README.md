# kb2

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.


## Portable Kalshi MCP release

See [installation and secure setup](plugins/kalshi/README.md) for the standalone Codex MCP, persistent paper trading toggle, and date-range realized P&L PNG export. Build both the local full package and read-only submission candidate with `bun run package:plugin`; validate with `bun run test:mcp`. Read [submission prerequisites](docs/kalshi-plugin/SUBMISSION.md) before applying for the public directory. Keys stay out of chat and plugin metadata.
