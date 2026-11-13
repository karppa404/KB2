import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as kalshi from "../kalshi";
import { getRiskSummary, kellySize } from "../risk";
import { getHistory, getHistoryByCommand, logCommand } from "../db";
import { redact } from "./redact";

export interface ServerOptions {
  name?: string;
  version?: string;
  log?: boolean;
  exclude?: Set<string>;
  execute?: (name: string, args: Record<string, unknown>, run: () => unknown | Promise<unknown>, write: boolean) => unknown | Promise<unknown>;
}

export function createKalshiServer(options: ServerOptions = {}) {
const server = new McpServer({ name: options.name ?? "kb2-kalshi", version: options.version ?? "0.1.0" });
const text = z.string().trim().min(1);
const timestamp = z.number().int().nonnegative().describe("Unix timestamp in seconds");
const page = { limit: z.number().int().positive().optional(), cursor: text.optional() };
const range = { minTs: timestamp.optional(), maxTs: timestamp.optional() };
const marketFilters = { status: text.optional(), seriesTicker: text.optional(), ...page };

function tool<S extends z.ZodRawShape>(name: string, description: string, shape: S,
  run: (args: z.output<z.ZodObject<S>>) => unknown | Promise<unknown>, write = false) {
  if (options.exclude?.has(name)) return;
  const schema = z.object(shape).strict();
  server.registerTool<z.ZodRawShape, typeof schema>(name, {
    description,
    inputSchema: schema,
    annotations: { readOnlyHint: !write, destructiveHint: write, idempotentHint: !write, openWorldHint: true },
  }, async args => {
    const started = performance.now();
    let result: unknown;
    let error: string | undefined;
    try { result = redact(await (options.execute ? options.execute(name, args, () => run(args), write) : run(args))); }
    catch (cause) { error = String(redact(cause instanceof Error ? cause.message : "Kalshi operation failed")); }
    // A failed history write must not report a successful trade as failed and invite a retry.
    try { if (options.log !== false) logCommand({ command: `mcp ${name}`, args: redact(args) as Record<string, unknown>, result, error, duration_ms: performance.now() - started }); }
    catch { console.error("kb2-kalshi: unable to persist command history"); }
    const structuredContent = error ? { error } : result as Record<string, unknown>;
    return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }], structuredContent, ...(error ? { isError: true } : {}) };
  });
}

tool("account_limits", "Account tier, read/write token budgets and burst capacity.", {}, kalshi.getAccountLimits);
tool("endpoint_costs", "Kalshi request token costs used by the shared rate limiter.", {}, kalshi.getEndpointCosts);
tool("balance", "Account balance (Kalshi monetary units as returned by the API).", {}, kalshi.getBalance);
tool("positions", "One page of positions; use the returned cursor for continuation.", { ticker: text.optional(), count: page.limit, cursor: page.cursor }, kalshi.getPositions);
tool("settlements", "One page of settlements with optional timestamp bounds.", { ...page, ...range }, kalshi.getSettlements);
tool("markets", "One page of markets filtered by status, ticker or series.", { ...marketFilters, ticker: text.optional() }, kalshi.getMarkets);
tool("search_markets", "Search event and market text. Return the opaque cursor unchanged to continue with the same filters.", { keyword: text, ...marketFilters }, ({ keyword, ...params }) => kalshi.searchMarketsByTitle(keyword, params));
tool("market", "Details of one market.", { ticker: text }, ({ ticker }) => kalshi.getMarket(ticker));
tool("orderbook", "YES/NO orderbook; depth is an optional positive integer.", { ticker: text, depth: z.number().int().positive().optional() }, ({ ticker, depth }) => kalshi.getOrderbook(ticker, depth));
tool("orders", "One page of account orders.", { ticker: text.optional(), status: text.optional(), ...page }, kalshi.getOrders);
tool("candlesticks", "Market candlesticks between Unix timestamps. Interval is 1, 60 or 1440 minutes.", { seriesTicker: text, ticker: text, startTs: timestamp, endTs: timestamp, periodInterval: z.union([z.literal(1), z.literal(60), z.literal(1440)]) }, params => {
  if (params.startTs > params.endTs) throw new Error("Start timestamp must not exceed end timestamp");
  return kalshi.getMarketCandlesticks(params);
});
tool("trades", "One page of public market trades.", { ticker: text, ...page, ...range }, kalshi.getTrades);
tool("fills", "One page of account fills.", { ticker: text.optional(), ...page, ...range }, kalshi.getFills);
tool("portfolio_history", "All pages of fills and settlements within optional timestamp bounds.", { startTs: timestamp.optional(), endTs: timestamp.optional() }, kalshi.getPortfolioHistory);
tool("event", "One event and its markets.", { eventTicker: text }, ({ eventTicker }) => kalshi.getEvent(eventTicker));
tool("events", "One page of events.", marketFilters, kalshi.getEvents);
tool("series", "One series and its metadata.", { seriesTicker: text }, ({ seriesTicker }) => kalshi.getSeries(seriesTicker));
tool("exchange_status", "Kalshi exchange and trading availability.", {}, kalshi.getExchangeStatus);
tool("risk_summary", "Exposure, net realized P&L and cash in USD across all position pages.", {}, getRiskSummary);
tool("kelly_size", "Kelly sizing in bankroll units; fraction defaults to half Kelly (0.5).", { prob: z.number().min(0).max(1), odds: z.number().nonnegative(), bankroll: z.number().nonnegative(), fraction: z.number().min(0).max(1).optional() }, inputs => ({ size: kellySize(inputs), inputs: { ...inputs, fraction: inputs.fraction ?? 0.5 } }));
tool("history", "Newest-first CLI and MCP history. Filter by exact command, e.g. mcp balance or kalshi balance.", { limit: page.limit, command: text.optional() }, ({ limit = 20, command }) => {
  const rows = command ? getHistoryByCommand(command, limit) : getHistory(limit);
  const parse = (value: string | null) => { try { return value === null ? null : JSON.parse(value); } catch { return value; } };
  return { rows: rows.map(row => ({ ...row, args: parse(row.args), result: parse(row.result) })) };
});

const order = kalshi.orderSchema.shape;
const orderDescription = "Prices are in cents (0 < price < 100); supply exactly one of yes_price or no_price. Counts support two decimals. Requires Codex confirmation.";
tool("place_order", `Place a limit order. ${orderDescription}`, order, kalshi.placeOrder, true);
const { action, buy_max_cost, ...sideOrder } = order;
tool("buy", `Buy a YES or NO position. ${orderDescription}`, sideOrder, params => kalshi.placeOrder({ ...params, action: "buy" }), true);
tool("sell", `Sell a YES or NO position. reduce_only defaults to true. ${orderDescription}`, { ...sideOrder, reduce_only: z.boolean().default(true) }, params => kalshi.placeOrder({ ...params, action: "sell" }), true);
tool("amend_order", "Amend an order's count or price in cents. Requires Codex confirmation.", { orderId: text, count: order.count.optional(), yes_price: order.yes_price, no_price: order.no_price }, ({ orderId, ...params }) => kalshi.amendOrder(orderId, params), true);
tool("cancel_order", "Cancel one order. Requires Codex confirmation.", { orderId: text }, ({ orderId }) => kalshi.cancelOrder(orderId), true);
tool("batch_create", `Create a nonempty batch; inspect each response for partial failures. ${orderDescription}`, { orders: z.array(kalshi.orderSchema).min(1) }, kalshi.batchCreateOrders, true);
tool("batch_cancel", "Cancel a nonempty batch of order IDs; inspect each response for partial failures. Requires Codex confirmation.", { orderIds: z.array(text).min(1) }, kalshi.batchCancelOrders, true);

return server;
}
