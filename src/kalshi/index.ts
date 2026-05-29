import {
  CommunicationsApi,
  Configuration,
  EventsApi,
  ExchangeApi,
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
  const response = await getMarkets({
    ...params,
    limit: params?.limit ?? 100,
  });

  const markets = Array.isArray(response.markets) ? response.markets : [];

  const normalized = keyword.trim().toLowerCase();
  const filtered = markets.filter((market) => {
    const title = typeof market.title === "string" ? market.title : "";
    return title.toLowerCase().includes(normalized);
  });

  return {
    ...response,
    markets: filtered,
    searchKeyword: keyword,
    totalMatches: filtered.length,
  };
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
  side: string;
  type: string;
  count: number;
  yes_price?: number;
  no_price?: number;
  expiration_ts?: number;
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
