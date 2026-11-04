import { describe, expect, test } from "bun:test";
import { constants, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExchanges, credentialsStatus, KalshiExchange } from "../src/exchanges";
import { ExchangeError, type OrderRequest } from "../src/types";

type Call = { url: URL; init: RequestInit; body: Record<string, unknown> | undefined };
function transport(handler: (call: Call) => unknown) {
  const calls: Call[] = [];
  return { calls, fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), init, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe("error");
    const result = handler(call);
    if (result instanceof Response) return result;
    return Response.json(result);
  } };
}
const ed = generateKeyPairSync("ed25519");
const pem = ed.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const kalshiEnv = { KALSHI_API_KEY_ID: "test-key", KALSHI_PRIVATE_KEY: pem };
const order = (venue: "kalshi", changes: Partial<OrderRequest> = {}): OrderRequest => ({ venue, marketId: "market", outcome: "yes", action: "buy", price: 0.42, quantity: 10, postOnly: true, clientOrderId: "unique-id", ...changes });
const km = { ticker: "market", title: "Sports weather politics in a title", market_type: "binary", event_ticker: "event", rules_primary: "Rules", rules_secondary: "Details", yes_bid_dollars: "0.4100", yes_ask_dollars: "0.4400", volume_24h_fp:"12000.00" };
async function error(promise: Promise<unknown>, code: string, uncertain = false) {
  try { await promise; throw new Error("Expected failure"); } catch (e) {
    expect(e).toBeInstanceOf(ExchangeError);
    expect((e as ExchangeError).code).toBe(code);
    expect((e as ExchangeError).uncertain).toBe(uncertain);
  }
}

describe("credential handling", () => {
 test("only Kalshi is exposed and metadata never contains credentials",()=>{
  const status=credentialsStatus(kalshiEnv);expect(status.kalshi.configured).toBe(true);
  expect(Object.keys(createExchanges())).toEqual(["kalshi"]);expect(JSON.stringify(status)).not.toContain("test-key");expect(JSON.stringify(status)).not.toContain(pem);
 });
 test("missing credentials fail before transport",async()=>{
  const io=transport(()=>{throw Error("must not send");});const exchange=new KalshiExchange({env:{},fetch:io.fetch});
  await error(exchange.balance(),"credentials_missing");await error(exchange.place(order("kalshi")),"credentials_missing");expect(io.calls).toHaveLength(0);
 });
});

describe("request validation", () => {
  test("invalid orders and unsupported precision never reach a transport", async () => {
    const io = transport(() => { throw new Error("must not send"); });
    const kalshi = new KalshiExchange({ env: kalshiEnv, fetch: io.fetch });
    await error(kalshi.place({...order("kalshi"),venue:"polymarket"} as any), "invalid_order");
    await error(kalshi.place(order("kalshi", { price: NaN })), "invalid_order");
    await error(kalshi.place(order("kalshi", { quantity: 0.001 })), "invalid_precision");
    await error(kalshi.place(order("kalshi", { expiresAt: "2020-01-01T00:00:00Z" })), "invalid_order");
    expect(io.calls).toHaveLength(0);
  });
});

describe("Kalshi", () => {
  test("public discovery trusts series category, filters unknowns, and preserves cursors", async () => {
    const io = transport(c => {
      expect(c.init.headers).not.toHaveProperty("KALSHI-ACCESS-KEY");
      if (c.url.pathname.endsWith("/events")) return { events: [{ series_ticker: "sports", category: "politics", markets: [km] }, { series_ticker: "unknown", markets: [{ ...km, ticker: "unknown" }] }], cursor: "next" };
      return { series: { category: c.url.pathname.endsWith("sports") ? "Sports" : "politics rumors" } };
    });
    const exchange = new KalshiExchange({ env: {}, fetch: io.fetch });
    const all = await exchange.discover([]);
    expect(all.markets.map(m => m.category)).toEqual(["sports", "other"]); expect(all.cursor).toBe("next");
    expect((await exchange.discover(["sports"], "prior")).markets.map(m => m.id)).toEqual(["market"]);
    expect(io.calls.some(c => c.url.searchParams.get("cursor") === "prior")).toBe(true);
  });
  test("detail derives dollar asks from NO bids without depending on book order", async () => {
    const io = transport(c => {
      if (c.url.pathname.endsWith("/orderbook")) return { orderbook_fp: { yes_dollars: [["0.42", "2"], ["0.3", "1"]], no_dollars: [["0.50", "1"], ["0.55", "2"]] } };
      if (c.url.pathname.includes("/markets/")) return { market: km };
      if (c.url.pathname.includes("/events/")) return { event: { series_ticker: "series" } };
      return { series: { category: "Weather" } };
    });
    const result = await new KalshiExchange({ env: {}, fetch: io.fetch }).market("market");
    expect(result.yesBid).toBe(0.42); expect(result.yesAsk).toBe(0.45); expect(result.category).toBe("weather");expect(result.yesBidSize).toBe(2);expect(result.yesAskSize).toBe(2);expect(result.volume24hContracts).toBe(12000);
  });
  test.each(["ed25519", "rsa"] as const)("signs %s requests and maps all four directions to V2", async algorithm => {
    const pair = algorithm === "rsa" ? generateKeyPairSync("rsa", { modulusLength: 2048 }) : ed;
    const io = transport(c => {
      const h = c.init.headers as Record<string, string>;
      const message = Buffer.from(h["KALSHI-ACCESS-TIMESTAMP"] + "POST/trade-api/v2/portfolio/events/orders");
      expect(verify(algorithm === "rsa" ? "sha256" : null, message, algorithm === "rsa" ? { key: pair.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST } : pair.publicKey, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"]!, "base64"))).toBe(true);
      expect(c.body?.client_order_id).toBe("unique-id"); expect(c.body?.post_only).toBe(true);
      return { order_id: "order-id", fill_count: "2.00", remaining_count: "8.00", average_fill_price: c.body?.price, average_fee_paid: "0.01" };
    });
    const exchange = new KalshiExchange({ env: { KALSHI_API_KEY_ID: "id", KALSHI_PRIVATE_KEY: pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString() }, fetch: io.fetch });
    for (const outcome of ["yes", "no"] as const) for (const action of ["buy", "sell"] as const) {
      const result = await exchange.place(order("kalshi", { outcome, action }));
      expect(result.status).toBe("open"); expect(result.filledQuantity).toBe(2); expect(result.fees).toBe(0.02);
      expect(result.averagePrice).toBeCloseTo(0.42);
      const body = io.calls.at(-1)!.body!;
      expect(body.side).toBe((outcome === "yes") === (action === "buy") ? "bid" : "ask"); expect(body.price).toBe(outcome === "yes" ? "0.4200" : "0.5800");
    }
  });
  test("cancel resolves the ticker for shard routing and excludes query from signature", async () => {
    const io = transport(c => {
      if (c.init.method === "GET") return { order: { order_id: "order-id", ticker: "market" } };
      expect(c.url.pathname).toBe("/trade-api/v2/portfolio/events/orders/order-id"); expect(c.url.searchParams.get("market_ticker")).toBe("market");
      const h = c.init.headers as Record<string, string>;
      expect(verify(null, Buffer.from(h["KALSHI-ACCESS-TIMESTAMP"] + "DELETE" + c.url.pathname), ed.publicKey, Buffer.from(h["KALSHI-ACCESS-SIGNATURE"]!, "base64"))).toBe(true);
      return { order_id: "order-id", reduced_by: "10.00" };
    });
    await new KalshiExchange({ env: kalshiEnv, fetch: io.fetch }).cancel("order-id");
  });
  test("positions paginate fractional net contracts; balance is dollars", async () => {
    const io = transport(c => c.url.pathname.endsWith("balance") ? { balance: 1234 } : c.url.searchParams.has("cursor") ? { market_positions: [{ ticker: "b", position_fp: "-0.25" }] } : { market_positions: [{ ticker: "a", position_fp: "2.50" }], cursor: "next" });
    const exchange = new KalshiExchange({ env: kalshiEnv, fetch: io.fetch });
    expect(await exchange.positions()).toEqual([{ marketId: "a", outcome: "yes", quantity: 2.5 }, { marketId: "b", outcome: "no", quantity: 0.25 }]);
    expect(await exchange.balance()).toBe(12.34);
  });
  test("maps order states and rejects future states", async () => {
    let state = "resting";
    const io = transport(() => ({ order: { order_id: "order-id", status: state, fill_count_fp: "2.00", remaining_count_fp: "0.00", taker_fill_cost_dollars:"0.40", maker_fill_cost_dollars:"0.20", taker_fees_dollars: "0.01", maker_fees_dollars: "0.02" } }));
    const exchange = new KalshiExchange({ env: kalshiEnv, fetch: io.fetch });
    for (const [upstream, status] of [["resting", "open"], ["executed", "filled"], ["canceled", "canceled"]] as const) { state = upstream!; expect((await exchange.order("order-id")).status).toBe(status!); }
    for (const unsupported of ["future", "constructor"]) { state = unsupported; await error(exchange.order("order-id"), "unsupported_response"); }
  });
  test.each([400, 401, 403, 422, 429, 409, 500, 503])("HTTP %i write classification", async status => {
    const io = transport(() => new Response("secret server message", { status }));
    await error(new KalshiExchange({ env: kalshiEnv, fetch: io.fetch }).place(order("kalshi")), `http_${status}`, [409, 500, 503].includes(status));
    expect(io.calls).toHaveLength(1);
  });
  test("transport failures and malformed successful writes are uncertain", async () => {
    for (const handler of [() => { throw new Error("timeout"); }, () => ({}), () => new Response("not json")]) {
      const io = transport(handler);
      const pending = new KalshiExchange({ env: kalshiEnv, fetch: io.fetch }).place(order("kalshi"));
      try { await pending; throw new Error("Expected failure"); } catch (e) { expect(e).toBeInstanceOf(ExchangeError); expect((e as ExchangeError).uncertain).toBe(true); }
      expect(io.calls).toHaveLength(1);
    }
  });
});

test("existing kb2 API ID and private-key path configuration authenticates", async()=>{
 const dir=mkdtempSync(join(tmpdir(),"kb2-key-alias-"));
 try {
  const path=join(dir,"key.pem");writeFileSync(path,pem,{mode:0o600});
  const t=transport(call=>{expect((call.init.headers as Record<string,string>)["KALSHI-ACCESS-KEY"]).toBe("legacy-id");return {balance:100};});
  const env={KALSHI_API_ID:"legacy-id",KALSHI_PRIVATE_KEY:path};
  expect(credentialsStatus(env).kalshi.configured).toBe(true);
  expect(await new KalshiExchange({env,fetch:t.fetch}).balance()).toBe(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("Kalshi reconciliation uses cumulative fill cost for the requested YES/NO leg",async()=>{
 const io=transport(()=>({order:{order_id:"O",status:"resting",fill_count_fp:"2.00",remaining_count_fp:"8.00",taker_fill_cost_dollars:"0.40",maker_fill_cost_dollars:"0.20",taker_fees_dollars:"0.01",maker_fees_dollars:"0.00"}}));
 const exchange=new KalshiExchange({env:kalshiEnv,fetch:io.fetch});
 expect((await exchange.order("O","yes")).averagePrice).toBeCloseTo(.3);
 expect((await exchange.order("O","no")).averagePrice).toBeCloseTo(.7);
});
