import {
  AccountApi,
  CommunicationsApi,
  Configuration,
  type EventData,
  EventsApi,
  ExchangeApi,
  type Market,
  type CreateOrderV2Request,
  MarketApi,
  OrdersApi,
  PortfolioApi,
} from "kalshi-typescript";
import axios from "axios";
import { z } from "zod";
import { installRateLimitChecks, installRateLimitRetry } from "./rate-limit";

const config = new Configuration({
  apiKey: Bun.env.KALSHI_API_ID!,
  privateKeyPath: Bun.env.KALSHI_PRIVATE_KEY,
  privateKeyPem: Bun.env.KALSHI_PRIVATE_KEY_PEM,
  basePath: Bun.env.KALSHI_BASE_URL ?? "https://external-api.kalshi.com/trade-api/v2",
});

const http = axios.create({ timeout: 30_000 });
// Metadata uses its own transport to avoid recursively checking its own limits.
const accountHttp = axios.create({ timeout: 30_000 });
export const accountApi = new AccountApi(config, undefined, accountHttp);
export const portfolioApi = new PortfolioApi(config, undefined, http);
export const marketsApi = new MarketApi(config, undefined, http);
export const ordersApi = new OrdersApi(config, undefined, http);
export const eventsApi = new EventsApi(config, undefined, http);
export const exchangeApi = new ExchangeApi(config, undefined, http);
export const communicationsApi = new CommunicationsApi(config, undefined, http);

installRateLimitRetry(accountHttp);
installRateLimitRetry(http);
installRateLimitChecks(http, async () => ({
  limits: await getAccountLimits(),
  costs: await getEndpointCosts(),
}));

export async function getAccountLimits() {
  return (await accountApi.getAccountApiLimits()).data;
}

export async function getEndpointCosts() {
  return (await accountApi.getAccountEndpointCosts()).data;
}

export async function getBalance() {
  const response = await portfolioApi.getBalance();
  return response.data;
}

export async function getPositions(params?: {
  ticker?: string;
  count?: number;
  cursor?: string;
}) {
  const response = await portfolioApi.getPositions(
    params?.cursor,
    params?.count,
    undefined,
    undefined,
    params?.ticker,
    undefined,
    undefined,
  );
  return response.data;
}

export async function getSettlements(params?: { limit?: number; cursor?: string; minTs?: number; maxTs?: number }) {
  const response = await portfolioApi.getSettlements(
    params?.limit,
    params?.cursor,
    undefined,
    undefined,
    params?.minTs,
    params?.maxTs,
    undefined,
  );
  return response.data;
}

export async function getMarkets(params?: {
  status?: string;
  ticker?: string;
  seriesTicker?: string;
  limit?: number;
  cursor?: string;
}) {
  const response = await marketsApi.getMarkets(
    params?.limit,
    params?.cursor,
    undefined,
    params?.seriesTicker,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    params?.status as never,
    params?.ticker,
    undefined,
  );
  return response.data;
}

export async function searchMarketsByTitle(
  keyword: string,
  params?: {
    status?: string;
    seriesTicker?: string;
    limit?: number;
    cursor?: string;
  },
) {
  const normalized = keyword.trim().toLowerCase();
  const requestedLimit = params?.limit ?? 100;
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) throw new Error("Search limit must be a positive integer");
  const status = params?.status ?? "open";
  const eventStatus = toEventStatus(status);
  const matches: Array<Market & { event_title?: string; event_sub_title?: string }> = [];
  const seenTickers = new Set<string>();
  let cursor = params?.cursor;
  let offset = 0;
  if (cursor?.startsWith("kb2:")) {
    const saved = JSON.parse(Buffer.from(cursor.slice(4), "base64url").toString());
    if (saved.keyword !== normalized || saved.status !== status || saved.series !== (params?.seriesTicker ?? "") || !Number.isInteger(saved.offset) || saved.offset < 0 || typeof saved.cursor !== "string" || !Array.isArray(saved.seen) || saved.seen.some((ticker: unknown) => typeof ticker !== "string")) throw new Error("Invalid search cursor for these filters");
    cursor = saved.cursor || undefined;
    offset = saved.offset;
    saved.seen.forEach((ticker: string) => seenTickers.add(ticker));
  }

  for (let page = 0; page < 10 && matches.length < requestedLimit; page += 1) {
    const response = await eventsApi.getEvents(
      200,
      cursor,
      true,
      undefined,
      eventStatus as never,
      params?.seriesTicker,
      undefined,
      undefined,
    );

    const events = Array.isArray(response.data.events) ? response.data.events : [];
    let index = 0;
    for (const event of events) {
      for (const market of getMatchingMarkets(event, normalized, status)) {
        if (index++ < offset) continue;
        if (seenTickers.has(market.ticker)) continue;
        seenTickers.add(market.ticker);
        matches.push({
          ...market,
          event_title: event.title,
          event_sub_title: event.sub_title,
        });
        if (matches.length >= requestedLimit) {
          return {
            cursor: "kb2:" + Buffer.from(JSON.stringify({ cursor: cursor ?? "", offset: index, keyword: normalized, status, series: params?.seriesTicker ?? "", seen: [...seenTickers] })).toString("base64url"),
            markets: matches, searchKeyword: keyword, totalMatches: matches.length,
          };
        }
      }
      if (matches.length >= requestedLimit) break;
    }

    cursor = response.data.cursor || undefined;
    offset = 0;
    if (!cursor) break;
  }

  return {
    cursor: cursor ? "kb2:" + Buffer.from(JSON.stringify({ cursor, offset: 0, keyword: normalized, status, series: params?.seriesTicker ?? "", seen: [...seenTickers] })).toString("base64url") : "",
    markets: matches,
    searchKeyword: keyword,
    totalMatches: matches.length,
  };
}

function getMatchingMarkets(
  event: EventData,
  normalizedKeyword: string,
  status: string,
): Array<Market> {
  const eventMatches = includesKeyword(
    [event.event_ticker, event.series_ticker, event.title, event.sub_title],
    normalizedKeyword,
  );
  const markets = Array.isArray(event.markets) ? event.markets : [];

  return markets.filter((market) => {
    if (!marketMatchesStatus(market, status)) return false;
    if (eventMatches) return true;
    return includesKeyword(
      [
        market.ticker,
        market.event_ticker,
        market.title,
        market.subtitle,
        market.yes_sub_title,
        market.no_sub_title,
        market.rules_primary,
        market.rules_secondary,
      ],
      normalizedKeyword,
    );
  });
}

function marketMatchesStatus(market: Market, status: string): boolean {
  if (status === "active") return market.status === "active";
  if (status === "open") return market.status === "active";
  if (status === "finalized") return market.status === "finalized";
  if (status === "settled") return market.status === "finalized";
  return market.status === status;
}

function toEventStatus(status: string): string {
  if (status === "active") return "open";
  if (status === "finalized") return "settled";
  return status;
}

function includesKeyword(values: Array<unknown>, normalizedKeyword: string): boolean {
  return values.some(
    (value) =>
      typeof value === "string" && value.toLowerCase().includes(normalizedKeyword),
  );
}

export async function getMarket(ticker: string) {
  const response = await marketsApi.getMarket(ticker);
  return response.data;
}

export async function getOrderbook(ticker: string, depth?: number) {
  const response = await marketsApi.getMarketOrderbook(ticker, depth);
  return response.data;
}

export const orderSchema = z.object({
  ticker: z.string().trim().min(1),
  action: z.enum(["buy", "sell"]),
  side: z.enum(["yes", "no"]),
  count: z.number().positive().refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8, "Count supports at most two decimals"),
  yes_price: z.number().gt(0).lt(100).optional(),
  no_price: z.number().gt(0).lt(100).optional(),
  expiration_ts: z.number().int().positive().optional(),
  time_in_force: z.enum(["good_till_canceled", "immediate_or_cancel", "fill_or_kill"]).optional(),
  buy_max_cost: z.number().optional(),
  reduce_only: z.boolean().optional(),
  post_only: z.boolean().optional(),
}).strict();

function orderPayload(input: unknown): CreateOrderV2Request {
  const params = orderSchema.parse(input);
  if ((params.yes_price === undefined) === (params.no_price === undefined)) {
    throw new Error("Provide exactly one of yes_price or no_price (in cents)");
  }
  if (params.buy_max_cost !== undefined) throw new Error("buy_max_cost is not supported by Kalshi V2; use an explicit limit price and count");
  const timeInForce = params.time_in_force ?? (params.reduce_only ? "immediate_or_cancel" : "good_till_canceled");
  if (params.reduce_only && timeInForce !== "immediate_or_cancel") throw new Error("reduce_only requires immediate_or_cancel");
  if (params.expiration_ts !== undefined && (params.expiration_ts <= Date.now() / 1000 || timeInForce !== "good_till_canceled")) {
    throw new Error("expiration_ts must be in the future and requires good_till_canceled");
  }
  if (params.post_only && timeInForce !== "good_till_canceled") throw new Error("post_only requires good_till_canceled");
  const price = (params.yes_price ?? (100 - params.no_price!)) / 100;
  if (Math.abs(price * 10000 - Math.round(price * 10000)) > 1e-8) throw new Error("Price supports at most four dollar decimals");
  return {
    ticker: params.ticker,
    side: (params.action === "buy") === (params.side === "yes") ? "bid" : "ask",
    count: params.count.toFixed(2), price: price.toFixed(4),
    time_in_force: timeInForce, self_trade_prevention_type: "taker_at_cross",
    expiration_time: params.expiration_ts, reduce_only: params.reduce_only, post_only: params.post_only,
  };
}

export async function placeOrder(params: {
  ticker: string;
  action: string;
  side: string;
  count: number;
  yes_price?: number;
  no_price?: number;
  expiration_ts?: number;
  time_in_force?: string;
  buy_max_cost?: number;
  reduce_only?: boolean;
  post_only?: boolean;
}) {
  const response = await ordersApi.createOrderV2(orderPayload(params));
  return response.data;
}

export async function cancelOrder(orderId: string) {
  const response = await ordersApi.cancelOrderV2(orderId);
  return response.data;
}

export async function getOrders(params?: {
  ticker?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}) {
  const response = await ordersApi.getOrders(
    params?.ticker,
    undefined,
    undefined,
    undefined,
    params?.status,
    params?.limit,
    params?.cursor,
    undefined,
  );
  return response.data;
}

export async function getMarketCandlesticks(params: {
  seriesTicker: string;
  ticker: string;
  startTs: number;
  endTs: number;
  periodInterval: number;
}) {
  const response = await marketsApi.getMarketCandlesticks(
    params.seriesTicker,
    params.ticker,
    params.startTs,
    params.endTs,
    params.periodInterval as never,
    undefined,
  );
  return response.data;
}

export async function getTrades(params: {
  ticker: string;
  limit?: number;
  cursor?: string;
  minTs?: number;
  maxTs?: number;
}) {
  const response = await marketsApi.getTrades(
    params.limit,
    params.cursor,
    params.ticker,
    params.minTs,
    params.maxTs,
  );
  return response.data;
}

export async function getFills(params?: {
  ticker?: string;
  limit?: number;
  cursor?: string;
  minTs?: number;
  maxTs?: number;
}) {
  const response = await portfolioApi.getFills(
    params?.ticker,
    undefined,
    params?.minTs,
    params?.maxTs,
    params?.limit,
    params?.cursor,
    undefined,
  );
  return response.data;
}

export async function getPortfolioHistory(params?: { startTs?: number; endTs?: number }) {
  if (params?.startTs !== undefined && params?.endTs !== undefined && params.startTs > params.endTs) throw new Error("Start timestamp must not exceed end timestamp");
  const range = { minTs: params?.startTs, maxTs: params?.endTs, limit: 500 };
  const fills = { fills: await collectPages(async cursor => {
    const page = await getFills({ ...range, cursor });
    return { cursor: page.cursor, items: page.fills ?? [] };
  }), cursor: "" };
  const settlements = { settlements: await collectPages(async cursor => {
    const page = await getSettlements({ ...range, cursor });
    return { cursor: page.cursor, items: page.settlements ?? [] };
  }), cursor: "" };
  return {
    startTs: params?.startTs,
    endTs: params?.endTs,
    fills,
    settlements,
  };
}

async function collectPages<T>(load: (cursor?: string) => Promise<{ cursor?: string; items: T[] }>): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.cursor || undefined;
    if (cursor && seen.has(cursor)) throw new Error("Kalshi returned a repeated pagination cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

export async function getAllPositions() {
  return { market_positions: await collectPages(async cursor => {
    const page = await getPositions({ cursor, count: 1000 });
    return { cursor: page.cursor, items: page.market_positions ?? [] };
  }) };
}

export async function getEvent(eventTicker: string) {
  const response = await eventsApi.getEvent(eventTicker, undefined);
  return response.data;
}

export async function getEvents(params?: {
  status?: string;
  seriesTicker?: string;
  limit?: number;
  cursor?: string;
}) {
  const response = await eventsApi.getEvents(
    params?.limit,
    params?.cursor,
    undefined,
    undefined,
    params?.status as never,
    params?.seriesTicker,
    undefined,
    undefined,
  );
  return response.data;
}

export async function amendOrder(
  orderId: string,
  params: { count?: number; yes_price?: number; no_price?: number },
) {
  if (params.count === undefined && params.yes_price === undefined && params.no_price === undefined) throw new Error("Provide a count or price to amend");
  if (params.yes_price !== undefined && params.no_price !== undefined) throw new Error("Provide only one price");
  const current = (await ordersApi.getOrder(orderId)).data.order;
  const payload = orderPayload({
    ticker: current.ticker, action: "buy", side: current.book_side === "bid" ? "yes" : "no",
    count: params.count ?? Number(current.initial_count_fp),
    yes_price: params.yes_price ?? (params.no_price === undefined ? Number(current.yes_price_dollars) * 100 : undefined),
    no_price: params.no_price,
  });
  const response = await ordersApi.amendOrderV2(orderId, {
    ticker: payload.ticker, side: payload.side, count: payload.count, price: payload.price,
    exchange_index: current.exchange_index,
  });
  return response.data;
}

export async function batchCreateOrders(params: { orders: Array<Record<string, unknown>> }) {
  if (!Array.isArray(params.orders) || params.orders.length === 0) throw new Error("Order batch must be a nonempty array");
  const response = await ordersApi.batchCreateOrdersV2({ orders: params.orders.map(orderPayload) });
  return response.data;
}

export async function batchCancelOrders(params: { orderIds: string[] }) {
  if (!Array.isArray(params.orderIds) || !params.orderIds.length || params.orderIds.some(id => typeof id !== "string" || !id.trim())) throw new Error("Order IDs must be a nonempty array of strings");
  const response = await ordersApi.batchCancelOrdersV2({ orders: params.orderIds.map(order_id => ({ order_id })) });
  return response.data;
}

export async function getSeries(seriesTicker: string) {
  const response = await marketsApi.getSeries(seriesTicker);
  return response.data;
}

export async function getExchangeStatus() {
  const response = await exchangeApi.getExchangeStatus();
  return response.data;
}
