import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventsApi, ordersApi, portfolioApi, placeOrder, cancelOrder, batchCancelOrders, searchMarketsByTitle } from "./kalshi";
import { getDashboardData } from "./dashboard/data";
import { getRiskSummary, kellySize } from "./risk";

afterEach(() => mock.restore());

test("Kelly sizing: positive edge, no edge, and empty bankroll", () => {
  expect(kellySize({ prob: 0.6, odds: 1, bankroll: 1000 })).toBeCloseTo(100);
  expect(kellySize({ prob: 0.4, odds: 1, bankroll: 1000 })).toBe(0);
  expect(kellySize({ prob: 0.6, odds: 0, bankroll: 1000 })).toBe(0);
  expect(kellySize({ prob: 0.6, odds: 1, bankroll: 0 })).toBe(0);
});

test("CLI startup, Kelly command, persisted history, and invalid input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kb2-test-"));
  const env = { ...process.env, DB_PATH: join(dir, "log.db") };
  async function cli(...args: string[]) {
    const child = Bun.spawn([process.execPath, "run", "src/cli/index.ts", ...args], {
      cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { stdout, stderr, code };
  }
  try {
    const help = await cli("--help");
    expect(help.code).toBe(0);
    expect(help.stdout).not.toContain("perplexity");
    expect((await cli("perplexity", "search", "test")).code).not.toBe(0);
    const kalshiHelp = await cli("kalshi", "--help");
    expect(kalshiHelp.stdout).toContain("endpoint-costs");
    expect(kalshiHelp.stdout).toContain("limits");
    const sizing = await cli("risk", "kelly", "--prob", "0.6", "--odds", "1", "--bankroll", "1000");
    expect(sizing.code).toBe(0);
    expect(JSON.parse(sizing.stdout).size).toBeCloseTo(100);
    const history = await cli("history", "--command", "risk kelly", "--limit", "1");
    expect(history.code).toBe(0);
    expect(JSON.parse(history.stdout)[0]).toMatchObject({ command: "risk kelly", args: { prob: 0.6 }, error: null });
    const invalid = await cli("risk", "kelly", "--prob", "oops", "--odds", "1", "--bankroll", "1000");
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).toContain("Invalid number for prob");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function portfolioFixture() {
  spyOn(portfolioApi, "getBalance").mockResolvedValue({ data: { balance: 10000, portfolio_value: 3000 } } as never);
  spyOn(portfolioApi, "getPositions").mockResolvedValue({ data: { market_positions: [
    { ticker: "A", position_fp: "2.00", market_exposure_dollars: "20.00", realized_pnl_dollars: "5.00", fees_paid_dollars: "1.00", total_traded_dollars: "40.00", resting_orders_count: 1 },
    { ticker: "B", position_fp: "-1.00", market_exposure_dollars: "10.00", realized_pnl_dollars: "-2.00", fees_paid_dollars: "0.50", total_traded_dollars: "20.00", resting_orders_count: 0 },
  ] } } as never);
  spyOn(portfolioApi, "getFills").mockResolvedValue({ data: { fills: [{}, {}] } } as never);
}

test("dashboard calculates exposure, dollars, fees, and win rate", async () => {
  portfolioFixture();
  const data = await getDashboardData();
  expect(data.account).toEqual({ cash: 100, portfolioValue: 30, equity: 130 });
  expect(data.pnl).toEqual({ realized: 3, fees: 1.5, net: 1.5, returnPct: 0.025 });
  expect(data.positions.totalExposure).toBe(30);
  expect(data.positions.activeCount).toBe(2);
  expect(data.positions.largest?.ticker).toBe("A");
  expect(data.edge.winRate).toBe(0.5);
  expect(data.edge.recentFillCount).toBe(2);
  expect(data.risk.exposureRatio).toBeCloseTo(30 / 130);
});

test("dashboard handles an empty portfolio", async () => {
  spyOn(portfolioApi, "getBalance").mockResolvedValue({ data: { balance: 0, portfolio_value: 0 } } as never);
  spyOn(portfolioApi, "getPositions").mockResolvedValue({ data: { market_positions: [] } } as never);
  spyOn(portfolioApi, "getFills").mockResolvedValue({ data: { fills: [] } } as never);
  const data = await getDashboardData();
  expect(data.positions.largest).toBeNull();
  expect(data.risk.exposureRatio).toBe(0);
  expect(data.edge.expectancy).toBe(0);
  expect(await getRiskSummary()).toEqual({
    totalExposure: 0, netPnl: 0, largestPosition: null,
    positionCount: 0, availableCash: 0, exposureRatio: 0,
  });
});

test("risk summary recognizes the installed SDK's position fields", async () => {
  portfolioFixture();
  const summary = await getRiskSummary();
  expect(summary).toEqual({
    totalExposure: 30, netPnl: 1.5, largestPosition: { ticker: "A", value: 20 },
    positionCount: 2, availableCash: 100, exposureRatio: 30 / 130,
  });
});

test("risk and dashboard prefer dollar balances, including zero", async () => {
  portfolioFixture();
  for (const cash of [12.5, 0]) {
    spyOn(portfolioApi, "getBalance").mockResolvedValue({
      data: { balance_dollars: String(cash), balance: 10000, portfolio_value: 0 },
    } as never);
    expect((await getRiskSummary()).availableCash).toBe(cash);
    expect((await getDashboardData()).account.cash).toBe(cash);
  }
});

test("risk counts absolute exposure and retains negative net P&L", async () => {
  portfolioFixture();
  spyOn(portfolioApi, "getPositions").mockResolvedValue({ data: { market_positions: [
    { ticker: "SHORT", market_exposure_dollars: "-20", realized_pnl_dollars: "-5", fees_paid_dollars: "1" },
    { ticker: "LONG", market_exposure_dollars: "10", realized_pnl_dollars: "0", fees_paid_dollars: "0" },
  ] } } as never);
  const summary = await getRiskSummary();
  expect(summary.totalExposure).toBe(30);
  expect(summary.largestPosition).toEqual({ ticker: "SHORT", value: 20 });
  expect(summary.netPnl).toBe(-6);
});

test("market search matches event titles, filters status, and deduplicates pages", async () => {
  const api = spyOn(eventsApi, "getEvents")
    .mockResolvedValueOnce({ data: { cursor: "next", events: [{ title: "Weather", markets: [
      { ticker: "A", status: "active" }, { ticker: "CLOSED", status: "finalized" },
    ] }] } } as never)
    .mockResolvedValueOnce({ data: { cursor: "", events: [{ title: "Weather", markets: [
      { ticker: "A", status: "active" }, { ticker: "B", status: "active" },
    ] }] } } as never);
  const result = await searchMarketsByTitle(" WEATHER ", { limit: 2 });
  expect(result.markets.map(m => m.ticker)).toEqual(["A", "B"]);
  expect(api).toHaveBeenCalledTimes(2);
  expect(api.mock.calls[1]?.[1]).toBe("next");
});

test("order creation and cancellation forward requests using mocked SDK calls", async () => {
  const create = spyOn(ordersApi, "createOrderV2").mockResolvedValue({ data: { order: { order_id: "test-order" } } } as never);
  const cancel = spyOn(ordersApi, "cancelOrderV2").mockResolvedValue({ data: { order: { order_id: "test-order" } } } as never);
  const params = { ticker: "TEST", action: "buy", side: "yes", count: 1, yes_price: 20 };
  expect(await placeOrder(params)).toMatchObject({ order: { order_id: "test-order" } });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ ticker: "TEST", side: "bid", count: "1.00", price: "0.2000" }));
  await cancelOrder("test-order");
  expect(cancel).toHaveBeenCalledWith("test-order");
  const batchCancel = spyOn(ordersApi, "batchCancelOrdersV2").mockResolvedValue({ data: {} } as never);
  await batchCancelOrders({ orderIds: ["test-order"] });
  expect(batchCancel).toHaveBeenCalledWith({ orders: [{ order_id: "test-order" }] });
});
