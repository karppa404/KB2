import {
  CommunicationsApi,
  Configuration,
  type EventData,
  EventsApi,
  ExchangeApi,
  type Market,
  MarketApi,
  OrdersApi,
  PortfolioApi,
} from "kalshi-typescript";

const config = new Configuration({
  apiKey: Bun.env.KALSHI_API_ID!,
  privateKeyPath: Bun.env.KALSHI_PRIVATE_KEY,
  privateKeyPem: Bun.env.KALSHI_PRIVATE_KEY_PEM,
  basePath: "https://external-api.kalshi.com/trade-api/v2",
});

export const portfolioApi = new PortfolioApi(config);
export const marketsApi = new MarketApi(config);
export const ordersApi = new OrdersApi(config);
export const eventsApi = new EventsApi(config);
export const exchangeApi = new ExchangeApi(config);
export const communicationsApi = new CommunicationsApi(config);

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
    params?.ticker,
    undefined,
    undefined,
  );
  return response.data;
}

export async function getSettlements(params?: { limit?: number; cursor?: string }) {
  const response = await portfolioApi.getSettlements(
    params?.limit,
    params?.cursor,
    undefined,
    undefined,
    undefined,
    undefined,
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
  const status = params?.status ?? "open";
  const eventStatus = toEventStatus(status);
  const matches: Array<Market & { event_title?: string; event_sub_title?: string }> = [];
  const seenTickers = new Set<string>();
  let cursor = params?.cursor;

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
    for (const event of events) {
      for (const market of getMatchingMarkets(event, normalized, status)) {
        if (seenTickers.has(market.ticker)) continue;
        seenTickers.add(market.ticker);
        matches.push({
          ...market,
          event_title: event.title,
          event_sub_title: event.sub_title,
        });
        if (matches.length >= requestedLimit) break;
      }
      if (matches.length >= requestedLimit) break;
    }

    cursor = response.data.cursor || undefined;
    if (!cursor) break;
  }

  return {
    cursor: cursor ?? "",
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
  const response = await ordersApi.createOrder(params as never);
  return response.data;
}

export async function cancelOrder(orderId: string) {
  const response = await ordersApi.cancelOrder(orderId, undefined, undefined);
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
  const fills = await getFills({
    minTs: params?.startTs,
    maxTs: params?.endTs,
    limit: 500,
  });
  const settlements = await getSettlements({ limit: 500 });
  return {
    startTs: params?.startTs,
    endTs: params?.endTs,
    fills,
    settlements,
  };
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
  const response = await ordersApi.amendOrder(orderId, params as never);
  return response.data;
}

export async function batchCreateOrders(params: { orders: Array<Record<string, unknown>> }) {
  const response = await ordersApi.batchCreateOrders(params as never);
  return response.data;
}

export async function batchCancelOrders(params: { orderIds: string[] }) {
  const response = await ordersApi.batchCancelOrders(params as never);
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
