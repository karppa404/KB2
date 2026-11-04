import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AgentService } from "./service";
import type { Market, OrderResult } from "./types";

const price=z.number().gt(0).lt(1);
const base={strategyId:z.string().min(1),marketId:z.string().min(1),outcome:z.enum(["yes","no"]),quantity:z.number().positive().max(100000).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-7,"Quantity supports two decimals"),maxSlippageUsd:z.number().nonnegative().max(.1).default(.01),expiresAt:z.iso.datetime()};
export const priceRuleSchema=z.discriminatedUnion("kind",[
 z.object({...base,kind:z.literal("entry"),triggerPrice:price}).strict(),
 z.object({...base,kind:z.literal("take_profit"),triggerPrice:price}).strict(),
 z.object({...base,kind:z.literal("stop_loss"),triggerPrice:price}).strict(),
 z.object({...base,kind:z.literal("protection"),takeProfitPrice:price,stopLossPrice:price}).strict(),
]).refine(v=>v.kind!=="protection"||v.stopLossPrice<v.takeProfitPrice,"Stop-loss must be below take-profit");
export type PriceRule = {
 id:string;strategyId:string;marketId:string;outcome:"yes"|"no";quantity:number;kind:"entry"|"take_profit"|"stop_loss";
 triggerPrice:number;maxSlippageUsd:number;expiresAt:string;market:Market;
};
interface Row {id:string;strategy_id:string;group_key:string;mode:"paper"|"live";body:string;status:string;trade_id:string|null;error:string|null;created_at:string;updated_at:string;}
const now=()=>new Date().toISOString();
export class PriceRules {
 constructor(private service:AgentService) {}
 list(){return this.service.store.all<Row>("SELECT * FROM price_rules ORDER BY rowid").map(row=>({...row,rule:JSON.parse(row.body) as PriceRule}));}
 async create(input:unknown) {
  const value=priceRuleSchema.parse(input), strategy=this.service.strategy(value.strategyId);
  if(Date.parse(value.expiresAt)<=Date.now()||Date.parse(value.expiresAt)>Date.now()+30*86400000)throw new Error("Rule expiry must be in the next 30 days");
  const market=await this.service.exchanges.kalshi.market(value.marketId);
  if(!strategy.categories.includes(market.category as any))throw new Error("Market category is not allowed");
  if(market.closesAt&&Date.parse(market.closesAt)<=Date.now())throw new Error("Market is closed");
  if(value.kind!=="entry") {
   const held=this.service.ledger(strategy.id).positions.find(p=>p.venue==="kalshi"&&p.marketId===value.marketId&&p.outcome===value.outcome)?.quantity??0;
   if(value.quantity>held+1e-8)throw new Error("Exit rule exceeds strategy-owned holdings");
  }
  const rules:PriceRule[]=value.kind==="protection"?
   [this.build(value,market,"take_profit",value.takeProfitPrice),this.build(value,market,"stop_loss",value.stopLossPrice)]:
   [this.build(value,market,value.kind,value.triggerPrice)];
  return this.service.store.atomic(()=>{
   const current=this.service.strategy(strategy.id);if(JSON.stringify(current)!==JSON.stringify(strategy))throw new Error("Strategy changed; reload before creating a rule");
   for(const rule of rules) {
    const group=rule.kind==="entry"?`entry:${rule.id}`:`exit:${strategy.id}:${rule.marketId}:${rule.outcome}`;
    if(this.list().some(row=>row.group_key===group&&["waiting","executing","uncertain"].includes(row.status)&&row.rule.kind===rule.kind))throw new Error("Cancel the existing rule of this type before replacing it");
    const at=now();this.service.store.exec("INSERT INTO price_rules VALUES(?,?,?,?,?,'waiting',NULL,NULL,?,?)",rule.id,strategy.id,group,strategy.mode,JSON.stringify(rule),at,at);
   }
   return this.list().filter(row=>rules.some(rule=>rule.id===row.id));
  });
 }
 private build(value:z.infer<typeof priceRuleSchema>,market:Market,kind:PriceRule["kind"],triggerPrice:number):PriceRule {
  return {id:randomUUID(),strategyId:value.strategyId,marketId:value.marketId,outcome:value.outcome,quantity:value.quantity,kind,triggerPrice,maxSlippageUsd:value.maxSlippageUsd,expiresAt:value.expiresAt,market};
 }
 cancel(strategyId:string,id:string) {
  this.service.strategy(strategyId);
  const changes=this.service.store.exec("UPDATE price_rules SET status='canceled',updated_at=? WHERE id=? AND strategy_id=? AND status='waiting'",now(),id,strategyId).changes;
  if(!changes)throw new Error("Only a waiting rule belonging to this strategy can be canceled");
  return this.list().find(row=>row.id===id);
 }
 async process() {
  const outcomes:unknown[]=[];const reconciled=new Set<string>();
  for(const row of this.list().filter(row=>row.status==="waiting")) {
   const {rule}=row;
   if(Date.parse(rule.expiresAt)<=Date.now()) {this.service.store.exec("UPDATE price_rules SET status='expired',updated_at=? WHERE id=? AND status='waiting'",now(),row.id);continue;}
   const strategy=this.service.strategy(rule.strategyId);
   if(!strategy.enabled||strategy.mode==="live"&&!this.service.liveExecutionEnabled)continue;
   if(strategy.mode!==row.mode){this.fail(row.id,"Strategy execution mode changed; create a new rule");continue;}
   let quote:number|null;
   try {
    if(!reconciled.has(strategy.id)){await this.service.reconcile(strategy.id);reconciled.add(strategy.id);}
    if(rule.kind!=="entry"&&!this.service.ledger(strategy.id).positions.some(position=>position.venue==="kalshi"&&position.marketId===rule.marketId&&position.outcome===rule.outcome&&position.quantity>0)) {
     this.service.store.exec("UPDATE price_rules SET status='canceled',error='Position is no longer held',updated_at=? WHERE group_key=? AND status='waiting'",now(),row.group_key);continue;
    }
    const market=await this.service.exchanges.kalshi.market(rule.marketId);
    const bid=rule.outcome==="yes"?market.yesBid:market.yesAsk===null?null:1-market.yesAsk;
    const ask=rule.outcome==="yes"?market.yesAsk:market.yesBid===null?null:1-market.yesBid;
    quote=rule.kind==="entry"?ask:bid;
    if(quote===null||!Number.isFinite(quote)||quote<=0||quote>=1)continue;
    const triggered=rule.kind==="take_profit"?quote>=rule.triggerPrice:quote<=rule.triggerPrice;
    if(!triggered)continue;
   }catch{this.service.store.exec("UPDATE price_rules SET error='Unable to refresh market or order state',updated_at=? WHERE id=? AND status='waiting'",now(),row.id);continue;}
   const claimed=this.service.store.atomic(()=>{
    // Only one price-rule writer per strategy, including across local processes.
    if(this.service.store.one("SELECT id FROM price_rules WHERE strategy_id=? AND status IN ('executing','uncertain')",strategy.id))return false;
    return !!this.service.store.exec("UPDATE price_rules SET status='executing',error=NULL,updated_at=? WHERE id=? AND status='waiting'",now(),row.id).changes;
   });
   if(!claimed)continue;
   try {
    const limit=rule.kind==="entry"?rule.triggerPrice:Math.max(.0001,Math.floor((quote!-rule.maxSlippageUsd+1e-10)*10000)/10000);
    const trade=await this.service.submit({operationId:`rule-${rule.id}`,strategyId:strategy.id,venue:"kalshi",marketId:rule.marketId,outcome:rule.outcome,action:rule.kind==="entry"?"buy":"sell",quantity:rule.quantity,price:limit,expiresAt:rule.expiresAt,rationale:`${rule.kind} price rule ${rule.id}: observed ${quote}, trigger ${rule.triggerPrice}`},row.mode);
    const filled=trade.result?(JSON.parse(trade.result) as OrderResult).filledQuantity:0;
    const status=["unknown","submitting"].includes(trade.status)?"uncertain":trade.status==="rejected"?"failed":"executed";
    this.service.store.atomic(()=>{
     this.service.store.exec("UPDATE price_rules SET status=?,trade_id=?,updated_at=? WHERE id=? AND status='executing'",status,trade.id,now(),row.id);
     if(rule.kind!=="entry"&&(trade.status!=="rejected"||filled>0))this.service.store.exec("UPDATE price_rules SET status='canceled',error='Linked exit triggered',updated_at=? WHERE group_key=? AND id!=? AND status='waiting'",now(),row.group_key,row.id);
    });
    outcomes.push({ruleId:row.id,tradeId:trade.id,status});
   }catch{this.fail(row.id,"Rule could not submit; inspect current holdings, liquidity and budgets before creating a replacement");outcomes.push({ruleId:row.id,status:"failed"});}
  }
  return outcomes;
 }
 private fail(id:string,error:string){this.service.store.exec("UPDATE price_rules SET status='failed',error=?,updated_at=? WHERE id=? AND status IN ('waiting','executing')",error,now(),id);}
}
