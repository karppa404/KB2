import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "./redact";

const root = join(import.meta.dir, "../..");
const configPath = process.env.KB2_MCP_CONFIG ?? join(root, "plugins/kb2-kalshi/.mcp.json");
const config = (await Bun.file(configPath).json()).mcpServers.kalshi;
const dir = mkdtempSync(join(tmpdir(), "kb2-mcp-"));
const dbPath = join(dir, "history.db");
const requests: Array<{ method: string; path: string; query: Record<string, string>; body: any }> = [];
let failure = false;
let partial = false;
const fixture = Bun.serve({ port: 0, async fetch(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace("/trade-api/v2", "");
  const bodyText = await req.text();
  requests.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body: bodyText ? JSON.parse(bodyText) : null });
  if (path === "/account/limits") return Response.json({ usage_tier: "test", read: { refill_rate: 100000, bucket_capacity: 100000 }, write: { refill_rate: 100000, bucket_capacity: 100000 } });
  if (path === "/account/endpoint_costs") return Response.json({ default_cost: 10, endpoint_costs: [] });
  if (failure) return Response.json({ error: "fixture rejected" }, { status: 400 });
  if (path === "/portfolio/balance") return Response.json({ balance: 5000, balance_dollars: "50.00", api_key: "never expose", nested: { authorization: "never expose" } });
  if (path === "/portfolio/positions") return Response.json({ market_positions: [{ ticker: "T", market_exposure_dollars: "10", realized_pnl_dollars: "4", fees_paid_dollars: "1" }], cursor: url.searchParams.has("cursor") ? "" : "next" });
  if (path === "/portfolio/fills") return Response.json({ fills: [{ fill_id: url.searchParams.get("cursor") ?? "first" }], cursor: url.searchParams.has("cursor") ? "" : "next" });
  if (path === "/portfolio/settlements") return Response.json({ settlements: [{ ticker: "T" }], cursor: "" });
  if (path === "/events") return Response.json({ events: [{ title: "Weather", markets: [{ ticker: "T", title: "Rain", status: "active" }, { ticker: "T2", title: "Rain tomorrow", status: "active" }] }], cursor: "" });
  if (path === "/portfolio/orders/O") return Response.json({ order: { ticker: "T", book_side: "bid", initial_count_fp: "2.00", yes_price_dollars: "0.4000", exchange_index: 1 } });
  if (path.endsWith("/batched") && partial) return Response.json({ orders: [{ order_id: "ok" }, { error: { code: "insufficient_balance" } }] });
  return Response.json({ fixture: "ok" });
} });
let client: Client;
let stderr = "";
async function connect() {
  const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd,
    env: { PATH: process.env.PATH ?? "", DB_PATH: dbPath, KALSHI_BASE_URL: `${fixture.url}trade-api/v2`, KALSHI_API_ID: "", KALSHI_PRIVATE_KEY: "", KALSHI_PRIVATE_KEY_PEM: "" }, stderr: "pipe" });
  transport.stderr?.on("data", data => { stderr += data.toString(); });
  client = new Client({ name: "kb2-mock-verification", version: "1.0.0" });
  await client.connect(transport);
}
async function call(name: string, args: Record<string, unknown> = {}) {
  return await client.callTool({ name, arguments: args });
}
beforeEach(async () => { requests.length = 0; failure = false; partial = false; stderr = ""; await connect(); });
afterEach(async () => { await client.close(); });
afterAll(() => { fixture.stop(true); rmSync(dir, { recursive: true, force: true }); });

const writeNames = ["place_order", "buy", "sell", "amend_order", "cancel_order", "batch_create", "batch_cancel"];
test("initialization, tool discovery and approval coverage", async () => {
  expect(client.getServerVersion()).toEqual({ name: "kb2-kalshi", version: "0.1.0" });
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(28);
  expect(config.default_tools_approval_mode).toBe("approve");
  expect(Object.keys(config.tools).sort()).toEqual([...writeNames].sort());
  for (const tool of tools) {
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.annotations?.readOnlyHint).toBe(!writeNames.includes(tool.name));
    if (writeNames.includes(tool.name)) {
      expect(config.tools[tool.name].approval_mode).toBe("prompt");
      expect(tool.annotations?.destructiveHint).toBe(true);
    }
  }
  expect(tools.find(t => t.name === "place_order")?.inputSchema.required).toContain("count");
  expect(stderr).toBe("");
  expect(requests).toHaveLength(0);
});

const reads: Array<[string, Record<string, unknown>, string, Record<string, string>]> = [
  ["account_limits", {}, "/account/limits", {}],
  ["endpoint_costs", {}, "/account/endpoint_costs", {}],
  ["balance", {}, "/portfolio/balance", {}],
  ["positions", { ticker: "T", count: 2, cursor: "C" }, "/portfolio/positions", { ticker: "T", limit: "2", cursor: "C" }],
  ["settlements", { limit: 2, cursor: "C", minTs: 100, maxTs: 200 }, "/portfolio/settlements", { limit: "2", cursor: "C", min_ts: "100", max_ts: "200" }],
  ["markets", { ticker: "T", seriesTicker: "S", status: "open", limit: 2, cursor: "C" }, "/markets", { tickers: "T", series_ticker: "S", status: "open", limit: "2", cursor: "C" }],
  ["market", { ticker: "T" }, "/markets/T", {}],
  ["orderbook", { ticker: "T", depth: 2 }, "/markets/T/orderbook", { depth: "2" }],
  ["orders", { ticker: "T", status: "resting", limit: 2, cursor: "C" }, "/portfolio/orders", { ticker: "T", status: "resting", limit: "2", cursor: "C" }],
  ["candlesticks", { ticker: "T", seriesTicker: "S", startTs: 100, endTs: 200, periodInterval: 60 }, "/series/S/markets/T/candlesticks", { start_ts: "100", end_ts: "200", period_interval: "60" }],
  ["trades", { ticker: "T", limit: 2, cursor: "C", minTs: 100, maxTs: 200 }, "/markets/trades", { ticker: "T", limit: "2", cursor: "C", min_ts: "100", max_ts: "200" }],
  ["fills", { ticker: "T", limit: 2, cursor: "C", minTs: 100, maxTs: 200 }, "/portfolio/fills", { ticker: "T", limit: "2", cursor: "C", min_ts: "100", max_ts: "200" }],
  ["event", { eventTicker: "E" }, "/events/E", {}],
  ["events", { seriesTicker: "S", status: "open", limit: 2, cursor: "C" }, "/events", { series_ticker: "S", status: "open", limit: "2", cursor: "C" }],
  ["series", { seriesTicker: "S" }, "/series/S", {}],
  ["exchange_status", {}, "/exchange/status", {}],
];
for (const [name, args, path, query] of reads) test(`MCP ${name} forwards typed filters and JSON results`, async () => {
  const response = await call(name, args);
  expect(response.isError).not.toBe(true);
  expect(response.structuredContent).toBeDefined();
  expect(requests.find(r => r.path === path)).toEqual({ method: "GET", path, query, body: null });
  expect(JSON.stringify(response)).not.toContain("never expose");
  expect(stderr).toBe("");
});

test("search continuation preserves within-page matches", async () => {
  const first = (await call("search_markets", { keyword: " WEATHER ", limit: 1 })).structuredContent as any;
  expect(first.markets.map((m: any) => m.ticker)).toEqual(["T"]);
  expect(first.cursor).toStartWith("kb2:");
  const second = (await call("search_markets", { keyword: "weather", limit: 1, cursor: first.cursor })).structuredContent as any;
  expect(second.markets.map((m: any) => m.ticker)).toEqual(["T2"]);
});
test("portfolio history and risk aggregate all pages", async () => {
  const response = (await call("portfolio_history", { startTs: 100, endTs: 200 })).structuredContent as any;
  expect(response.fills.fills).toHaveLength(2);
  for (const req of requests.filter(r => ["/portfolio/fills", "/portfolio/settlements"].includes(r.path))) expect(req.query).toMatchObject({ min_ts: "100", max_ts: "200" });
  const summary = (await call("risk_summary")).structuredContent as any;
  expect(summary).toMatchObject({ totalExposure: 20, netPnl: 6, positionCount: 2, availableCash: 50 });
});
test("Kelly sizing defaults and schemas reject malformed inputs before HTTP", async () => {
  const kelly = (await call("kelly_size", { prob: 0.6, odds: 1, bankroll: 100 })).structuredContent as any;
  expect(kelly.size).toBeCloseTo(10);
  expect(kelly.inputs.fraction).toBe(0.5);
  for (const [name, args] of [
    ["market", {}], ["positions", { count: -1 }], ["kelly_size", { prob: 2, odds: 1, bankroll: 1 }],
    ["batch_create", { orders: [] }], ["batch_cancel", { orderIds: [""] }], ["buy", { ticker: "T", side: "yes", count: "2" }],
    ["market", { ticker: "T", api_key: "do not accept" }],
  ] as const) expect((await call(name, args)).isError).toBe(true);
  expect(requests).toHaveLength(0);
});

const order = { ticker: "T", action: "buy", side: "yes", count: 2, yes_price: 40 };
const writes: Array<[string, Record<string, unknown>, string, string, any]> = [
  ["place_order", order, "POST", "/portfolio/events/orders", { ticker: "T", side: "bid", count: "2.00", price: "0.4000" }],
  ["buy", { ticker: "T", side: "no", count: 2, no_price: 40 }, "POST", "/portfolio/events/orders", { side: "ask", price: "0.6000" }],
  ["sell", { ticker: "T", side: "yes", count: 2, yes_price: 40 }, "POST", "/portfolio/events/orders", { side: "ask", reduce_only: true, time_in_force: "immediate_or_cancel" }],
  ["amend_order", { orderId: "O", count: 4 }, "POST", "/portfolio/events/orders/O/amend", { ticker: "T", side: "bid", count: "4.00", price: "0.4000", exchange_index: 1 }],
  ["cancel_order", { orderId: "O" }, "DELETE", "/portfolio/events/orders/O", null],
  ["batch_create", { orders: [order] }, "POST", "/portfolio/events/orders/batched", { orders: [{ ticker: "T", side: "bid", count: "2.00", price: "0.4000", time_in_force: "good_till_canceled", self_trade_prevention_type: "taker_at_cross" }] }],
  ["batch_cancel", { orderIds: ["O"] }, "DELETE", "/portfolio/events/orders/batched", { orders: [{ order_id: "O" }] }],
];
for (const [name, args, method, path, body] of writes) test(`MCP ${name} dispatches correct payload after host approval`, async () => {
  // The client represents an approved host dispatch; the MCP server cannot grant Codex approval.
  expect(config.tools[name].approval_mode).toBe("prompt");
  expect((await call(name, args)).isError).not.toBe(true);
  const sent = requests.find(r => r.method === method && r.path === path);
  if (body === null) expect(sent?.body).toBeNull(); else expect(sent?.body).toMatchObject(body);
});
test("business validation, API errors and partial batch failures remain visible", async () => {
  expect((await call("place_order", { ...order, no_price: 60 })).isError).toBe(true);
  expect((await call("batch_create", { orders: [order, { ...order, yes_price: undefined }] })).isError).toBe(true);
  expect(requests.filter(r => r.method !== "GET")).toHaveLength(0);
  failure = true;
  expect((await call("buy", { ticker: "T", side: "yes", count: 2, yes_price: 40 })).isError).toBe(true);
  failure = false; partial = true;
  expect((await call("batch_create", { orders: [order] })).structuredContent).toEqual({ orders: [{ order_id: "ok" }, { error: { code: "insufficient_balance" } }] });
});
test("redacted success/failure history persists across processes", async () => {
  await call("balance");
  failure = true;
  await call("market", { ticker: "FAIL" });
  await client.close();
  await connect();
  const balanceRows = ((await call("history", { command: "mcp balance", limit: 1 })).structuredContent as any).rows;
  expect(balanceRows).toHaveLength(1);
  expect(balanceRows[0].result.api_key).toBe("[REDACTED]");
  const failureRows = ((await call("history", { command: "mcp market", limit: 1 })).structuredContent as any).rows;
  expect(failureRows[0].error).toContain("400");
  const history = ((await call("history", { limit: 3 })).structuredContent as any).rows;
  expect(history[0].id).toBeGreaterThan(history[1].id);
  expect(history[0].duration_ms).toBeGreaterThanOrEqual(0);
  const db = new Database(dbPath, { readonly: true });
  expect(JSON.stringify(db.query("select args, result, error from command_log").all())).not.toContain("never expose");
  db.close();
});
test("redaction handles nested credentials, PEMs and environment secrets", () => {
  const previous = process.env.KALSHI_API_ID;
  try {
    process.env.KALSHI_API_ID = "fixture-secret-id";
    expect(redact({ message: "failed fixture-secret-id", private_key: "secret", nested: [{ access_token: "secret", value: "-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----" }] })).toEqual({ message: "failed [REDACTED]", private_key: "[REDACTED]", nested: [{ access_token: "[REDACTED]", value: "[REDACTED]" }] });
  } finally {
    if (previous === undefined) delete process.env.KALSHI_API_ID; else process.env.KALSHI_API_ID = previous;
  }
});
test("history database failure preserves a completed trade result without retrying", async () => {
  const db = new Database(dbPath);
  db.exec("BEGIN EXCLUSIVE");
  try {
    expect((await call("place_order", order)).isError).not.toBe(true);
    expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
    expect(stderr).toContain("unable to persist command history");
  } finally { db.exec("ROLLBACK"); db.close(); }
});
test("concurrent Codex servers can initialize and log to the same new database", async () => {
  const clients = Array.from({ length: 4 }, () => new Client({ name: "concurrent-check", version: "1.0.0" }));
  const concurrentDb = join(dir, "concurrent.db");
  try {
    await Promise.all(clients.map(c => c.connect(new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd,
      env: { PATH: process.env.PATH ?? "", DB_PATH: concurrentDb, KALSHI_API_ID: "", KALSHI_PRIVATE_KEY: "", KALSHI_PRIVATE_KEY_PEM: "" }, stderr: "pipe" }))));
    const responses = await Promise.all(clients.map(c => c.callTool({ name: "kelly_size", arguments: { prob: 0.6, odds: 1, bankroll: 100 } })));
    expect(responses.every(r => !r.isError)).toBe(true);
    const db = new Database(concurrentDb, { readonly: true });
    expect(db.query("select count(*) as count from command_log").get()).toEqual({ count: 4 });
    db.close();
  } finally { await Promise.all(clients.map(c => c.close())); }
});
