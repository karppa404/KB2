import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

type Recorded = { method: string; path: string; query: Record<string, string>; body: any };
const requests: Recorded[] = [];
let failure = false;
let partial = false;
const server = Bun.serve({ port: 0, async fetch(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace("/trade-api/v2", "");
  const text = await req.text();
  const body = text ? JSON.parse(text) : null;
  requests.push({ method: req.method, path, query: Object.fromEntries(url.searchParams), body });
  if (path === "/account/limits") return Response.json({ usage_tier: "test", grants: [], read: { refill_rate: 100000, bucket_capacity: 100000 }, write: { refill_rate: 100000, bucket_capacity: 100000 } });
  if (path === "/account/endpoint_costs") return Response.json({ default_cost: 10, endpoint_costs: [] });
  if (failure) return Response.json({ error: "test rejection" }, { status: 400 });
  if (path === "/portfolio/orders/O") return Response.json({ order: { ticker: "T", book_side: "ask", initial_count_fp: "3.00", yes_price_dollars: "0.4000", exchange_index: 2 } });
  if (path.endsWith("/batched") && partial) return Response.json({ orders: [{ order_id: "ok" }, { error: { code: "insufficient_balance" } }] });
  if (path === "/portfolio/positions") return Response.json({ market_positions: [], cursor: "" });
  if (path === "/portfolio/fills") return Response.json({ fills: [], cursor: "" });
  if (path === "/portfolio/settlements") return Response.json({ settlements: [], cursor: "" });
  return Response.json({ fixture: "ok" });
} });
const dir = mkdtempSync(join(tmpdir(), "kb2-cli-"));
const env = { ...process.env, DB_PATH: join(dir, "history.db"), KALSHI_BASE_URL: `${server.url}trade-api/v2`, KALSHI_API_ID: "", KALSHI_PRIVATE_KEY: "", KALSHI_PRIVATE_KEY_PEM: "" };
async function cli(args: string[], overrides = {}) {
  const child = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], { cwd: join(import.meta.dir, "../.."), env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}
beforeEach(() => { requests.length = 0; failure = false; partial = false; });
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

const reads: Array<[string[], string, Record<string, string>]> = [
  [["limits"], "/account/limits", {}],
  [["endpoint-costs"], "/account/endpoint_costs", {}],
  [["balance"], "/portfolio/balance", {}],
  [["positions", "--ticker", "T", "--limit", "2", "--cursor", "C"], "/portfolio/positions", { ticker: "T", limit: "2", cursor: "C" }],
  [["settlements", "--limit", "2", "--cursor", "C"], "/portfolio/settlements", { limit: "2", cursor: "C" }],
  [["markets", "--ticker", "T", "--series", "S", "--status", "open", "--limit", "2", "--cursor", "C"], "/markets", { tickers: "T", series_ticker: "S", status: "open", limit: "2", cursor: "C" }],
  [["market", "T"], "/markets/T", {}],
  [["orderbook", "T", "--depth", "2"], "/markets/T/orderbook", { depth: "2" }],
  [["orders", "--ticker", "T", "--status", "resting", "--limit", "2", "--cursor", "C"], "/portfolio/orders", { ticker: "T", status: "resting", limit: "2", cursor: "C" }],
  [["candlesticks", "--series", "S", "--ticker", "T", "--start", "100", "--end", "200", "--interval", "1"], "/series/S/markets/T/candlesticks", { start_ts: "100", end_ts: "200", period_interval: "1" }],
  [["trades", "T", "--limit", "2", "--cursor", "C", "--min-ts", "100", "--max-ts", "200"], "/markets/trades", { ticker: "T", limit: "2", cursor: "C", min_ts: "100", max_ts: "200" }],
  [["fills", "--ticker", "T", "--limit", "2", "--cursor", "C", "--min-ts", "100", "--max-ts", "200"], "/portfolio/fills", { ticker: "T", limit: "2", cursor: "C", min_ts: "100", max_ts: "200" }],
  [["portfolio-history", "--start", "100", "--end", "200"], "/portfolio/settlements", { limit: "500", min_ts: "100", max_ts: "200" }],
  [["event", "E"], "/events/E", {}],
  [["events", "--series", "S", "--status", "open", "--limit", "2", "--cursor", "C"], "/events", { series_ticker: "S", status: "open", limit: "2", cursor: "C" }],
  [["series", "S"], "/series/S", {}],
  [["exchange-status"], "/exchange/status", {}],
];
for (const [args, path, query] of reads) test(`CLI read ${args[0]} forwards correct HTTP query`, async () => {
  const result = await cli(["kalshi", ...args]);
  expect(result.code, result.stderr).toBe(0);
  expect(() => JSON.parse(result.stdout)).not.toThrow();
  expect(requests.find(r => r.path === path)).toEqual({ method: "GET", path, query, body: null });
});

const order = { ticker: "T", action: "buy", side: "yes", count: 2, yes_price: 40 };
const writes: Array<[string[], string, string, any]> = [
  [["place-order", "--ticker", "T", "--action", "buy", "--side", "yes", "--count", "2", "--yes-price", "40", "--post-only"], "POST", "/portfolio/events/orders", { ticker: "T", side: "bid", count: "2.00", price: "0.4000", post_only: true, time_in_force: "good_till_canceled", self_trade_prevention_type: "taker_at_cross" }],
  [["buy", "T", "--side", "no", "--count", "2.5", "--no-price", "40"], "POST", "/portfolio/events/orders", { ticker: "T", side: "ask", count: "2.50", price: "0.6000" }],
  [["sell", "T", "--side", "yes", "--count", "2", "--yes-price", "40"], "POST", "/portfolio/events/orders", { side: "ask", reduce_only: true, time_in_force: "immediate_or_cancel" }],
  [["sell", "T", "--side", "no", "--count", "2", "--no-price", "40"], "POST", "/portfolio/events/orders", { side: "bid", price: "0.6000", reduce_only: true }],
  [["cancel-order", "O"], "DELETE", "/portfolio/events/orders/O", null],
  [["amend-order", "O", "--count", "4"], "POST", "/portfolio/events/orders/O/amend", { ticker: "T", side: "ask", count: "4.00", price: "0.4000", exchange_index: 2 }],
  [["batch-create", "--orders", JSON.stringify([order])], "POST", "/portfolio/events/orders/batched", { orders: [{ ticker: "T", side: "bid", count: "2.00", price: "0.4000", time_in_force: "good_till_canceled", self_trade_prevention_type: "taker_at_cross" }] }],
  [["batch-cancel", "--ids", " A, B "], "DELETE", "/portfolio/events/orders/batched", { orders: [{ order_id: "A" }, { order_id: "B" }] }],
];
for (const [args, method, path, body] of writes) test(`CLI write ${args.slice(0, 3).join(" ")} serializes V2 payload`, async () => {
  const result = await cli(["kalshi", ...args]);
  expect(result.code, result.stderr).toBe(0);
  expect(requests.find(r => r.method === method && r.path === path)).toMatchObject({ body });
});

test("every command provides help without sending requests", async () => {
  const commands = [...new Set([...reads, ...writes].map(([args]) => args[0]!))];
  for (const command of commands) {
    const result = await cli(["kalshi", command, "--help"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage:");
  }
  for (const args of [["history"], ["risk", "summary"], ["risk", "kelly"]]) expect((await cli([...args, "--help"])).code).toBe(0);
  expect(requests).toHaveLength(0);
});

test("missing required arguments and options fail locally", async () => {
  for (const args of [
    ["market"], ["orderbook"], ["place-order"], ["buy", "T"], ["sell", "T"], ["cancel-order"],
    ["candlesticks"], ["trades"], ["event"], ["amend-order"], ["batch-create"], ["batch-cancel"], ["series"],
  ]) expect((await cli(["kalshi", ...args])).code).not.toBe(0);
  expect(requests).toHaveLength(0);
});

test("malformed batches, invalid numbers and unknown commands fail without writes", async () => {
  for (const args of [
    ["kalshi", "batch-create", "--orders", "not-json"], ["kalshi", "batch-create", "--orders", "{}"],
    ["kalshi", "batch-create", "--orders", "[]"], ["kalshi", "batch-cancel", "--ids", " , "],
    ["kalshi", "markets", "--limit", "NaN"], ["history", "--limit", "1.5"], ["unknown"],
    ["kalshi", "buy", "T", "--side", "maybe", "--count", "1", "--yes-price", "20"],
  ]) expect((await cli(args)).code).not.toBe(0);
  expect(requests.filter(r => r.method !== "GET")).toHaveLength(0);
});

test("pretty output, failure exit codes and history preserve results and errors", async () => {
  const good = await cli(["kalshi", "balance", "--pretty"]);
  expect(good.stdout).toContain('\n  "fixture"');
  failure = true;
  const bad = await cli(["kalshi", "balance"]);
  expect(bad.code).toBe(1);
  expect(JSON.parse(bad.stderr)).toMatchObject({ command: "kalshi balance" });
  const history = await cli(["history", "--command", "kalshi balance", "--limit", "2"]);
  const rows = JSON.parse(history.stdout);
  expect(rows).toHaveLength(2);
  expect(rows[0].id).toBeGreaterThan(rows[1].id);
  expect(rows[0].error).toContain("400");
  expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
  expect(rows[1].result).toEqual({ fixture: "ok" });
});

test("partial batch errors remain visible in output and history", async () => {
  partial = true;
  const result = await cli(["kalshi", "batch-create", "--orders", JSON.stringify([order, order])]);
  expect(JSON.parse(result.stdout).orders[1].error.code).toBe("insufficient_balance");
  const history = await cli(["history", "--command", "kalshi batch-create", "--limit", "1"]);
  expect(JSON.parse(history.stdout)[0].result.orders[1].error.code).toBe("insufficient_balance");
});

test("unusable database fails before any request", async () => {
  expect((await cli(["kalshi", "balance"], { DB_PATH: dir })).code).not.toBe(0);
  expect(requests).toHaveLength(0);
});

test("malformed stored JSON remains readable and database persists across processes", async () => {
  const db = new Database(env.DB_PATH);
  db.run("INSERT INTO command_log(command, args, result) VALUES (?, ?, ?)", ["legacy", "raw", "not-json"]);
  db.close();
  const result = await cli(["history", "--command", "legacy"]);
  expect(JSON.parse(result.stdout)[0]).toMatchObject({ args: "raw", result: "not-json" });
});

test("compiled executable starts and runs local commands with configured history", async () => {
  const binary = join(dir, "kb2");
  const build = Bun.spawn([process.execPath, "build", "src/cli/index.ts", "--compile", "--outfile", binary], { stdout: "pipe", stderr: "pipe" });
  expect(await build.exited).toBe(0);
  for (const args of [["--help"], ["risk", "kelly", "--prob", "0.6", "--odds", "1", "--bankroll", "100"], ["history", "--limit", "1"]]) {
    const child = Bun.spawn([binary, ...args], { env, stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(output.length).toBeGreaterThan(0);
    if (args[0] === "risk") expect(JSON.parse(output).size).toBeCloseTo(10);
  }
});

test("read commands propagate HTTP failures with nonzero exit and logged errors", async () => {
  failure = true;
  for (const [args] of reads.filter(([args]) => !["limits", "endpoint-costs"].includes(args[0]!))) {
    const result = await cli(["kalshi", ...args]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr).error).toContain("400");
  }
});

test("order rejection is reported and never retried as a network failure", async () => {
  failure = true;
  const result = await cli(["kalshi", "buy", "T", "--side", "yes", "--count", "1", "--yes-price", "40"]);
  expect(result.code).toBe(1);
  expect(requests.filter(r => r.method === "POST")).toHaveLength(1);
});

test("order expiration and explicit time in force are forwarded", async () => {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const result = await cli(["kalshi", "buy", "T", "--side", "yes", "--count", "1", "--yes-price", "40", "--time-in-force", "good_till_canceled", "--expiration-ts", String(expiry)]);
  expect(result.code, result.stderr).toBe(0);
  expect(requests.find(r => r.method === "POST")?.body).toMatchObject({ expiration_time: expiry, time_in_force: "good_till_canceled" });
});

test("default read options omit unspecified query parameters", async () => {
  for (const name of ["positions", "settlements", "markets", "orders", "events", "fills"]) {
    requests.length = 0;
    expect((await cli(["kalshi", name])).code).toBe(0);
    expect(requests.at(-1)?.query).toEqual({});
  }
});
