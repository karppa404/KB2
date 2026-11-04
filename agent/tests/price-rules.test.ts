import {test,expect} from "bun:test";
import {AgentService} from "../src/service";
import {Store} from "../src/store";
import {ExchangeError,type Exchange,type Market} from "../src/types";

function setup(live=false){
 let book:Market={venue:"kalshi",id:"CPI",title:"CPI above 3%?",category:"economics",strike:{type:"greater",floor:3},yesBid:.48,yesAsk:.5,yesBidSize:500,yesAskSize:500,volume24hContracts:20000,rules:"Official CPI release"};
 let writes=0;const exchange:Exchange={venue:"kalshi",market:async()=>book,discover:async()=>({markets:[book]}),place:async()=>{writes++;throw new ExchangeError("timeout","timeout",true);},cancel:async()=>{},order:async()=>({orderId:"O",status:"open",filledQuantity:0}),positions:async()=>[],balance:async()=>1000};
 const service=new AgentService(new Store(":memory:"),{kalshi:exchange},live);
 service.saveStrategy({id:"econ",name:"Economics",instructions:"CPI evidence",categories:["economics"],venues:["kalshi"],timezone:"UTC",mode:live?"live":"paper",enabled:true});
 const rule={strategyId:"econ",marketId:"CPI",outcome:"yes" as const,quantity:2,maxSlippageUsd:.01,expiresAt:new Date(Date.now()+86400000).toISOString()};
 const buy=async(outcome:"yes"|"no"="yes")=>service.submit({operationId:"buy",strategyId:"econ",venue:"kalshi",marketId:"CPI",outcome,action:"buy",price:.55,quantity:2,rationale:"Test fixture"});
 return {service,rule,buy,set:(patch:Partial<Market>)=>{book={...book,...patch};},writes:()=>writes};
}
test("target entry waits for executable ask, submits once and captures event strike",async()=>{
 const {service:s,rule,set}=setup();await s.priceRules.create({...rule,kind:"entry",triggerPrice:.45});
 expect(await s.priceRules.process()).toHaveLength(0);set({yesBid:.42,yesAsk:.44});
 await Promise.all([s.priceRules.process(),s.priceRules.process()]);expect(s.trades()).toHaveLength(1);expect(s.priceRules.list()[0]?.status).toBe("executed");
 expect(s.ledger("econ").positions[0]?.quantity).toBe(2);expect(s.dashboard().trades[0]?.market?.strike?.floor).toBe(3);
 expect(s.dashboard().strategies[0]?.ledger.positions[0]?.market?.strike?.floor).toBe(3);
 await s.priceRules.process();expect(s.trades()).toHaveLength(1);
});
test("linked take-profit sells owned contracts and cancels sibling stop-loss",async()=>{
 const {service:s,rule,buy,set}=setup();await buy();await s.priceRules.create({...rule,kind:"protection",takeProfitPrice:.7,stopLossPrice:.3});
 set({yesBid:.72,yesAsk:.74});await s.priceRules.process();
 expect(s.priceRules.list().map(row=>row.status)).toEqual(["executed","canceled"]);expect(s.ledger("econ").positions).toHaveLength(0);
 expect(JSON.parse(s.trades()[1]!.request).price).toBe(.71);await s.priceRules.process();expect(s.trades()).toHaveLength(2);
});
test("NO stop-loss compares the NO executable bid and permits exits from thin books",async()=>{
 const {service:s,rule,buy,set}=setup();await buy("no");await s.priceRules.create({...rule,outcome:"no",kind:"stop_loss",triggerPrice:.3});
 set({yesBid:.73,yesAsk:.75,yesBidSize:1,yesAskSize:1,volume24hContracts:0});await s.priceRules.process();
 expect(s.ledger("econ").positions).toHaveLength(0);expect(JSON.parse(s.trades()[1]!.request).price).toBe(.24);
});
test("rules obey pause, liquidity, ownership, budget, expiry and mode controls",async()=>{
 const {service:s,rule}=setup();await expect(s.priceRules.create({...rule,kind:"stop_loss",triggerPrice:.3})).rejects.toThrow("holdings");
 await expect(s.priceRules.create({...rule,kind:"protection",takeProfitPrice:.3,stopLossPrice:.7})).rejects.toThrow();expect(s.priceRules.list()).toHaveLength(0);
 const [created]=await s.priceRules.create({...rule,kind:"entry",triggerPrice:.6});s.saveStrategy({...s.strategy("econ"),enabled:false});await s.priceRules.process();expect(s.trades()).toHaveLength(0);expect(s.priceRules.list()[0]?.status).toBe("waiting");
 s.priceRules.cancel("econ",created!.id);expect(s.priceRules.list()[0]?.status).toBe("canceled");
 s.saveStrategy({...s.strategy("econ"),enabled:true,maxOrderUsd:.1});await s.priceRules.create({...rule,kind:"entry",triggerPrice:.6});await s.priceRules.process();expect(s.priceRules.list()[1]?.status).toBe("failed");expect(s.trades()).toHaveLength(0);
 const [expired]=await s.priceRules.create({...rule,kind:"entry",triggerPrice:.6});const body={...expired!.rule,expiresAt:new Date(Date.now()-1).toISOString()};s.store.exec("UPDATE price_rules SET body=? WHERE id=?",JSON.stringify(body),expired!.id);await s.priceRules.process();expect(s.priceRules.list()[2]?.status).toBe("expired");
});
test("uncertain execution is never replayed by later price-rule ticks",async()=>{
 const {service:s,rule,writes}=setup(true);await s.priceRules.create({...rule,kind:"entry",triggerPrice:.6});await s.priceRules.process();await s.priceRules.process();
 expect(writes()).toBe(1);expect(s.trades()[0]?.status).toBe("unknown");expect(s.priceRules.list()[0]?.status).toBe("uncertain");
});

test("cancel while checking a quote prevents submission, and a changed mode never retargets a rule",async()=>{
 const {service:s,rule}=setup();const [row]=await s.priceRules.create({...rule,kind:"entry",triggerPrice:.6});
 let resolve!:(market:Market)=>void;s.exchanges.kalshi.market=()=>new Promise(done=>{resolve=done;});
 const checking=s.priceRules.process();await Promise.resolve();await Promise.resolve();
 s.priceRules.cancel("econ",row!.id);resolve({venue:"kalshi",id:"CPI",title:"CPI",category:"economics",yesBid:.48,yesAsk:.5,yesBidSize:500,yesAskSize:500,volume24hContracts:20000,rules:"Official release"});await checking;expect(s.trades()).toHaveLength(0);
 const other=setup(true);other.service.saveStrategy({...other.service.strategy("econ"),mode:"paper"});await other.service.priceRules.create({...other.rule,kind:"entry",triggerPrice:.6});other.service.saveStrategy({...other.service.strategy("econ"),mode:"live"});await other.service.priceRules.process();expect(other.service.priceRules.list()[0]?.status).toBe("failed");expect(other.writes()).toBe(0);
});

test("closing a holding cancels waiting protection before a later re-entry",async()=>{
 const {service:s,rule,buy}=setup();await buy();await s.priceRules.create({...rule,kind:"protection",takeProfitPrice:.7,stopLossPrice:.3});
 await s.submit({operationId:"manual-exit",strategyId:"econ",venue:"kalshi",marketId:"CPI",outcome:"yes",action:"sell",quantity:2,price:.48,rationale:"Close holding"});
 await s.priceRules.process();expect(s.priceRules.list().map(row=>row.status)).toEqual(["canceled","canceled"]);expect(s.trades()).toHaveLength(2);
});
