import { test, expect } from "bun:test";
import { AgentService, localClock, type Strategy } from "../src/service";
import { Store } from "../src/store";
import { ExchangeError, type Exchange, type Market } from "../src/types";

const market: Market={venue:"kalshi",id:"T",title:"Rain?",category:"weather",yesBid:.4,yesAsk:.5,volume24hContracts:20000,yesBidSize:500,yesAskSize:500,rules:"Rain at station"};
const strategy={id:"weather",name:"Weather",instructions:"Buy calibrated weather forecasts",categories:["weather"],venues:["kalshi"],timezone:"America/Chicago",enabled:true,autoReactivate:true,allowMarketMaking:true,liquidity:{maxSpreadUsd:.2,minVolume24hContracts:10000,minBestDepthContracts:100},maxOrderUsd:10,maxExposureUsd:15,dailyBuyLimitUsd:20} as const;
const trade={operationId:"one",strategyId:"weather",venue:"kalshi",marketId:"T",outcome:"yes",action:"buy",price:.5,quantity:10,rationale:"Forecast exceeds offer"} as const;
function setup(live=false,place?:Exchange["place"]) {
 const exchange:Exchange={venue:"kalshi",discover:async()=>({markets:[market]}),market:async()=>market,place:place??(async()=>({orderId:"O",status:"open",filledQuantity:0})),cancel:async()=>{},order:async()=>({orderId:"O",status:"filled",filledQuantity:10,averagePrice:.5}),positions:async()=>[],balance:async()=>100};
 const service=new AgentService(new Store(":memory:"),{kalshi:exchange},live);
 service.saveStrategy({...strategy,mode:live?"live":"paper"}); return service;
}
test("paper orders reserve/fill budget, idempotency prevents duplicates and parameter reuse",async()=>{
 const s=setup();const first=await s.submit(trade);expect(first.status).toBe("filled");
 expect((await s.submit(trade)).id).toBe(first.id);expect(s.trades()).toHaveLength(1);
 expect(s.ledger("weather").cash).toBe(995);expect(s.ledger("weather").positions[0]?.quantity).toBe(10);
 await expect(s.submit({...trade,quantity:5})).rejects.toThrow("different parameters");
 await s.submit({...trade,operationId:"two",quantity:20});
 await expect(s.submit({...trade,operationId:"three",quantity:1})).rejects.toThrow("Exposure");
});
test("concurrent identical live requests place exactly once and uncertain results block later orders",async()=>{
 let calls=0;const s=setup(true,async()=>{calls++;await Bun.sleep(10);throw new ExchangeError("timeout","timeout",true);});
 const result=await Promise.all([s.submit(trade),s.submit(trade)]);expect(calls).toBe(1);expect(s.trades()).toHaveLength(1);
 expect(s.trades()[0]?.status).toBe("unknown");expect(s.ledger("weather").reserved).toBe(5);
 await expect(s.submit({...trade,operationId:"two"})).rejects.toThrow("uncertain");
 expect(result.every(r=>["submitting","unknown"].includes(r.status))).toBe(true);
});
test("permissions, categories, budgets and owned holdings enforced before exchange writes",async()=>{
 const s=setup();await expect(s.submit({...trade,action:"sell"})).rejects.toThrow("holdings");
 s.saveStrategy({...s.strategy("weather"),categories:["politics"]});
 await expect(s.submit(trade)).rejects.toThrow("category");
 s.saveStrategy({...s.strategy("weather"),enabled:false});await expect(s.submit(trade)).rejects.toThrow("paused");
});
test("maker orders expire, cancel preserves ownership and positions can be reduced",async()=>{
 const s=setup();const r=await s.submit({...trade,price:.4,postOnly:true,expiresAt:new Date(Date.now()+60000).toISOString()});
 expect(r.status).toBe("open");expect(s.ledger("weather").reserved).toBe(4);
 s.saveStrategy({...strategy,id:"other"});await expect(s.cancel("other","one")).rejects.toThrow("belong");
 await s.cancel("weather","one");expect(s.ledger("weather").reserved).toBe(0);
 await s.submit({...trade,operationId:"buy"});await s.submit({...trade,operationId:"sell",action:"sell",price:.4,quantity:5});
 expect(s.ledger("weather").positions[0]?.quantity).toBe(5);
 const snapshot=await s.snapshot("weather");expect(snapshot.equity).toBe(999);expect(snapshot.returnPct).toBe(-.1);
});
test("daily claims follow local 3am across DST and only one concurrent run is active",()=>{
 const s=setup();expect(localClock(new Date("2026-11-01T09:00:00Z"),"America/Chicago").minute).toBe(180);
 const first=s.claimDue(new Date("2026-11-01T09:00:00Z"));expect(first).toHaveLength(1);
 expect(s.claimDue(new Date("2026-11-01T09:01:00Z"))).toHaveLength(0);
 s.finishRun(first[0].runId,"Explored, no trades");expect(s.claimDue(new Date("2026-11-01T09:02:00Z"))).toHaveLength(0);
 expect(s.claimDue(new Date("2026-11-02T09:00:00Z"))).toHaveLength(1);
});
test("reactivation toggle disables pending wakes and feedback persists in run context",()=>{
 const s=setup();s.addFeedback("weather","Avoid hurricane markets");s.wake("weather",new Date(Date.now()+120000).toISOString(),"New forecast");
 expect(s.dashboard().wakes).toHaveLength(1);
 s.saveStrategy({...s.strategy("weather"),autoReactivate:false});expect(s.dashboard().wakes).toHaveLength(0);
 expect(s.claimDue(new Date("2026-11-04T09:00:00Z"))[0].feedback).toHaveLength(1);
});
test("restart preserves uncertain intents and fixed starting cash",async()=>{
 const s=setup(true,async()=>{throw Error("disconnected");});await s.submit(trade);
 await expect(s.submit({...trade,operationId:"retry"})).rejects.toThrow("uncertain");
 expect(()=>s.saveStrategy({...s.strategy("weather"),initialCashUsd:5000})).toThrow("starting cash");
});

test("a resting paper maker fills at its quoted price when the book moves",async()=>{
 const s=setup();await s.submit({...trade,price:.4,postOnly:true,expiresAt:new Date(Date.now()+60000).toISOString()});
 s.exchanges.kalshi.market=async()=>({...market,yesAsk:.35});
 await s.reconcile("weather");expect(s.trades()[0]?.status).toBe("filled");expect(s.ledger("weather").positions[0]?.quantity).toBe(10);expect(s.ledger("weather").cash).toBe(996);
});
test("a slow stale refresh cannot overwrite newer fills",async()=>{
 const s=setup(true);await s.submit(trade);
 let resolveOld!:(result:any)=>void;let calls=0;
 s.exchanges.kalshi.order=async()=>++calls===1?await new Promise(resolve=>{resolveOld=resolve;}):{orderId:"O",status:"filled",filledQuantity:10,averagePrice:.3};
 const old=s.reconcile("weather");await s.reconcile("weather");resolveOld({orderId:"O",status:"open",filledQuantity:0});await old;
 expect(s.trades()[0]?.status).toBe("filled");expect(s.ledger("weather").positions[0]?.quantity).toBe(10);expect(s.ledger("weather").cash).toBe(997);
});
test("a slow paper refresh cannot resurrect a canceled order",async()=>{
 const s=setup();await s.submit({...trade,price:.4});let resolveMarket!:(m:Market)=>void;
 s.exchanges.kalshi.market=()=>new Promise(resolve=>{resolveMarket=resolve;});
 const refresh=s.reconcile("weather");await s.cancel("weather","one");resolveMarket({...market,yesAsk:.35});await refresh;
 expect(s.trades()[0]?.status).toBe("canceled");expect(s.ledger("weather").positions).toHaveLength(0);
});
test("late-night daily sessions catch up once after local midnight",()=>{
 const s=setup();s.saveStrategy({...s.strategy("weather"),dailyAt:"23:30"});
 const now=new Date("2026-11-05T06:30:00Z");const claims=s.claimDue(now);expect(claims).toHaveLength(1);
 const row=s.store.one<{due_key:string}>("SELECT due_key FROM runs WHERE id=?",claims[0].runId);expect(row?.due_key).toBe("weather:2026-11-04");
 s.finishRun(claims[0].runId,"Caught up");expect(s.claimDue(new Date("2026-11-05T07:00:00Z"))).toHaveLength(0);
 const later=setup();later.saveStrategy({...later.strategy("weather"),dailyAt:"23:30"});expect(later.claimDue(new Date("2026-11-05T08:00:00Z"))).toHaveLength(0);
});

test("new entries and discovery require verified two-sided liquidity, while sells may exit",async()=>{
 const s=setup();s.saveStrategy({...s.strategy("weather"),liquidity:{maxSpreadUsd:.03,minVolume24hContracts:10000,minBestDepthContracts:100}});
 let book:Market={...market,yesBid:.48,yesAsk:.5};s.exchanges.kalshi.market=async()=>book;s.exchanges.kalshi.discover=async()=>({markets:[book],cursor:"next"});
 expect((await s.discover("weather","kalshi")).markets).toHaveLength(1);
 for(const change of [{yesBid:.4},{volume24hContracts:9999},{yesBidSize:99},{yesAskSize:99},{volume24hContracts:undefined},{yesAsk:null},{category:"sports" as const}]) {
  const good=book;book={...good,...change};await expect(s.submit(trade)).rejects.toThrow();expect((await s.discover("weather","kalshi")).markets).toHaveLength(0);book=good;
 }
 await s.submit(trade);book={...book,yesBid:.4,volume24hContracts:0,yesBidSize:1,yesAskSize:1};
 expect((await s.submit({...trade,operationId:"exit",action:"sell",price:.4})).status).toBe("filled");
 expect(s.ledger("weather").positions).toHaveLength(0);
});
test("sports and other venues cannot be configured, and order size must fit visible depth",async()=>{
 const s=setup();expect(()=>s.saveStrategy({...s.strategy("weather"),venues:["polymarket"]})).toThrow();expect(()=>s.saveStrategy({...s.strategy("weather"),categories:["sports"]})).toThrow();
 s.exchanges.kalshi.market=async()=>({...market,yesBidSize:100,yesAskSize:100});
 await expect(s.submit({...trade,quantity:101,price:.01})).rejects.toThrow("depth");
});

test("unsupported historical orders remain unchanged and do not block Kalshi reconciliation",async()=>{
 const s=setup(true);const now=new Date().toISOString();
 const oldRequest=JSON.stringify({...trade,operationId:"legacy",venue:"polymarket"});
 const oldResult=JSON.stringify({orderId:"legacy-order",status:"open",filledQuantity:0});
 s.store.exec("INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?)","legacy","weather",oldRequest,"legacy-fingerprint","live","open",oldResult,now,now);
 await s.submit(trade);let reads=0;
 s.exchanges.kalshi.order=async()=>{reads++;return {orderId:"O",status:"filled",filledQuantity:10,averagePrice:.5};};
 const before=s.trades()[0];await s.reconcile("weather");
 expect(reads).toBe(1);expect(s.trades()[0]).toEqual(before);expect(s.trades()[1]?.status).toBe("filled");
 expect(s.ledger("weather").positions.find(p=>p.venue==="kalshi")?.quantity).toBe(10);
});
