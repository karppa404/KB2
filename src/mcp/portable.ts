import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "node:path";
import { createKalshiServer } from "./tools";
import * as kalshi from "../kalshi";
import { PaperAccount, defaultDataDirectory, type PaperOrder } from "./paper";
import { exportPnlPng, settlementPnlPoints } from "./pnl";
import { redact } from "./redact";

const writes = ["place_order", "buy", "sell", "amend_order", "cancel_order", "batch_create", "batch_cancel"];
const localReads = new Set(["kelly_size"]);
export async function startPortableServer(options: { credentialFile: string }) {
  const readOnly = process.env.KALSHI_MCP_READ_ONLY === "1";
  const liveAllowed = process.env.KALSHI_MCP_ALLOW_LIVE === "1";
  const configured = !!(process.env.KALSHI_API_ID && (process.env.KALSHI_PRIVATE_KEY || process.env.KALSHI_PRIVATE_KEY_PEM));
  const account = new PaperAccount();
  account.setMode(true);
  let liveActivated = false;
  const status = () => ({ ...account.status(), mode: liveActivated && liveAllowed && account.status().mode === "live" ? "live" as const : "paper" as const });
  const paginate = <T>(items: T[], args: Record<string, unknown>, countField = "limit") => {
    const offset = args.cursor === undefined ? 0 : Number(args.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid paper cursor");
    const limit = Number(args[countField] ?? 100);
    return { items: items.slice(offset, offset + limit), cursor: offset + limit < items.length ? String(offset + limit) : "" };
  };
  const paperFills = (args: Record<string, unknown>) => account.fills().fills.filter(f => (!args.ticker || f.ticker === args.ticker) && (args.minTs === undefined || Date.parse(f.created_time) / 1000 >= Number(args.minTs)) && (args.maxTs === undefined || Date.parse(f.created_time) / 1000 <= Number(args.maxTs)));
  const requireConnection = () => { if (!configured) throw new Error("Credentials are missing. Run setup.js setup locally and restart the MCP connection. Never enter keys in chat."); };
  const server = createKalshiServer({
    name: readOnly ? "kalshi-insights" : "kalshi", version: "1.0.0", log: false,
    exclude: new Set(["history", ...(readOnly ? writes : [])]),
    async execute(name, args, run, write) {
      const snapshot = status();
      if (write) {
        if (readOnly) throw new Error("Trading is unavailable in the insights package");
        if (snapshot.mode === "paper") {
          if (!["place_order", "buy", "sell"].includes(name)) throw new Error("Paper mode supports immediate single orders only; amend, cancel and batches are unavailable");
          requireConnection();
          const order = { ...args, ...(name === "buy" ? { action: "buy" } : name === "sell" ? { action: "sell", reduce_only: args.reduce_only ?? true } : {}) } as PaperOrder;
          const book = await kalshi.getOrderbook(order.ticker);
          return account.placeOrder(order, book, snapshot.revision);
        }
        if (!liveAllowed) throw new Error("Live execution is disabled. Set KALSHI_MCP_ALLOW_LIVE=1 outside chat and restart before explicitly switching to live mode.");
        requireConnection();
        // Capture the mode once. Never re-route an in-flight request after an await.
        return { mode: "live", ...await run() as Record<string, unknown> };
      }
      if (!readOnly && snapshot.mode === "paper") {
        if (name === "balance") return { mode: "paper", balance: Math.round(snapshot.balanceUsd * 100), balance_dollars: snapshot.balanceUsd.toFixed(2) };
        if (name === "positions") {
          const page = paginate(snapshot.positions.filter(p => !args.ticker || p.ticker === args.ticker), args, "count");
          return { mode: "paper", market_positions: page.items, cursor: page.cursor };
        }
        if (name === "orders") return account.orders();
        if (name === "fills") {
          const page = paginate(paperFills(args), args);
          return { mode: "paper", fills: page.items, cursor: page.cursor };
        }
        if (name === "settlements") return { mode: "paper", settlements: [], cursor: "", limitation: snapshot.limitation };
        if (name === "portfolio_history") {
          if (args.startTs !== undefined && args.endTs !== undefined && Number(args.startTs) > Number(args.endTs)) throw new Error("Start timestamp must not exceed end timestamp");
          return { mode: "paper", fills: { mode: "paper", fills: paperFills({ minTs: args.startTs, maxTs: args.endTs }), cursor: "" }, settlements: { settlements: [], cursor: "" }, limitation: snapshot.limitation };
        }
        if (name === "risk_summary") return { mode: "paper", availableCash: snapshot.balanceUsd, netPnl: snapshot.realizedPnlUsd, totalExposure: snapshot.positions.reduce((sum,p) => sum + p.costBasisUsd, 0), positionCount: snapshot.positions.length, limitation: "Paper cost basis exposure and realized P&L; excludes unrealized changes." };
      }
      if (!localReads.has(name)) requireConnection();
      const result = await run();
      return ["balance", "positions", "orders", "fills", "settlements", "portfolio_history", "risk_summary"].includes(name) ? { mode: "live", ...result as Record<string, unknown> } : result;
    },
  });
  function local<S extends z.ZodRawShape>(name: string, description: string, shape: S, run: (args: z.output<z.ZodObject<S>>) => unknown | Promise<unknown>, write = false) {
    const schema = z.object(shape).strict();
    server.registerTool<z.ZodRawShape, typeof schema>(name, { description, inputSchema: schema,
      annotations: { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write, openWorldHint: false } }, async args => {
      try {
        const result = redact(await run(args)) as Record<string, unknown>;
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: String(redact(error instanceof Error ? error.message : "Operation failed")) }] };
      }
    });
  }
  local("connection_status", "Check credential presence, selected environment and live execution permission without exposing keys. Presence does not verify API access.", {}, () => ({ configured, environment: process.env.KALSHI_BASE_URL?.includes("demo") ? "demo" : "production", credentialFile: options.credentialFile, liveExecutionEnabled: !readOnly && liveAllowed, readOnly }));
  local("trading_mode", "Inspect PAPER/LIVE mode, simulated cash, holdings and realized P&L. Does not value open holdings at market prices.", {}, () => ({ ...status(), readOnly, liveExecutionEnabled: !readOnly && liveAllowed }));
  if (!readOnly) {
    local("set_trading_mode", "Toggle paper trading. paper=true simulates orders; paper=false selects real-money execution only when live execution was enabled outside chat. Requires explicit user consent.", { paper: z.boolean() }, ({ paper }) => {
      if (!paper && !liveAllowed) throw new Error("Live execution is disabled; set KALSHI_MCP_ALLOW_LIVE=1 outside chat and restart first");
      liveActivated = !paper;
      return account.setMode(paper);
    }, true);
    local("reset_paper_account", "Delete all simulated holdings and fills, and reset paper cash. This cannot affect Kalshi funds. Requires explicit user consent.", { startingCashUsd: z.number().min(0).max(1_000_000_000) }, ({ startingCashUsd }) => account.reset(startingCashUsd), true);
  }
  const filterPage = { limit: z.number().int().min(1).max(200).optional(), cursor: z.string().min(1).optional() };
  const tickerFilter = { ticker: z.string().trim().min(1).optional() };
  const timeFilters = { minTs: z.number().int().nonnegative().optional(), maxTs: z.number().int().nonnegative().optional() };
  const liveTools: Array<[string, string, z.ZodRawShape, (args: any) => Promise<unknown>]> = [
    ["live_balance", "Read actual Kalshi cash, independently of paper mode.", {}, kalshi.getBalance],
    ["live_positions", "Read one page of actual Kalshi positions, independently of paper mode.", { ...tickerFilter, count: filterPage.limit, cursor: filterPage.cursor }, kalshi.getPositions],
    ["live_orders", "Read one page of actual Kalshi orders, independently of paper mode.", { ...tickerFilter, ...filterPage, status: z.string().optional() }, kalshi.getOrders],
    ["live_fills", "Read one page of actual Kalshi fills, independently of paper mode.", { ...tickerFilter, ...filterPage, ...timeFilters }, kalshi.getFills],
    ["live_settlements", "Read one page of actual Kalshi settlements, independently of paper mode.", { ...filterPage, ...timeFilters }, kalshi.getSettlements],
  ];
  for (const [name, description, shape, run] of liveTools) {
    const schema = z.object(shape).strict();
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async args => {
      try {
        requireConnection();
        const result = redact({ mode: "live", ...await run(args) as Record<string, unknown> }) as Record<string, unknown>;
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(redact(error instanceof Error ? error.message : "Operation failed")) }] }; }
    });
  }
  const ts = z.number().int().nonnegative().max(253402300799);
  server.registerTool("export_pnl_png", {
    description: "Export a PNG of cumulative realized P&L during an inclusive Unix-second range. Paper uses simulated sale profits; live-settlements uses net settlement results only, excluding unsettled trades and unrealized P&L. Writes a private local PNG and returns its image and path.",
    inputSchema: z.object({ source: z.enum(["paper", "live-settlements"]), startTs: ts, endTs: ts }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ source, startTs, endTs }) => {
    try {
      if (startTs >= endTs || endTs - startTs > 10 * 366 * 86400) throw new Error("Start must precede end and the range must not exceed ten years");
      let points;
      if (source === "paper") points = account.pnl(startTs, endTs);
      else {
        requireConnection();
        const settlements: unknown[] = []; const seen = new Set<string>(); let cursor: string | undefined;
        do {
          const result = await kalshi.getSettlements({ minTs: startTs, maxTs: endTs, limit: 200, cursor });
          settlements.push(...result.settlements ?? []);
          cursor = result.cursor || undefined;
          if (cursor && seen.has(cursor)) throw new Error("Repeated settlement cursor; export stopped");
          if (cursor) seen.add(cursor);
          if (settlements.length > 100_000) throw new Error("Too many settlements; choose a smaller range");
        } while (cursor);
        points = settlementPnlPoints(settlements);
      }
      const result = exportPnlPng({ points, startTs, endTs, source, directory: join(defaultDataDirectory(), "exports") });
      const { base64, ...metadata } = result;
      return { content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, data: base64, mimeType: "image/png" }], structuredContent: metadata };
    } catch (error) { return { isError: true, content: [{ type: "text" as const, text: String(redact(error instanceof Error ? error.message : "Export failed")) }] }; }
  });
  await server.connect(new StdioServerTransport());
  server.server.onclose = () => account.close();
}
