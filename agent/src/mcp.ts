import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createService } from "./runtime";
import { strategySchema, tradeSchema, liquidityIssue } from "./service";
import { priceRuleSchema } from "./price-rules";
import { runModel } from "./models";
import { t3Plan } from "./t3";
const service=createService();
const server=new McpServer({name:"kb2-agents",version:"0.1.0"});
const sid=z.string().min(1).max(80), venue=z.literal("kalshi");
function register(name:string,description:string,schema:any,run:(args:any)=>unknown,write=false) {
 server.registerTool(name,{description,inputSchema:schema,annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:!write,openWorldHint:true}},async(args:any)=>{
   try { const result=await run(args); const structuredContent={result};return {content:[{type:"text" as const,text:JSON.stringify(structuredContent)}],structuredContent}; }
   catch(error) {const validation=error instanceof z.ZodError; const structuredContent={error:{code:validation?"INVALID_INPUT":"OPERATION_FAILED",message:validation?"Input failed validation":safeMessage(error),retry:"Read current state before retrying any trade; retain operationId"}}; return {isError:true,structuredContent,content:[{type:"text" as const,text:JSON.stringify(structuredContent)}]};}
 });
}
function safeMessage(error:unknown) {
 // Service errors are controlled strings; never echo transport responses or secret values.
 let message=error instanceof Error?error.message:"Operation failed";
 for(const [key,value] of Object.entries(process.env))if(/KEY|SECRET|TOKEN|PASSWORD/i.test(key)&&value)message=message.split(value).join("[REDACTED]");
 return message.slice(0,500);
}
register("strategies","Read strategy instructions, allowed markets, budgets, and toggles.",z.object({}).strict(),()=>service.strategies());
register("configure_strategy","Create/update a user-authored strategy. Preserve user permissions; never self-enable live mode.",strategySchema,input=>service.saveStrategy(input),true);
register("agent_state","Trade timeline, positions, feedback, wakes and equity observations. All amounts USD; prices are 0..1.",z.object({}).strict(),()=>service.dashboard());
register("discover_markets","Discover liquid Kalshi markets in allowed non-sports categories; checks volume, spread and current two-sided depth. Continue with cursor.",z.object({strategyId:sid,venue,cursor:z.string().optional()}).strict(),a=>service.discover(a.strategyId,a.venue,a.cursor));
register("market_detail","Fresh executable bid/ask in USD and resolution rules for a strategy-allowed market.",z.object({strategyId:sid,venue,marketId:z.string().min(1)}).strict(),async a=>{
 const strategy=service.strategy(a.strategyId);if(!strategy.venues.includes(a.venue))throw new Error("Venue is not allowed by strategy");
 const market=await service.exchanges[a.venue as "kalshi"].market(a.marketId);
 if(!strategy.categories.includes(market.category as any))throw new Error("Market category is not allowed or unverified");const issue=liquidityIssue(market,strategy);return {...market,entryEligible:issue===null,entryBlockReason:issue};
});
register("account_status","Read venue cash buying power in USD and actual positions. External positions are separate from the strategy ledger.",z.object({strategyId:sid,venue}).strict(),async a=>{
 if(!service.strategy(a.strategyId).venues.includes(a.venue))throw new Error("Venue is not allowed by strategy");
 const exchange=service.exchanges[a.venue as "kalshi"];return {venue:a.venue,balanceUsd:await exchange.balance(),positions:await exchange.positions()};
});
register("create_price_rule","Create a pending entry, take-profit, stop-loss or linked protection pair. Price is USD 0..1. Requires the T3 clock; not an exchange-native stop. Exits require owned holdings.",priceRuleSchema,a=>service.priceRules.create(a),true);
register("cancel_price_rule","Cancel a waiting price rule belonging to the strategy.",z.object({strategyId:sid,ruleId:sid}).strict(),a=>service.priceRules.cancel(a.strategyId,a.ruleId),true);
register("process_price_rules","Check pending rules against current executable quotes and submit triggered orders through strategy controls. Call each T3 tick. Limits may remain unfilled; linked exits cancel after one submits.",z.object({}).strict(),()=>service.priceRules.process(),true);
register("submit_trade","Submit an idempotent bounded intent. USD price 0..1. Keep operationId across retries. Inspect status: unknown/submitting MUST NOT be retried with a new ID. Paper by default. Maker quotes require expiry.",tradeSchema,a=>service.submit(a),true);
register("cancel_trade","Cancel a strategy-owned open order; remains available while paused.",z.object({strategyId:sid,tradeId:sid}).strict(),a=>service.cancel(a.strategyId,a.tradeId),true);
register("reconcile_orders","Refresh fills and cancellations before decisions; paper fills are simplified quote-crossing simulations.",z.object({strategyId:sid}).strict(),a=>service.reconcile(a.strategyId),true);
register("record_equity","Mark the strategy ledger to executable quotes and record equity for return charts. Includes only KB2-owned trades; excludes external transfers.",z.object({strategyId:sid}).strict(),a=>service.snapshot(a.strategyId),true);
register("trade_feedback","Record USER feedback on a trade or strategy to steer subsequent runs.",z.object({strategyId:sid,tradeId:sid.optional(),note:z.string().min(1).max(5000)}).strict(),a=>service.addFeedback(a.strategyId,a.note,a.tradeId),true);
register("claim_due_runs","Process pending price rules, then atomically claim daily exploration and follow-ups. Empty result means no research is due; rules may still have executed. Each claimed run must be finished.",z.object({}).strict(),async()=>{await service.priceRules.process();return service.claimDue();},true);
register("finish_run","Persist completed/no-trade/failed run summary.",z.object({runId:z.string(),summary:z.string().min(1).max(10000),failed:z.boolean().default(false)}).strict(),a=>service.finishRun(a.runId,a.summary,a.failed),true);
register("request_wake","Persist one UTC follow-up with a concrete reason. Enforces user autoReactivate toggle; T3 clock dispatches it.",z.object({strategyId:sid,at:z.iso.datetime(),reason:z.string().min(1).max(1000)}).strict(),a=>service.wake(a.strategyId,a.at,a.reason),true);
register("run_python_model","Execute trusted local Python authored for this strategy. NOT a sandbox: code can access user files. Read docs/modeling.md. Forecasts never authorize trading.",z.object({strategyId:sid,source:z.string().min(1).max(1000000),input:z.unknown()}).strict(),a=>{service.strategy(a.strategyId);return runModel(a.strategyId,a.source,a.input);},true);
register("t3_schedule_plan","Return native T3 schedule_task arguments and MCP launch configuration. Creating a plan does not activate a schedule.",z.object({}).strict(),t3Plan);
await server.connect(new StdioServerTransport());
