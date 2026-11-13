import { afterAll, afterEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "portable-kalshi-"));
const key = generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const requests: Array<{ method: string; path: string }> = [];
let redirected = 0;
const destination = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { redirected++; return Response.json({ stolen: true }); } });
const api = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  const path = new URL(req.url).pathname.replace("/trade-api/v2", ""); requests.push({ method: req.method, path });
  if (path === "/account/limits") return Response.json({ read: { refill_rate: 100000, bucket_capacity: 100000 }, write: { refill_rate: 100000, bucket_capacity: 100000 } });
  if (path === "/account/endpoint_costs") return Response.json({ default_cost: 10, endpoint_costs: [] });
  if (path === "/markets/REDIRECT") return Response.redirect(destination.url.toString());
  if (path.endsWith("/orderbook")) return Response.json({ orderbook_fp: { yes_dollars: [["0.60", "100.00"]], no_dollars: [["0.60", "100.00"]] } });
  if (path === "/portfolio/balance") return Response.json({ balance: 4321 });
  if (path === "/portfolio/settlements") return Response.json({ settlements: [{ revenue: 1000, yes_total_cost_dollars: "4.00", no_total_cost_dollars: "0.00", fee_cost: "0.20", settled_time: "2026-11-05T00:00:00Z" }], cursor: "" });
  return Response.json({ order: { order_id: "real-order" } });
} });
const clients: Client[] = [];
async function connect(extra: Record<string,string> = {}, data = "account") {
  const client = new Client({ name: "portable-fixture", version: "1" });
  const env = { PATH: process.env.PATH ?? "", KALSHI_MCP_TEST: "1", KALSHI_API_ID: "fixture-id", KALSHI_PRIVATE_KEY_PEM: key,
    KALSHI_BASE_URL: `${api.url}trade-api/v2`, KALSHI_MCP_CREDENTIALS_PATH: join(dir, "credentials.json"), KALSHI_MCP_DATA_DIR: join(dir, data), ...extra };
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", process.env.KALSHI_PORTABLE_TEST_ENTRY ?? join(import.meta.dir, "entry.ts")], cwd: dir, env, stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", chunk => stderr += chunk.toString());
  try { await client.connect(transport); } catch (error) { throw new Error(`Connection failed: ${stderr}`); }
  clients.push(client); return client;
}
async function call(client: Client, name: string, args: Record<string,unknown> = {}) { return client.callTool({ name, arguments: args }); }
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); requests.length = 0; });
afterAll(() => { api.stop(true); destination.stop(true); rmSync(dir, { recursive: true, force: true }); });

test("portable starts paper, never writes to exchange, and exports actual PNG files", async () => {
  const client = await connect();
  expect((await call(client, "trading_mode")).structuredContent).toMatchObject({ mode: "paper", balanceUsd: 10000 });
  expect((await call(client, "buy", { ticker: "T", side: "yes", count: 10, yes_price: 50 })).isError).not.toBe(true);
  expect((await call(client, "sell", { ticker: "T", side: "yes", count: 10, yes_price: 50 })).isError).not.toBe(true);
  expect((await call(client, "trading_mode")).structuredContent).toMatchObject({ balanceUsd: 10002, realizedPnlUsd: 2 });
  expect((await call(client, "balance")).structuredContent).toMatchObject({ mode: "paper", balance: 1000200 });
  expect((await call(client, "live_balance")).structuredContent).toMatchObject({ mode: "live", balance: 4321 });
  expect((await call(client, "set_trading_mode", { paper: false })).isError).toBe(true);
  expect((await call(client, "batch_cancel", { orderIds: ["real-id"] })).isError).toBe(true);
  const result = await call(client, "export_pnl_png", { source: "paper", startTs: Math.floor(Date.now()/1000) - 86400, endTs: Math.floor(Date.now()/1000) + 1 });
  expect(result.isError).not.toBe(true);
  const image = result.content as Array<{ type: string; data?: string }>;
  expect(image.some(c => c.type === "image")).toBe(true);
  const path = (result.structuredContent as any).path;
  expect(readFileSync(path).subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(requests.every(r => r.method === "GET")).toBe(true);
  const oldHistory = await call(client, "portfolio_history", { startTs: 1, endTs: 2 });
  expect((oldHistory.structuredContent as any).fills.fills).toHaveLength(0);
});

test("live opt-in requires fresh activation each connection; paper resumes on restart", async () => {
  const first = await connect({ KALSHI_MCP_ALLOW_LIVE: "1" }, "live");
  expect((await call(first, "set_trading_mode", { paper: false })).isError).not.toBe(true);
  expect((await call(first, "place_order", { ticker: "T", action: "buy", side: "yes", count: 1, yes_price: 40 })).structuredContent).toMatchObject({ mode: "live" });
  expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
  await first.close();
  const second = await connect({ KALSHI_MCP_ALLOW_LIVE: "1" }, "live");
  expect((await call(second, "trading_mode")).structuredContent).toMatchObject({ mode: "paper" });
  expect((await call(second, "buy", { ticker: "T", side: "yes", count: 1, yes_price: 50 })).structuredContent).toMatchObject({ mode: "paper" });
  expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
});

test("read-only candidate omits trading tools and returns net settlement PNG", async () => {
  const client = await connect({ KALSHI_MCP_READ_ONLY: "1", KALSHI_MCP_ALLOW_LIVE: "1" }, "readonly");
  const names = (await client.listTools()).tools.map(t => t.name);
  for (const name of ["buy", "sell", "place_order", "cancel_order", "amend_order", "batch_create", "batch_cancel", "set_trading_mode", "reset_paper_account", "history"]) expect(names).not.toContain(name);
  expect((await call(client, "balance")).structuredContent).toMatchObject({ mode: "live", balance: 4321 });
  const result = await call(client, "export_pnl_png", { source: "live-settlements", startTs: Date.parse("2026-11-01")/1000, endTs: Date.parse("2026-11-10")/1000 });
  expect(result.isError).not.toBe(true);
  expect(JSON.stringify(result.structuredContent)).toContain("5.8");
  expect(requests.every(r => r.method === "GET")).toBe(true);
});

test("API redirect never forwards signing headers", async () => {
  const client = await connect({}, "redirect");
  expect((await call(client, "market", { ticker: "REDIRECT" })).isError).toBe(true);
  expect(redirected).toBe(0);
});

test("credentials missing is actionable without accessing the API", async () => {
  const client = await connect({ KALSHI_API_ID: "", KALSHI_PRIVATE_KEY_PEM: "" }, "unconfigured");
  expect((await call(client, "connection_status")).structuredContent).toMatchObject({ configured: false, liveExecutionEnabled: false });
  expect((await call(client, "market", { ticker: "T" })).isError).toBe(true);
  expect((await call(client, "trading_mode")).isError).not.toBe(true);
  expect(requests).toHaveLength(0);
});
