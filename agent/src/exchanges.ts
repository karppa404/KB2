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
export function credentialsStatus(env: Env = process.env) {
  const hasKey = (p: string) => Boolean(env[`${p}_PRIVATE_KEY_PEM`] || env[`${p}_PRIVATE_KEY`] || env[`${p}_PRIVATE_KEY_FILE`] || env[`${p}_PRIVATE_KEY_PATH`]);
  const status = (missing: string[]) => ({ configured: missing.length === 0, missing });
  return {
    kalshi: status([!(env.KALSHI_API_ID ?? env.KALSHI_API_KEY_ID ?? env.KALSHI_API_KEY) && "KALSHI_API_KEY_ID", !hasKey("KALSHI") && "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_FILE"].filter((v): v is string => Boolean(v))),
  };
}
const orderSchema = z.object({
  venue: z.literal("kalshi"), marketId: z.string().min(1), outcome: z.enum(["yes", "no"]),
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
      closesAt: m.close_time == null ? undefined : text(m.close_time), minSize: 0.01,
      volume24hContracts: m.volume_24h_fp == null ? undefined : number(m.volume_24h_fp) };
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
          const p = price(row[0]), size=number(row[1]); return {price:p,size};
        }).filter(level=>level.size>0);
        const bestPrice=prices.length ? Math.max(...prices.map(level=>level.price)) : null;
        return {price:bestPrice,size:prices.filter(level=>level.price===bestPrice).reduce((sum,level)=>sum+level.size,0)};
      };
      const yes=best(book.yes_dollars), no=best(book.no_dollars);
      result.yesBid=yes.price; result.yesBidSize=yes.size;
      result.yesAsk=no.price===null?null:Number((1-no.price).toFixed(6));result.yesAskSize=no.size;
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
  async order(id: string, outcome: "yes" | "no" = "yes"): Promise<OrderResult> {
    return guarded(false, async () => {
      const r = await this.rawOrder(id);
      const statuses: Record<string, OrderResult["status"]> = { resting: "open", executed: "filled", canceled: "canceled" };
      const state = text(r.status);
      const status = Object.hasOwn(statuses, state) ? statuses[state] : undefined;
      if (!status) throw failure("unsupported_response");
      const filled = number(r.fill_count_fp), remaining = number(r.remaining_count_fp);
      if (status === "filled" && remaining !== 0) throw failure("unsupported_response");
      const yesAverage=filled===0?undefined:(number(r.taker_fill_cost_dollars)+number(r.maker_fill_cost_dollars))/filled;
      if(yesAverage!==undefined&&(yesAverage<0||yesAverage>1))throw failure("unsupported_response");
      return { orderId: id, status, filledQuantity: filled, averagePrice:yesAverage===undefined?undefined:outcome==="no"?1-yesAverage:yesAverage, fees: number(r.taker_fees_dollars) + number(r.maker_fees_dollars) };
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

export function createExchanges(): Record<Venue, Exchange> {
  return { kalshi: new KalshiExchange() };
}
