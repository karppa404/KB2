import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { eventsApi, portfolioApi, ordersApi, searchMarketsByTitle, getAllPositions, getPortfolioHistory, placeOrder, amendOrder, batchCreateOrders } from "./index";
import { getRiskSummary, kellySize } from "../risk";
afterEach(() => mock.restore());
const reply = (data: unknown) => ({ data }) as never;
const market = (ticker: string, extra = {}) => ({ ticker, status: "active", title: ticker, ...extra });

test("search continuation does not skip matches in the same API page", async () => {
  const api = spyOn(eventsApi, "getEvents").mockResolvedValue(reply({ cursor: "", events: [{ title: "Weather", markets: [market("A"), market("B"), market("C")] }] }));
  const first = await searchMarketsByTitle("weather", { limit: 1 });
  const second = await searchMarketsByTitle("weather", { limit: 1, cursor: first.cursor });
  const third = await searchMarketsByTitle("weather", { limit: 1, cursor: second.cursor });
  expect([...first.markets, ...second.markets, ...third.markets].map(m => m.ticker)).toEqual(["A", "B", "C"]);
  expect((await searchMarketsByTitle("weather", { cursor: third.cursor })).markets).toEqual([]);
  expect(api).toHaveBeenCalledTimes(4);
  await expect(searchMarketsByTitle("other", { cursor: first.cursor })).rejects.toThrow("cursor");
});

test("search matches market text, aliases status and handles no matches", async () => {
  const api = spyOn(eventsApi, "getEvents").mockResolvedValue(reply({ events: [{ title: "Other", markets: [market("A", { rules_primary: "WEATHER" }), market("B", { title: "weather", status: "finalized" })] }] }));
  expect((await searchMarketsByTitle(" Weather ")).markets.map(m => m.ticker)).toEqual(["A"]);
  expect((await searchMarketsByTitle("weather", { status: "settled" })).markets.map(m => m.ticker)).toEqual(["B"]);
  expect(api.mock.calls[1]?.[4]).toBe("settled");
  expect((await searchMarketsByTitle("missing")).markets).toEqual([]);
  await expect(searchMarketsByTitle("x", { limit: -1 })).rejects.toThrow();
});

test("search page cap bounds scans with no matches and propagates failures", async () => {
  const api = spyOn(eventsApi, "getEvents").mockResolvedValue(reply({ cursor: "next", events: [] }));
  expect((await searchMarketsByTitle("missing")).markets).toEqual([]);
  expect(api).toHaveBeenCalledTimes(10);
  api.mockRejectedValue(new Error("API down"));
  await expect(searchMarketsByTitle("x")).rejects.toThrow("API down");
});

test("portfolio history paginates both feeds and applies both date boundaries", async () => {
  const fills = spyOn(portfolioApi, "getFills").mockResolvedValueOnce(reply({ cursor: "F", fills: [{ id: 1 }] })).mockResolvedValueOnce(reply({ cursor: "", fills: [{ id: 2 }] }));
  const settlements = spyOn(portfolioApi, "getSettlements").mockResolvedValueOnce(reply({ cursor: "S", settlements: [{ id: 3 }] })).mockResolvedValueOnce(reply({ cursor: "", settlements: [{ id: 4 }] }));
  const result = await getPortfolioHistory({ startTs: 100, endTs: 200 });
  expect(result.fills.fills).toHaveLength(2);
  expect(result.settlements.settlements).toHaveLength(2);
  expect(fills.mock.calls[1]?.slice(2, 6)).toEqual([100, 200, 500, "F"]);
  expect(settlements.mock.calls[1]?.slice(0, 6)).toEqual([500, "S", undefined, undefined, 100, 200]);
  await expect(getPortfolioHistory({ startTs: 200, endTs: 100 })).rejects.toThrow();
});

test("all positions detects repeated cursors instead of hanging", async () => {
  spyOn(portfolioApi, "getPositions").mockResolvedValue(reply({ cursor: "same", market_positions: [] }));
  await expect(getAllPositions()).rejects.toThrow("repeated pagination cursor");
});

test("risk includes all position pages", async () => {
  const rows = Array.from({ length: 35 }, (_, i) => ({ ticker: `T${i}`, position_fp: "1.00", market_exposure_dollars: "2.00", realized_pnl_dollars: i < 20 ? "3" : "-1", fees_paid_dollars: "0.1", total_traded_dollars: "10", resting_orders_count: 1 }));
  spyOn(portfolioApi, "getPositions").mockImplementation(async cursor => reply({ cursor: cursor ? "" : "next", market_positions: cursor ? rows.slice(20) : rows.slice(0, 20) }));
  spyOn(portfolioApi, "getBalance").mockResolvedValue(reply({ balance_dollars: "100", portfolio_value: 7000 }));
  spyOn(portfolioApi, "getFills").mockResolvedValue(reply({ fills: [{}, {}] }));
  const risk = await getRiskSummary();
  expect(risk.positionCount).toBe(35);
  expect(risk.totalExposure).toBe(70);
  expect(risk.netPnl).toBeCloseTo(41.5);
});

test("Kelly bounds, fractional sizing and invalid numbers", () => {
  expect(kellySize({ prob: 1, odds: 1, bankroll: 100, fraction: 1 })).toBe(100);
  expect(kellySize({ prob: 0, odds: 1, bankroll: 100 })).toBe(0);
  expect(kellySize({ prob: 0.75, odds: 1, bankroll: 100, fraction: 0.25 })).toBe(12.5);
  for (const input of [{ prob: -0.1 }, { prob: 1.1 }, { prob: NaN }, { odds: Infinity }, { bankroll: -1 }, { fraction: 2 }]) {
    expect(() => kellySize({ prob: 0.6, odds: 1, bankroll: 100, ...input })).toThrow();
  }
});

test("orders reject invalid prices/counts/flags without calling the SDK", async () => {
  const api = spyOn(ordersApi, "createOrderV2");
  const base = { ticker: "T", action: "buy", side: "yes", count: 1, yes_price: 20 };
  for (const changes of [{ count: -1 }, { count: 0.001 }, { yes_price: 100 }, { yes_price: NaN }, { no_price: 80 }, { buy_max_cost: 100 }, { reduce_only: true, time_in_force: "good_till_canceled" }, { expiration_ts: 1 }, { post_only: true, time_in_force: "immediate_or_cancel" }]) {
    await expect(placeOrder({ ...base, ...changes })).rejects.toThrow();
  }
  expect(api).not.toHaveBeenCalled();
});

test("batch validation is atomic and amends preserve existing direction", async () => {
  const batch = spyOn(ordersApi, "batchCreateOrdersV2");
  await expect(batchCreateOrders({ orders: [{ ticker: "T", action: "buy", side: "yes", count: 1, yes_price: 20 }, {}] })).rejects.toThrow();
  expect(batch).not.toHaveBeenCalled();
  spyOn(ordersApi, "getOrder").mockResolvedValue(reply({ order: { ticker: "T", book_side: "bid", initial_count_fp: "4", yes_price_dollars: "0.4" } }));
  const amend = spyOn(ordersApi, "amendOrderV2").mockResolvedValue(reply({}));
  await amendOrder("O", { no_price: 70 });
  expect(amend).toHaveBeenCalledWith("O", expect.objectContaining({ ticker: "T", side: "bid", count: "4.00", price: "0.3000" }));
});

test("search continuation deduplicates overlapping upstream pages", async () => {
  spyOn(eventsApi, "getEvents").mockImplementation(async (_limit, cursor) => reply({ cursor: cursor ? "" : "next", events: [{ title: "Weather", markets: cursor ? [market("A"), market("B")] : [market("A")] }] }));
  const first = await searchMarketsByTitle("weather", { limit: 1 });
  const second = await searchMarketsByTitle("weather", { limit: 1, cursor: first.cursor });
  expect(first.markets.map(m => m.ticker)).toEqual(["A"]);
  expect(second.markets.map(m => m.ticker)).toEqual(["B"]);
});
