import { Command } from "commander";
import {
  amendOrder,
  batchCancelOrders,
  batchCreateOrders,
  cancelOrder,
  getBalance,
  getEvent,
  getEvents,
  getExchangeStatus,
  getFills,
  getMarket,
  getMarketCandlesticks,
  getMarkets,
  getOrderbook,
  getOrders,
  getPortfolioHistory,
  getPositions,
  getSeries,
  getSettlements,
  getTrades,
  placeOrder,
  searchMarketsByTitle,
} from "../kalshi";
import { runLoggedCommand } from "./shared";

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

export function createKalshiCommand(): Command {
  const kalshi = new Command("kalshi").description("Kalshi trading and market commands");

  kalshi
    .command("balance")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      await runLoggedCommand({
        command: "kalshi balance",
        args: options,
        pretty: options.pretty,
        run: () => getBalance(),
      });
    });

  kalshi
    .command("positions")
    .option("--ticker <ticker>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        ticker: options.ticker,
        count: toNumber(options.limit),
        cursor: options.cursor,
      };
      await runLoggedCommand({
        command: "kalshi positions",
        args: params,
        pretty: options.pretty,
        run: () => getPositions(params),
      });
    });

  kalshi
    .command("settlements")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = { limit: toNumber(options.limit), cursor: options.cursor };
      await runLoggedCommand({
        command: "kalshi settlements",
        args: params,
        pretty: options.pretty,
        run: () => getSettlements(params),
      });
    });

  kalshi
    .command("markets")
    .option("--status <status>")
    .option("--ticker <ticker>")
    .option("--series <series>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--keyword <keyword>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        status: options.status,
        ticker: options.ticker,
        seriesTicker: options.series,
        limit: toNumber(options.limit),
        cursor: options.cursor,
      };

      const run = options.keyword
        ? () =>
            searchMarketsByTitle(options.keyword, {
              status: params.status,
              seriesTicker: params.seriesTicker,
              limit: params.limit,
              cursor: params.cursor,
            })
        : () => getMarkets(params);

      await runLoggedCommand({
        command: "kalshi markets",
        args: { ...params, keyword: options.keyword },
        pretty: options.pretty,
        run,
      });
    });

  kalshi
    .command("market <ticker>")
    .option("--pretty", "Print formatted output")
    .action(async (ticker, options) => {
      await runLoggedCommand({
        command: "kalshi market",
        args: { ticker },
        pretty: options.pretty,
        run: () => getMarket(ticker),
      });
    });

  kalshi
    .command("orderbook <ticker>")
    .option("--depth <depth>")
    .option("--pretty", "Print formatted output")
    .action(async (ticker, options) => {
      const depth = toNumber(options.depth);
      await runLoggedCommand({
        command: "kalshi orderbook",
        args: { ticker, depth },
        pretty: options.pretty,
        run: () => getOrderbook(ticker, depth),
      });
    });

  kalshi
    .command("place-order")
    .requiredOption("--ticker <ticker>")
    .requiredOption("--side <side>")
    .requiredOption("--type <type>")
    .requiredOption("--count <count>")
    .option("--yes-price <yesPrice>")
    .option("--no-price <noPrice>")
    .option("--expiration-ts <expirationTs>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        ticker: options.ticker,
        side: options.side,
        type: options.type,
        count: toNumber(options.count) ?? 0,
        yes_price: toNumber(options.yesPrice),
        no_price: toNumber(options.noPrice),
        expiration_ts: toNumber(options.expirationTs),
      };
      await runLoggedCommand({
        command: "kalshi place-order",
        args: params,
        pretty: options.pretty,
        run: () => placeOrder(params),
      });
    });

  kalshi
    .command("cancel-order <orderId>")
    .option("--pretty", "Print formatted output")
    .action(async (orderId, options) => {
      await runLoggedCommand({
        command: "kalshi cancel-order",
        args: { orderId },
        pretty: options.pretty,
        run: () => cancelOrder(orderId),
      });
    });

  kalshi
    .command("orders")
    .option("--ticker <ticker>")
    .option("--status <status>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        ticker: options.ticker,
        status: options.status,
        limit: toNumber(options.limit),
        cursor: options.cursor,
      };
      await runLoggedCommand({
        command: "kalshi orders",
        args: params,
        pretty: options.pretty,
        run: () => getOrders(params),
      });
    });

  kalshi
    .command("candlesticks")
    .requiredOption("--series <series>")
    .requiredOption("--ticker <ticker>")
    .requiredOption("--start <start>")
    .requiredOption("--end <end>")
    .requiredOption("--interval <interval>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        seriesTicker: options.series,
        ticker: options.ticker,
        startTs: toNumber(options.start) ?? 0,
        endTs: toNumber(options.end) ?? 0,
        periodInterval: toNumber(options.interval) ?? 0,
      };
      await runLoggedCommand({
        command: "kalshi candlesticks",
        args: params,
        pretty: options.pretty,
        run: () => getMarketCandlesticks(params),
      });
    });

  kalshi
    .command("trades <ticker>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--min-ts <minTs>")
    .option("--max-ts <maxTs>")
    .option("--pretty", "Print formatted output")
    .action(async (ticker, options) => {
      const params = {
        ticker,
        limit: toNumber(options.limit),
        cursor: options.cursor,
        minTs: toNumber(options.minTs),
        maxTs: toNumber(options.maxTs),
      };
      await runLoggedCommand({
        command: "kalshi trades",
        args: params,
        pretty: options.pretty,
        run: () => getTrades(params),
      });
    });

  kalshi
    .command("fills")
    .option("--ticker <ticker>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--min-ts <minTs>")
    .option("--max-ts <maxTs>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        ticker: options.ticker,
        limit: toNumber(options.limit),
        cursor: options.cursor,
        minTs: toNumber(options.minTs),
        maxTs: toNumber(options.maxTs),
      };
      await runLoggedCommand({
        command: "kalshi fills",
        args: params,
        pretty: options.pretty,
        run: () => getFills(params),
      });
    });

  kalshi
    .command("portfolio-history")
    .option("--start <start>")
    .option("--end <end>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        startTs: toNumber(options.start),
        endTs: toNumber(options.end),
      };
      await runLoggedCommand({
        command: "kalshi portfolio-history",
        args: params,
        pretty: options.pretty,
        run: () => getPortfolioHistory(params),
      });
    });

  kalshi
    .command("event <eventTicker>")
    .option("--pretty", "Print formatted output")
    .action(async (eventTicker, options) => {
      await runLoggedCommand({
        command: "kalshi event",
        args: { eventTicker },
        pretty: options.pretty,
        run: () => getEvent(eventTicker),
      });
    });

  kalshi
    .command("events")
    .option("--series <series>")
    .option("--status <status>")
    .option("--limit <limit>")
    .option("--cursor <cursor>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const params = {
        seriesTicker: options.series,
        status: options.status,
        limit: toNumber(options.limit),
        cursor: options.cursor,
      };
      await runLoggedCommand({
        command: "kalshi events",
        args: params,
        pretty: options.pretty,
        run: () => getEvents(params),
      });
    });

  kalshi
    .command("amend-order <orderId>")
    .option("--count <count>")
    .option("--yes-price <yesPrice>")
    .option("--no-price <noPrice>")
    .option("--pretty", "Print formatted output")
    .action(async (orderId, options) => {
      const params = {
        count: toNumber(options.count),
        yes_price: toNumber(options.yesPrice),
        no_price: toNumber(options.noPrice),
      };
      await runLoggedCommand({
        command: "kalshi amend-order",
        args: { orderId, ...params },
        pretty: options.pretty,
        run: () => amendOrder(orderId, params),
      });
    });

  kalshi
    .command("batch-create")
    .requiredOption("--orders <orders>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const orders = JSON.parse(options.orders) as Array<Record<string, unknown>>;
      await runLoggedCommand({
        command: "kalshi batch-create",
        args: { orderCount: orders.length },
        pretty: options.pretty,
        run: () => batchCreateOrders({ orders }),
      });
    });

  kalshi
    .command("batch-cancel")
    .requiredOption("--ids <ids>")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      const orderIds = String(options.ids)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      await runLoggedCommand({
        command: "kalshi batch-cancel",
        args: { orderIds },
        pretty: options.pretty,
        run: () => batchCancelOrders({ orderIds }),
      });
    });

  kalshi
    .command("series <seriesTicker>")
    .option("--pretty", "Print formatted output")
    .action(async (seriesTicker, options) => {
      await runLoggedCommand({
        command: "kalshi series",
        args: { seriesTicker },
        pretty: options.pretty,
        run: () => getSeries(seriesTicker),
      });
    });

  kalshi
    .command("exchange-status")
    .option("--pretty", "Print formatted output")
    .action(async (options) => {
      await runLoggedCommand({
        command: "kalshi exchange-status",
        args: {},
        pretty: options.pretty,
        run: () => getExchangeStatus(),
      });
    });

  return kalshi;
}
