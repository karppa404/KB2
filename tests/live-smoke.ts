// Explicit opt-in read-only integration check; never places or modifies orders.
import * as k from "../src/kalshi";
import { getRiskSummary } from "../src/risk";
import { getDashboardData } from "../src/dashboard/data";
if (Bun.env.KB2_LIVE_TESTS !== "1") throw new Error("Set KB2_LIVE_TESTS=1 to run authenticated read-only checks");
let failed = 0;
async function check<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
  try { const result = await run(); console.log(`${name}: PASS`); return result; }
  catch (error) { failed++; console.log(`${name}: FAIL (${error instanceof Error ? error.message : String(error)})`); }
}
await check("limits", k.getAccountLimits);
await check("endpoint costs", k.getEndpointCosts);
await check("balance", k.getBalance);
await check("positions", () => k.getPositions({ count: 2 }));
await check("orders", () => k.getOrders({ limit: 2 }));
await check("fills", () => k.getFills({ limit: 2 }));
await check("settlements", () => k.getSettlements({ limit: 2 }));
await check("portfolio history", () => k.getPortfolioHistory({ startTs: Math.floor(Date.now() / 1000) - 3600, endTs: Math.floor(Date.now() / 1000) }));
await check("markets", () => k.getMarkets({ limit: 2, status: "open" }));
const events = await check("events", () => k.getEvents({ limit: 1, status: "open" }));
const event = events?.events[0];
if (event) {
  const detail = await check("event", () => k.getEvent(event.event_ticker));
  await check("series", () => k.getSeries(event.series_ticker));
  const ticker = detail?.markets?.[0]?.ticker;
  if (ticker) {
    await check("market", () => k.getMarket(ticker));
    await check("orderbook", () => k.getOrderbook(ticker, 2));
    await check("trades", () => k.getTrades({ ticker, limit: 2 }));
    await check("candlesticks", () => k.getMarketCandlesticks({ seriesTicker: event.series_ticker, ticker, startTs: Math.floor(Date.now() / 1000) - 3600, endTs: Math.floor(Date.now() / 1000), periodInterval: 1 }));
    await check("search", () => k.searchMarketsByTitle(ticker, { seriesTicker: event.series_ticker, limit: 1 }));
  } else { failed++; console.log("market-dependent checks: BLOCKED (no market found)"); }
} else { failed++; console.log("event-dependent checks: BLOCKED (no event found)"); }
await check("exchange", k.getExchangeStatus);
await check("risk", getRiskSummary);
await check("dashboard", getDashboardData);
process.exitCode = failed ? 1 : 0;
