import { constants, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ExchangeError, type Category, type Exchange, type Market, type OrderRequest, type OrderResult, type Position, type Venue } from "./types";

type Env = Record<string, string | undefined>;
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const TIMEOUT = 15_000;
const categories: Record<string, Category> = {
  politics: "politics", economics: "economics", weather: "weather", sports: "sports",
  technology: "technology", entertainment: "entertainment",
  "climate and weather": "weather", "economics & finance": "economics",
};
// Only venue taxonomy fields enter this allowlist; never infer from market text.
function category(values: unknown[]): Category | "other" {
  const matches = new Set(values.flatMap(v => typeof v === "string" && Object.hasOwn(categories, v.toLowerCase()) ? [categories[v.toLowerCase()]!] : []));
  return matches.size === 1 ? [...matches][0]! : "other";
}
function failure(code: string, uncertain = false): ExchangeError {
  return new ExchangeError(code, uncertain ? "Exchange write outcome is uncertain; reconcile before retrying." : `Exchange operation failed: ${code}.`, uncertain);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("unsupported_response");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw failure("unsupported_response");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw failure("unsupported_response");
  return value;
}
function number(value: unknown, signed = false): number {
  if (!(typeof value === "number" || typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))) throw failure("unsupported_response");
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER || (!signed && n < 0)) throw failure("unsupported_response");
  return n;
}
function price(value: unknown): number {
  const n = number(value);
  if (n > 1) throw failure("unsupported_response");
  return n;
}
function quote(value: unknown): number | null { return value == null ? null : price(value); }
function cursor(value: unknown): string | undefined { return value == null || value === "" ? undefined : text(value); }
function secret(env: Env, prefix: string): string | undefined {
  const direct = env[`${prefix}_PRIVATE_KEY_PEM`] ?? env[`${prefix}_PRIVATE_KEY`];
  if (direct) {
    if (direct.includes("-----BEGIN")) return direct.replace(/\\n/g, "\n").trim();
    try { return readFileSync(direct, "utf8").trim(); } catch { throw failure("credentials_invalid"); }
  }
  const file = env[`${prefix}_PRIVATE_KEY_FILE`] ?? env[`${prefix}_PRIVATE_KEY_PATH`];
  if (!file) return undefined;
  try { return readFileSync(file, "utf8").trim(); } catch { throw failure("credentials_invalid"); }
}
function polymarketSecret(env: Env): string | undefined {
  if (env.POLYMARKET_API_SECRET) return env.POLYMARKET_API_SECRET.trim();
  if (!env.POLYMARKET_API_SECRET_FILE) return undefined;
  try { return readFileSync(env.POLYMARKET_API_SECRET_FILE, "utf8").trim(); } catch { throw failure("credentials_invalid"); }
}
export function credentialsStatus(env: Env = process.env) {
  const hasKey = (p: string) => Boolean(env[`${p}_PRIVATE_KEY_PEM`] || env[`${p}_PRIVATE_KEY`] || env[`${p}_PRIVATE_KEY_FILE`] || env[`${p}_PRIVATE_KEY_PATH`]);
  const status = (missing: string[]) => ({ configured: missing.length === 0, missing });
  return {
    kalshi: status([!(env.KALSHI_API_ID ?? env.KALSHI_API_KEY_ID ?? env.KALSHI_API_KEY) && "KALSHI_API_KEY_ID", !hasKey("KALSHI") && "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_FILE"].filter((v): v is string => Boolean(v))),
    polymarket: status([!env.POLYMARKET_API_KEY_ID && "POLYMARKET_API_KEY_ID", !(env.POLYMARKET_API_SECRET || env.POLYMARKET_API_SECRET_FILE) && "POLYMARKET_API_SECRET or POLYMARKET_API_SECRET_FILE"].filter((v): v is string => Boolean(v))),
  };
}
const orderSchema = z.object({
  venue: z.enum(["kalshi", "polymarket"]), marketId: z.string().min(1), outcome: z.enum(["yes", "no"]),
  action: z.enum(["buy", "sell"]), price: z.number().gt(0).lt(1), quantity: z.number().positive().max(Number.MAX_SAFE_INTEGER),
  postOnly: z.boolean(), clientOrderId: z.string().min(1), tokenId: z.string().min(1).optional(), expiresAt: z.iso.datetime({ offset: true }).optional(),
});
function validateOrder(order: OrderRequest, venue: Venue) {
  if (!orderSchema.safeParse(order).success || order.venue !== venue || order.expiresAt && Date.parse(order.expiresAt) <= Date.now()) throw failure("invalid_order");
}
function rejectedStatus(status: number) { return [400, 401, 403, 404, 422, 429].includes(status); }
async function guarded<T>(write: boolean, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ExchangeError) {
      if (write && e.code === "unsupported_response") throw failure(e.code, true);
      throw e;
    }
    // Never propagate upstream messages/causes, which may contain credentials or signed payloads.
    throw failure(write ? "write_failed" : "read_failed", write);
  }
}
function timedFetch(transport: Fetch): Fetch {
  return (input, init) => transport(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT), redirect: "error" });
}

export class KalshiExchange implements Exchange {
  readonly venue = "kalshi" as const;
  private readonly transport: Fetch;
  private readonly env: Env;
  private readonly base: string;
  constructor(options: { fetch?: Fetch; env?: Env } = {}) {
    this.transport = timedFetch(options.fetch ?? fetch);
    this.env = options.env ?? process.env;
    this.base = (this.env.KALSHI_API_BASE_URL ?? "https://external-api.kalshi.com/trade-api/v2").replace(/\/$/, "");
    if (!["https://external-api.kalshi.com/trade-api/v2", "https://api.elections.kalshi.com/trade-api/v2", "https://external-api.demo.kalshi.co/trade-api/v2", "https://demo-api.kalshi.co/trade-api/v2"].includes(this.base)) throw failure("invalid_api_url");
  }
  private async request(path: string, method = "GET", body?: unknown, authenticated = false): Promise<unknown> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authenticated) {
      const id = this.env.KALSHI_API_ID ?? this.env.KALSHI_API_KEY_ID ?? this.env.KALSHI_API_KEY;
      const pem = secret(this.env, "KALSHI");
      if (!id || !pem) throw failure("credentials_missing");
      try {
        const key = createPrivateKey(pem);
        const timestamp = String(Date.now());
        const message = Buffer.from(timestamp + method + new URL(this.base + path).pathname);
        const signature = key.asymmetricKeyType === "ed25519" ? sign(null, message, key)
          : key.asymmetricKeyType === "rsa" || key.asymmetricKeyType === "rsa-pss" ? sign("sha256", message, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }) : undefined;
        if (!signature) throw failure("credentials_invalid");
        Object.assign(headers, { "KALSHI-ACCESS-KEY": id, "KALSHI-ACCESS-TIMESTAMP": timestamp, "KALSHI-ACCESS-SIGNATURE": signature.toString("base64") });
      } catch { throw failure("credentials_invalid"); }
    }
    const write = method !== "GET";
    return guarded(write, async () => {
      const response = await this.transport(this.base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw failure(`http_${response.status}`, write && !rejectedStatus(response.status));
      return await response.json();
    });
  }
  private mapMarket(raw: unknown, classification: Market["category"]): Market {
    const m = object(raw);
    if (m.market_type !== "binary") throw failure("unsupported_market");
    return { venue: this.venue, id: text(m.ticker), title: text(m.title), category: classification,
      yesBid: quote(m.yes_bid_dollars), yesAsk: quote(m.yes_ask_dollars),
      rules: [text(m.rules_primary), typeof m.rules_secondary === "string" ? m.rules_secondary : ""].filter(Boolean).join("\n\n"),
      closesAt: m.close_time == null ? undefined : text(m.close_time), minSize: 0.01 };
  }
  private async seriesCategory(series: unknown): Promise<Market["category"]> {
    const result = object(await this.request(`/series/${encodeURIComponent(text(series))}`));
    return category([object(result.series).category]);
  }
  async discover(selected: Category[], next?: string) {
    return guarded(false, async () => {
      const page = object(await this.request(`/events?status=open&with_nested_markets=true&limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ""}`));
      const markets: Market[] = [];
      const classified = new Map<string, Market["category"]>();
      for (const raw of array(page.events)) {
        const event = object(raw), series = text(event.series_ticker);
        if (!classified.has(series)) classified.set(series, await this.seriesCategory(series));
        for (const market of array(event.markets)) {
          if (object(market).market_type !== "binary") continue;
          const mapped = this.mapMarket(market, classified.get(series)!);
          if (!selected.length || selected.includes(mapped.category as Category)) markets.push(mapped);
        }
      }
      return { markets, cursor: cursor(page.cursor) };
    });
  }
  async market(id: string) {
    return guarded(false, async () => {
      const m = object(object(await this.request(`/markets/${encodeURIComponent(id)}`)).market);
      const event = object(object(await this.request(`/events/${encodeURIComponent(text(m.event_ticker))}`)).event);
      const result = this.mapMarket(m, await this.seriesCategory(event.series_ticker));
      if (result.id !== id) throw failure("unsupported_response");
      const book = object(object(await this.request(`/markets/${encodeURIComponent(id)}/orderbook`)).orderbook_fp);
      const best = (levels: unknown) => {
        const prices = array(levels).map(level => {
          const row = array(level);
          if (row.length !== 2) throw failure("unsupported_response");
          const p = price(row[0]); return number(row[1]) > 0 ? p : null;
        }).filter((p): p is number => p !== null);
        return prices.length ? Math.max(...prices) : null;
      };
      result.yesBid = best(book.yes_dollars);
      const noBid = best(book.no_dollars);
      result.yesAsk = noBid === null ? null : Number((1 - noBid).toFixed(6));
      return result;
    });
  }
  async place(order: OrderRequest): Promise<OrderResult> {
    validateOrder(order, this.venue);
    if (Math.abs(order.quantity * 100 - Math.round(order.quantity * 100)) > 1e-7 || Math.abs(order.price * 10000 - Math.round(order.price * 10000)) > 1e-7) throw failure("invalid_precision");
    return guarded(true, async () => {
      const yesPrice = order.outcome === "yes" ? order.price : 1 - order.price;
      const r = object(await this.request("/portfolio/events/orders", "POST", {
        ticker: order.marketId, client_order_id: order.clientOrderId,
        side: (order.outcome === "yes") === (order.action === "buy") ? "bid" : "ask",
        count: order.quantity.toFixed(2), price: yesPrice.toFixed(4), post_only: order.postOnly,
        time_in_force: "good_till_canceled", self_trade_prevention_type: "taker_at_cross",
        ...(order.expiresAt ? { expiration_time: Math.floor(Date.parse(order.expiresAt) / 1000) } : {}),
      }, true));
      const filled = number(r.fill_count), remaining = number(r.remaining_count);
      if (filled + remaining > order.quantity + 1e-8) throw failure("unsupported_response");
      return { orderId: text(r.order_id), status: remaining > 0 ? "open" : filled >= order.quantity ? "filled" : "canceled", filledQuantity: filled,
        averagePrice: r.average_fill_price == null ? undefined : order.outcome === "no" ? 1 - price(r.average_fill_price) : price(r.average_fill_price),
        fees: r.average_fee_paid == null ? undefined : number(r.average_fee_paid) * filled };
    });
  }
  private async rawOrder(id: string) {
    const r = object(object(await this.request(`/portfolio/orders/${encodeURIComponent(id)}`, "GET", undefined, true)).order);
    if (text(r.order_id) !== id) throw failure("unsupported_response");
    return r;
  }
  async cancel(id: string): Promise<void> {
    // Resolve the ticker before writing so cancellation routes to the correct exchange shard.
    const existing = await guarded(false, () => this.rawOrder(id));
    const ticker = text(existing.ticker);
    return guarded(true, async () => {
      const result = object(await this.request(`/portfolio/events/orders/${encodeURIComponent(id)}?market_ticker=${encodeURIComponent(ticker)}&exchange_index=-1`, "DELETE", undefined, true));
      if (result.order_id !== id) throw failure("unsupported_response");
      number(result.reduced_by);
    });
  }
  async order(id: string): Promise<OrderResult> {
    return guarded(false, async () => {
      const r = await this.rawOrder(id);
      const statuses: Record<string, OrderResult["status"]> = { resting: "open", executed: "filled", canceled: "canceled" };
      const state = text(r.status);
      const status = Object.hasOwn(statuses, state) ? statuses[state] : undefined;
      if (!status) throw failure("unsupported_response");
      const filled = number(r.fill_count_fp), remaining = number(r.remaining_count_fp);
      if (status === "filled" && remaining !== 0) throw failure("unsupported_response");
      return { orderId: id, status, filledQuantity: filled, fees: number(r.taker_fees_dollars) + number(r.maker_fees_dollars) };
    });
  }
  async positions(): Promise<Position[]> {
    return guarded(false, async () => {
      const positions: Position[] = [], seen = new Set<string>();
      let next: string | undefined;
      do {
        const r = object(await this.request(`/portfolio/positions?limit=1000${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, "GET", undefined, true));
        for (const raw of array(r.market_positions)) {
          const p = object(raw), qty = number(p.position_fp, true);
          if (qty) positions.push({ marketId: text(p.ticker), outcome: qty > 0 ? "yes" : "no", quantity: Math.abs(qty) });
        }
        next = cursor(r.cursor);
        if (next && seen.has(next)) throw failure("unsupported_response");
        if (next) seen.add(next);
      } while (next);
      return positions;
    });
  }
  async balance() {
    return guarded(false, async () => {
      const r = object(await this.request("/portfolio/balance", "GET", undefined, true));
      return r.balance_dollars == null ? number(r.balance) / 100 : number(r.balance_dollars);
    });
  }
}

function usd(value: unknown, bounded = false): number {
  const amount = object(value);
  if (amount.currency !== "USD") throw failure("unsupported_currency");
  return bounded ? price(amount.value) : number(amount.value);
}
function aligned(value: number, step: number) {
  return step > 0 && Math.abs(value / step - Math.round(value / step)) < 1e-7;
}

export class PolymarketExchange implements Exchange {
  readonly venue = "polymarket" as const;
  private readonly transport: Fetch;
  private readonly env: Env;
  constructor(options: { fetch?: Fetch; env?: Env } = {}) {
    this.env = options.env ?? process.env;
    this.transport = timedFetch(options.fetch ?? fetch);
  }
  private auth(method: string, path: string): Record<string, string> {
    const id = this.env.POLYMARKET_API_KEY_ID, encoded = polymarketSecret(this.env);
    if (!id || !encoded) throw failure("credentials_missing");
    try {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw failure("credentials_invalid");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== 32 && bytes.length !== 64) throw failure("credentials_invalid");
      // Ed25519 PKCS#8 prefix followed by the first 32 bytes (the signing seed).
      const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), bytes.subarray(0, 32)]), format: "der", type: "pkcs8" });
      const timestamp = String(Date.now());
      return { "X-PM-Access-Key": id, "X-PM-Timestamp": timestamp,
        "X-PM-Signature": sign(null, Buffer.from(timestamp + method + path.split("?")[0]), key).toString("base64") };
    } catch { throw failure("credentials_invalid"); }
  }
  private async request(path: string, method = "GET", body?: unknown, authenticated = false): Promise<unknown> {
    const headers = { "Content-Type": "application/json", ...(authenticated ? this.auth(method, path) : {}) };
    return guarded(method !== "GET", async () => {
      const response = await this.transport(`https://${authenticated ? "api" : "gateway"}.polymarket.us${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw failure(`http_${response.status}`, method !== "GET" && !rejectedStatus(response.status));
      return await response.json();
    });
  }
  private mapMarket(raw: unknown): Market {
    const m = object(raw), sides = array(m.marketSides).map(object);
    if (sides.length !== 2 || sides.filter(s => s.long === true).length !== 1 || sides.filter(s => s.long === false).length !== 1 || sides.some(s => s.marketSideType !== "MARKET_SIDE_TYPE_INSTRUMENT")) throw failure("unsupported_market");
    const tick = m.orderPriceMinTickSize == null ? undefined : price(m.orderPriceMinTickSize);
    const minimum = m.minimumTradeQty == null ? undefined : number(m.minimumTradeQty);
    if (tick === 0 || minimum === 0) throw failure("unsupported_response");
    return { venue: this.venue, id: text(m.slug), title: text(m.question ?? m.title), rules: text(m.description),
      category: category([m.category, ...array(m.tags ?? []).map(t => object(t).slug)]),
      yesBid: m.bestBidQuote == null ? null : usd(m.bestBidQuote, true), yesAsk: m.bestAskQuote == null ? null : usd(m.bestAskQuote, true),
      closesAt: m.endDate == null ? undefined : text(m.endDate), tickSize: tick == null ? undefined : String(tick), minSize: minimum };
  }
  async discover(selected: Category[], next?: string) {
    return guarded(false, async () => {
      const offset = next === undefined ? 0 : number(next);
      if (!Number.isSafeInteger(offset) || offset > 2_147_483_547) throw failure("invalid_cursor");
      const page = object(await this.request(`/v1/markets?active=true&closed=false&limit=100&offset=${offset}`));
      const raw = array(page.markets), markets: Market[] = [];
      for (const item of raw) {
        try {
          const m = this.mapMarket(item);
          if (!selected.length || selected.includes(m.category as Category)) markets.push(m);
        } catch (e) { if (!(e instanceof ExchangeError) || e.code !== "unsupported_market") throw e; }
      }
      return { markets, cursor: raw.length === 100 ? String(offset + raw.length) : undefined };
    });
  }
  private async detail(id: string) {
    const raw = object(object(await this.request(`/v1/market/slug/${encodeURIComponent(id)}`)).market);
    const market = this.mapMarket(raw);
    if (market.id !== id) throw failure("unsupported_response");
    return { raw, market };
  }
  private async book(id: string) {
    const book = object(object(await this.request(`/v1/markets/${encodeURIComponent(id)}/book`)).marketData);
    if (book.marketSlug !== id) throw failure("unsupported_response");
    return book;
  }
  async market(id: string) {
    return guarded(false, async () => {
      const { market } = await this.detail(id), book = await this.book(id);
      const best = (levels: unknown, bid: boolean) => {
        const prices = array(levels).map(raw => { const l = object(raw); return { price: usd(l.px, true), size: number(l.qty) }; }).filter(l => l.size > 0).map(l => l.price);
        return prices.length ? (bid ? Math.max(...prices) : Math.min(...prices)) : null;
      };
      market.yesBid = best(book.bids, true); market.yesAsk = best(book.offers, false);
      return market;
    });
  }
  async place(order: OrderRequest): Promise<OrderResult> {
    validateOrder(order, this.venue);
    this.auth("POST", "/v1/orders");
    if (order.tokenId) throw failure("unsupported_token");
    const { raw, market } = await guarded(false, () => this.detail(order.marketId));
    const book = await guarded(false, () => this.book(order.marketId));
    if (raw.active !== true || raw.closed !== false || book.state !== "MARKET_STATE_OPEN") throw failure("market_not_tradable");
    const yesPrice = Number((order.outcome === "yes" ? order.price : 1 - order.price).toFixed(12));
    if (!market.tickSize || !market.minSize || yesPrice < 0.01 || yesPrice > 0.99 || !aligned(yesPrice, Number(market.tickSize)) || !aligned(order.quantity, market.minSize)) throw failure("invalid_order");
    return guarded(true, async () => {
      // The retail API does not expose a client order ID or idempotency key.
      const r = object(await this.request("/v1/orders", "POST", {
        marketSlug: order.marketId, type: "ORDER_TYPE_LIMIT", price: { value: String(yesPrice), currency: "USD" }, quantity: order.quantity,
        tif: order.expiresAt ? "TIME_IN_FORCE_GOOD_TILL_DATE" : "TIME_IN_FORCE_GOOD_TILL_CANCEL",
        ...(order.expiresAt ? { goodTillTime: order.expiresAt } : {}), participateDontInitiate: order.postOnly,
        outcomeSide: order.outcome === "yes" ? "OUTCOME_SIDE_YES" : "OUTCOME_SIDE_NO",
        action: order.action === "buy" ? "ORDER_ACTION_BUY" : "ORDER_ACTION_SELL",
        manualOrderIndicator: "MANUAL_ORDER_INDICATOR_AUTOMATIC",
      }, true));
      const id = text(r.id);
      // An ID acknowledges receipt, not acceptance. Read the exchange state before reporting it.
      try { return await this.order(id); } catch { throw failure("write_reconciliation_failed", true); }
    });
  }
  async cancel(id: string): Promise<void> {
    const raw = object(object(await this.request(`/v1/order/${encodeURIComponent(id)}`, "GET", undefined, true)).order);
    if (raw.id !== id) throw failure("unsupported_response");
    const slug = text(raw.marketSlug);
    return guarded(true, async () => {
      object(await this.request(`/v1/order/${encodeURIComponent(id)}/cancel`, "POST", { marketSlug: slug }, true));
      let result: OrderResult;
      try { result = await this.order(id); } catch { throw failure("write_reconciliation_failed", true); }
      if (result.status !== "canceled") throw failure("cancel_not_confirmed", result.status === "open");
    });
  }
  async order(id: string): Promise<OrderResult> {
    return guarded(false, async () => {
      const r = object(object(await this.request(`/v1/order/${encodeURIComponent(id)}`, "GET", undefined, true)).order);
      if (r.id !== id) throw failure("unsupported_response");
      const statuses: Record<string, OrderResult["status"]> = {
        ORDER_STATE_NEW: "open", ORDER_STATE_PARTIALLY_FILLED: "open", ORDER_STATE_PENDING_NEW: "open",
        ORDER_STATE_PENDING_REPLACE: "open", ORDER_STATE_PENDING_CANCEL: "open", ORDER_STATE_PENDING_RISK: "open",
        ORDER_STATE_FILLED: "filled", ORDER_STATE_CANCELED: "canceled", ORDER_STATE_EXPIRED: "canceled", ORDER_STATE_REJECTED: "rejected",
      };
      const state = text(r.state);
      const status = Object.hasOwn(statuses, state) ? statuses[state] : undefined;
      const filled = number(r.cumQuantity), original = number(r.quantity), remaining = number(r.leavesQuantity);
      if (!status || filled > original || remaining + filled > original + 1e-8 || status === "filled" && (remaining !== 0 || filled !== original)) throw failure("unsupported_response");
      if (r.outcomeSide !== "OUTCOME_SIDE_YES" && r.outcomeSide !== "OUTCOME_SIDE_NO") throw failure("unsupported_response");
      const average = r.avgPx == null || filled === 0 ? undefined : usd(r.avgPx, true);
      return { orderId: id, status, filledQuantity: filled,
        averagePrice: average == null ? undefined : r.outcomeSide === "OUTCOME_SIDE_NO" ? Number((1 - average).toFixed(12)) : average,
        fees: r.commissionNotionalTotalCollected == null ? undefined : usd(r.commissionNotionalTotalCollected) };
    });
  }
  async positions(): Promise<Position[]> {
    return guarded(false, async () => {
      const positions: Position[] = [], seen = new Set<string>();
      let next: string | undefined;
      do {
        const page = object(await this.request(`/v1/portfolio/positions?limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ""}`, "GET", undefined, true));
        for (const [slug, raw] of Object.entries(object(page.positions))) {
          const p = object(raw), quantity = number(p.netPositionDecimal, true);
          if (quantity) positions.push({ marketId: text(slug), outcome: quantity > 0 ? "yes" : "no", quantity: Math.abs(quantity) });
        }
        next = cursor(page.nextCursor);
        if (page.eof === false && !next || next && seen.has(next)) throw failure("unsupported_response");
        if (next) seen.add(next);
      } while (next);
      return positions;
    });
  }
  async balance() {
    return guarded(false, async () => {
      const page = object(await this.request("/v1/account/balances", "GET", undefined, true));
      const rows = array(page.balances);
      if (!rows.length) return 0;
      const balances = rows.map(object).filter(b => b.currency === "USD");
      if (balances.length !== 1) throw failure("unsupported_response");
      return number(balances[0]!.buyingPower);
    });
  }
}
export function createExchanges(): Record<Venue, Exchange> {
  return { kalshi: new KalshiExchange(), polymarket: new PolymarketExchange() };
}
