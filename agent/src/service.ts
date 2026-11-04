import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store";
import { ExchangeError, type Exchange, type Venue, type Market, type OrderRequest, type OrderResult } from "./types";

export const categories = ["politics", "economics", "weather", "sports", "technology", "entertainment"] as const;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
export const strategySchema = z.object({
  id, name: z.string().trim().min(1).max(100), instructions: z.string().trim().min(1).max(20000),
  categories: z.array(z.enum(categories)).min(1), venues: z.array(z.enum(["kalshi", "polymarket"])).min(1),
  timezone: z.string().refine(v => { try { new Intl.DateTimeFormat("en", {timeZone:v}); return true; } catch {return false;} }, "Use an IANA timezone"),
  dailyAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default("03:00"),
  enabled: z.boolean().default(false), autoReactivate: z.boolean().default(false),
  mode: z.enum(["paper", "live"]).default("paper"), allowMarketMaking: z.boolean().default(false),
  maxOrderUsd: z.number().positive().max(10000).default(10), maxExposureUsd: z.number().positive().max(100000).default(100),
  dailyBuyLimitUsd: z.number().positive().max(100000).default(100), initialCashUsd: z.number().positive().max(1000000).default(1000),
}).strict();
export type Strategy = z.infer<typeof strategySchema>;
export const tradeSchema = z.object({
  operationId: id, strategyId: id, venue: z.enum(["kalshi", "polymarket"]), marketId: z.string().trim().min(1).max(300),
  outcome: z.enum(["yes","no"]), action: z.enum(["buy","sell"]), price: z.number().gt(0).lt(1),
  quantity: z.number().positive().max(100000).refine(n => Math.abs(n*100-Math.round(n*100))<1e-7,"Quantity supports two decimals"),
  postOnly: z.boolean().default(false), expiresAt: z.iso.datetime().optional(), rationale: z.string().trim().min(1).max(5000),
}).strict();
export type TradeInput = z.infer<typeof tradeSchema>;
export interface Trade { id: string; strategy_id: string; request: string; fingerprint: string; mode: "paper"|"live"; status: string; result: string|null; created_at: string; updated_at: string; }
const active = new Set(["submitting","unknown","open"]);
const time = () => new Date().toISOString();
const parse = <T>(v: string): T => JSON.parse(v);
const money = (n:number) => Math.round(n*1e6)/1e6;
export class AgentService {
  constructor(public store: Store, public exchanges: Record<Venue,Exchange>, private liveAllowed = process.env.KB2_ENABLE_LIVE === "true") {}
  strategies(): Strategy[] { return this.store.all<{body:string}>("SELECT body FROM strategies ORDER BY id").map(r=>parse(r.body)); }
  strategy(strategyId: string): Strategy {
    const row=this.store.one<{body:string}>("SELECT body FROM strategies WHERE id=?",strategyId);
    if(!row) throw new Error("Strategy not found"); return parse(row.body);
  }
  saveStrategy(input: unknown) {
    const s=strategySchema.parse(input);
    const old=this.store.one<{body:string}>("SELECT body FROM strategies WHERE id=?",s.id);
    if(old) {
      const previous=parse<Strategy>(old.body);
      const hasTrades=!!this.store.one("SELECT id FROM trades WHERE strategy_id=? LIMIT 1",s.id);
      if(hasTrades && (previous.mode!==s.mode || previous.initialCashUsd!==s.initialCashUsd)) throw new Error("Create a new strategy to change mode or starting cash after trading");
    }
    this.store.exec("INSERT INTO strategies VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",s.id,JSON.stringify(s));
    if(!s.autoReactivate || !s.enabled) this.store.exec("UPDATE wakes SET status='disabled' WHERE strategy_id=? AND status='pending'",s.id);
    return s;
  }
  trades(strategyId?: string): Trade[] { return strategyId ? this.store.all("SELECT * FROM trades WHERE strategy_id=? ORDER BY rowid",strategyId) : this.store.all("SELECT * FROM trades ORDER BY rowid"); }
  feedback(strategyId:string) {return this.store.all("SELECT * FROM feedback WHERE strategy_id=? ORDER BY created_at DESC LIMIT 100",strategyId);}
  addFeedback(strategyId:string,note:string,tradeId?:string) {
    this.strategy(strategyId); z.string().trim().min(1).max(5000).parse(note);
    if(tradeId && !this.trades(strategyId).some(t=>t.id===tradeId)) throw new Error("Trade does not belong to strategy");
    const row={id:randomUUID(),strategyId,tradeId:tradeId??null,note,createdAt:time()};
    this.store.exec("INSERT INTO feedback VALUES(?,?,?,?,?)",row.id,strategyId,row.tradeId,note,row.createdAt); return row;
  }
  ledger(strategyId:string) {
    const s=this.strategy(strategyId); let cash=s.initialCashUsd, reserved=0, buysToday=0;
    const positions=new Map<string,{venue:Venue;marketId:string;outcome:"yes"|"no";quantity:number;cost:number}>();
    const today=localClock(new Date(),s.timezone).date;
    for(const t of this.trades(strategyId)) {
      const r=parse<TradeInput>(t.request); const result=t.result?parse<OrderResult>(t.result):null;
      const filled=result?.filledQuantity??0, price=result?.averagePrice??r.price;
      const key=`${r.venue}:${r.marketId}:${r.outcome}`;
      const p=positions.get(key)??{venue:r.venue,marketId:r.marketId,outcome:r.outcome,quantity:0,cost:0};
      if(r.action==="buy") {cash-=filled*price+(result?.fees??0); p.quantity+=filled; p.cost+=filled*price;}
      else { const cost=p.quantity>0?p.cost/ p.quantity:0; p.quantity-=filled; p.cost-=filled*cost; cash+=filled*price-(result?.fees??0); }
      positions.set(key,p);
      if(active.has(t.status) && r.action==="buy") reserved+=(r.quantity-filled)*r.price;
      if(r.action==="buy" && t.status!=="rejected" && localClock(new Date(t.created_at),s.timezone).date===today) buysToday+=r.quantity*r.price;
    }
    const exposure=[...positions.values()].reduce((sum,p)=>sum+Math.max(0,p.cost),0)+reserved;
    return {cash:money(cash),reserved:money(reserved),exposure:money(exposure),buysToday:money(buysToday),positions:[...positions.values()].filter(p=>p.quantity>1e-8)};
  }
  async discover(strategyId:string, venue:Venue, cursor?:string) {
    const s=this.strategy(strategyId); if(!s.venues.includes(venue)) throw new Error("Venue is not allowed by strategy");
    const result=await this.exchanges[venue].discover(s.categories,cursor);
    return {...result,markets:result.markets.filter(m=>s.categories.includes(m.category as any))};
  }
  async submit(input: unknown) {
    const r=tradeSchema.parse(input); const fingerprint=createHash("sha256").update(JSON.stringify(r)).digest("hex");
    const duplicate=this.store.one<Trade>("SELECT * FROM trades WHERE id=?",r.operationId);
    if(duplicate) {if(duplicate.fingerprint!==fingerprint) throw new Error("Operation ID already used with different parameters");return duplicate;}
    const s=this.strategy(r.strategyId);
    if(!s.enabled) throw new Error("Strategy is paused");
    if(!s.venues.includes(r.venue)) throw new Error("Venue is not allowed by strategy");
    if(s.mode==="live" && !this.liveAllowed) throw new Error("Live execution requires KB2_ENABLE_LIVE=true at server startup");
    if(r.postOnly && !s.allowMarketMaking) throw new Error("Market making is not enabled for this strategy");
    if(r.expiresAt && Date.parse(r.expiresAt)<=Date.now()) throw new Error("Expiry must be in the future");
    if(r.postOnly && !r.expiresAt) throw new Error("Maker quotes require an expiry");
    const market=await this.exchanges[r.venue].market(r.marketId);
    if(!s.categories.includes(market.category as any)) throw new Error("Market category is not allowed or could not be verified");
    if(market.closesAt && Date.parse(market.closesAt)<=Date.now()) throw new Error("Market is closed");
    const request: OrderRequest={...r,clientOrderId:r.operationId,tokenId:r.outcome==="yes"?market.yesToken:market.noToken};
    const now=time();
    const inserted=this.store.atomic(()=>{
      const repeated=this.store.one<Trade>("SELECT * FROM trades WHERE id=?",r.operationId);
      if(repeated) {if(repeated.fingerprint!==fingerprint) throw new Error("Operation ID already used with different parameters");return false;}
      const current=this.strategy(s.id);
      if(!current.enabled || JSON.stringify(current)!==JSON.stringify(s)) throw new Error("Strategy changed; reload it before trading");
      if(this.trades(s.id).some(t=>t.status==="unknown" || t.status==="submitting")) throw new Error("Resolve uncertain or submitting orders before trading again");
      const l=this.ledger(s.id); const notional=money(r.price*r.quantity);
      if(notional>s.maxOrderUsd) throw new Error("Order exceeds maximum order USD");
      if(r.action==="buy" && (l.exposure+notional>s.maxExposureUsd || l.buysToday+notional>s.dailyBuyLimitUsd)) throw new Error("Exposure or daily buy limit exceeded");
      if(r.action==="buy" && l.cash-l.reserved<notional) throw new Error("Strategy cash budget exceeded");
      if(r.action==="sell") {
        const held=l.positions.find(p=>p.venue===r.venue&&p.marketId===r.marketId&&p.outcome===r.outcome)?.quantity??0;
        const pending=this.trades(s.id).filter(t=>active.has(t.status)).reduce((n,t)=>{const q=parse<TradeInput>(t.request);return n+(q.action==="sell"&&q.venue===r.venue&&q.marketId===r.marketId&&q.outcome===r.outcome?q.quantity-(t.result?parse<OrderResult>(t.result).filledQuantity:0):0);},0);
        if(r.quantity>held-pending+1e-8) throw new Error("Sell exceeds strategy-owned holdings");
      }
      this.store.exec("INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?)",r.operationId,s.id,JSON.stringify(r),fingerprint,s.mode,"submitting",null,now,now); return true;
    });
    if(!inserted) return this.store.one<Trade>("SELECT * FROM trades WHERE id=?",r.operationId)!;
    try {
      const result=s.mode==="paper"?this.paperResult(r,market):await this.exchanges[r.venue].place(request);
      this.setResult(r.operationId,result);
    } catch(error) {
      const uncertain=!(error instanceof ExchangeError) || error.uncertain;
      this.store.exec("UPDATE trades SET status=?,updated_at=? WHERE id=?",uncertain?"unknown":"rejected",time(),r.operationId);
      // Never persist an upstream exception that could contain credential-bearing transport data.
    }
    return this.store.one<Trade>("SELECT * FROM trades WHERE id=?",r.operationId)!;
  }
  private paperResult(r:TradeInput,m:Market):OrderResult {
    const bid=r.outcome==="yes"?m.yesBid:(m.yesAsk===null?null:1-m.yesAsk);
    const ask=r.outcome==="yes"?m.yesAsk:(m.yesBid===null?null:1-m.yesBid);
    const crosses=r.action==="buy"?(ask!==null&&r.price>=ask):(bid!==null&&r.price<=bid);
    if(r.postOnly&&crosses) return {orderId:`paper-${r.operationId}`,status:"rejected",filledQuantity:0};
    return {orderId:`paper-${r.operationId}`,status:crosses?"filled":"open",filledQuantity:crosses?r.quantity:0,averagePrice:crosses?(r.action==="buy"?ask!:bid!):undefined,fees:0};
  }
  private setResult(tradeId:string,result:OrderResult) {
    if(!Number.isFinite(result.filledQuantity)||result.filledQuantity<0) throw new Error("Invalid exchange fill");
    const t=this.store.one<Trade>("SELECT * FROM trades WHERE id=?",tradeId)!; const r=parse<TradeInput>(t.request);
    if(result.filledQuantity>r.quantity+1e-8 || (result.averagePrice!==undefined&&(!Number.isFinite(result.averagePrice)||result.averagePrice<0||result.averagePrice>1)) || (result.fees!==undefined&&(!Number.isFinite(result.fees)||result.fees<0))) throw new Error("Invalid exchange execution values");
    this.store.exec("UPDATE trades SET status=?,result=?,updated_at=? WHERE id=?",result.status,JSON.stringify(result),time(),tradeId);
  }
  private owned(strategyId:string,tradeId:string) {this.strategy(strategyId);const t=this.store.one<Trade>("SELECT * FROM trades WHERE id=? AND strategy_id=?",tradeId,strategyId);if(!t) throw new Error("Trade does not belong to strategy");return t;}
  async cancel(strategyId:string,tradeId:string) {
    const t=this.owned(strategyId,tradeId); if(t.status!=="open") throw new Error("Only known open orders can be canceled");
    const r=parse<TradeInput>(t.request), result=parse<OrderResult>(t.result!);
    if(t.mode==="live") {if(!this.liveAllowed) throw new Error("Live execution disabled");await this.exchanges[r.venue].cancel(result.orderId);const latest=await this.exchanges[r.venue].order(result.orderId);this.setResult(t.id,latest);}
    else this.setResult(t.id,{...result,status:"canceled"});
    return this.owned(strategyId,tradeId);
  }
  async reconcile(strategyId:string) {
    this.strategy(strategyId);
    for(const t of this.trades(strategyId)) {
      if(t.status!=="open") continue;
      const r=parse<TradeInput>(t.request), prior=parse<OrderResult>(t.result!);
      if(t.mode==="live") this.setResult(t.id,await this.exchanges[r.venue].order(prior.orderId));
      else if(r.expiresAt&&Date.parse(r.expiresAt)<=Date.now()) this.setResult(t.id,{...prior,status:"canceled"});
      else this.setResult(t.id,this.paperResult(r,await this.exchanges[r.venue].market(r.marketId)));
    }
    return this.trades(strategyId);
  }
  async snapshot(strategyId:string) {
    const s=this.strategy(strategyId); const l=this.ledger(strategyId); let equity=l.cash;
    for(const p of l.positions) {const m=await this.exchanges[p.venue].market(p.marketId);const mark=p.outcome==="yes"?m.yesBid:(m.yesAsk===null?null:1-m.yesAsk);if(mark===null) throw new Error("Cannot value portfolio without executable quote");equity+=p.quantity*mark;}
    const at=time();this.store.exec("INSERT INTO snapshots(strategy_id,at,equity,mode) VALUES(?,?,?,?)",s.id,at,equity,s.mode);
    return {at,equity:money(equity),returnPct:money((equity/s.initialCashUsd-1)*100),mode:s.mode};
  }
  wake(strategyId:string,at:string,reason:string) {
    const s=this.strategy(strategyId); if(!s.enabled||!s.autoReactivate) throw new Error("Automatic reactivation is disabled");
    z.iso.datetime().parse(at);z.string().trim().min(1).max(1000).parse(reason);
    if(Date.parse(at)<Date.now()+60000||Date.parse(at)>Date.now()+30*86400000) throw new Error("Wake must be 1 minute to 30 days in the future");
    const existing=this.store.one("SELECT * FROM wakes WHERE strategy_id=? AND status='pending'",s.id);if(existing) throw new Error("A follow-up wake is already pending");
    const row={id:randomUUID(),strategyId,at,reason}; this.store.exec("INSERT INTO wakes(id,strategy_id,at,reason) VALUES(?,?,?,?)",row.id,s.id,at,reason); return row;
  }
  claimDue(now=new Date()) {
    return this.store.atomic(()=>{
      const work: any[]=[];
      for(const s of this.strategies().filter(s=>s.enabled)) {
        if(this.store.one("SELECT id FROM runs WHERE strategy_id=? AND status='running'",s.id)) continue;
        const clock=localClock(now,s.timezone); const [h,m]=s.dailyAt.split(":").map(Number); const since=clock.minute-(h!*60+m!);
        const due=s.autoReactivate?this.store.one<{id:string;reason:string}>("SELECT id,reason FROM wakes WHERE strategy_id=? AND status='pending' AND at<=? ORDER BY at LIMIT 1",s.id,now.toISOString()):undefined;
        const daily=since>=0&&since<120&&!this.store.one("SELECT id FROM runs WHERE due_key=?",`${s.id}:${clock.date}`);
        if(!daily&&!due) continue;
        const runId=randomUUID(), key=daily?`${s.id}:${clock.date}`:`wake:${due!.id}`;
        this.store.exec("INSERT INTO runs(id,strategy_id,due_key,status,created_at) VALUES(?,?,?,'running',?)",runId,s.id,key,now.toISOString());
        if(!daily&&due)this.store.exec("UPDATE wakes SET status='claimed' WHERE id=?",due.id);
        work.push({runId,strategy:s,reason:daily?"daily exploration":due!.reason,feedback:this.feedback(s.id),ledger:this.ledger(s.id)});
      }
      return work;
    });
  }
  finishRun(runId:string,summary:string,failed=false) {
    z.string().min(1).max(10000).parse(summary);
    const result=this.store.exec("UPDATE runs SET status=?,summary=?,finished_at=? WHERE id=? AND status='running'",failed?"failed":"completed",summary,time(),runId);
    if(!result.changes) throw new Error("Active run not found");
    return {runId,status:failed?"failed":"completed"};
  }
  dashboard() {
    return {at:time(),liveExecutionEnabled:this.liveAllowed,strategies:this.strategies().map(s=>({...s,ledger:this.ledger(s.id)})),trades:this.trades().slice(-200).reverse().map(t=>({...t,request:parse(t.request),result:t.result?parse(t.result):null})),feedback:this.store.all("SELECT * FROM feedback ORDER BY created_at DESC LIMIT 100"),wakes:this.store.all("SELECT * FROM wakes WHERE status='pending' ORDER BY at"),runs:this.store.all("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50"),snapshots:this.store.all("SELECT * FROM (SELECT * FROM snapshots ORDER BY id DESC LIMIT 2000) ORDER BY id")};
  }
}
export function localClock(date:Date,timezone:string) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return {date:`${get("year")}-${get("month")}-${get("day")}`,minute:Number(get("hour"))*60+Number(get("minute"))};
}
