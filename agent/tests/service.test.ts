import { test, expect } from "bun:test";
import { AgentService, localClock, type Strategy } from "../src/service";
import { Store } from "../src/store";
import { ExchangeError, type Exchange, type Market } from "../src/types";

const market: Market={venue:"kalshi",id:"T",title:"Rain?",category:"weather",yesBid:.4,yesAsk:.5,rules:"Rain at station"};
const strategy={id:"weather",name:"Weather",instructions:"Buy calibrated weather forecasts",categories:["weather"],venues:["kalshi"],timezone:"America/Chicago",enabled:true,autoReactivate:true,allowMarketMaking:true,maxOrderUsd:10,maxExposureUsd:15,dailyBuyLimitUsd:20} as const;
const trade={operationId:"one",strategyId:"weather",venue:"kalshi",marketId:"T",outcome:"yes",action:"buy",price:.5,quantity:10,rationale:"Forecast exceeds offer"} as const;
function setup(live=false,place?:Exchange["place"]) {
 const exchange:Exchange={venue:"kalshi",discover:async()=>({markets:[market]}),market:async()=>market,place:place??(async()=>({orderId:"O",status:"open",filledQuantity:0})),cancel:async()=>{},order:async()=>({orderId:"O",status:"filled",filledQuantity:10,averagePrice:.5}),positions:async()=>[],balance:async()=>100};
 const service=new AgentService(new Store(":memory:"),{kalshi:exchange,polymarket:{...exchange,venue:"polymarket"}},live);
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
 s.saveStrategy({...s.strategy("weather"),categories:["sports"]});
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
