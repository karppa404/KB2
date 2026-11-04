import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createService } from "./runtime";
import { strategySchema, tradeSchema } from "./service";
import { runModel } from "./models";
import { t3Plan } from "./t3";
const service=createService();
const server=new McpServer({name:"kb2-agents",version:"0.1.0"});
const sid=z.string().min(1).max(80), venue=z.enum(["kalshi","polymarket"]);
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
register("discover_markets","Explore only verified categories allowed by the strategy. Continue with cursor.",z.object({strategyId:sid,venue,cursor:z.string().optional()}).strict(),a=>service.discover(a.strategyId,a.venue,a.cursor));
register("submit_trade","Submit an idempotent bounded intent. USD price 0..1. Keep operationId across retries. Inspect status: unknown/submitting MUST NOT be retried with a new ID. Paper by default. Maker quotes require expiry.",tradeSchema,a=>service.submit(a),true);
register("cancel_trade","Cancel a strategy-owned open order; remains available while paused.",z.object({strategyId:sid,tradeId:sid}).strict(),a=>service.cancel(a.strategyId,a.tradeId),true);
register("reconcile_orders","Refresh fills and cancellations before decisions; paper fills are simplified quote-crossing simulations.",z.object({strategyId:sid}).strict(),a=>service.reconcile(a.strategyId),true);
register("record_equity","Mark the strategy ledger to executable quotes and record equity for return charts. Includes only KB2-owned trades; excludes external transfers.",z.object({strategyId:sid}).strict(),a=>service.snapshot(a.strategyId),true);
register("trade_feedback","Record USER feedback on a trade or strategy to steer subsequent runs.",z.object({strategyId:sid,tradeId:sid.optional(),note:z.string().min(1).max(5000)}).strict(),a=>service.addFeedback(a.strategyId,a.note,a.tradeId),true);
register("claim_due_runs","Atomically claim daily local-time exploration and due follow-ups. Empty result means stop. Each run must be finished; crashed runs need user review.",z.object({}).strict(),()=>service.claimDue(),true);
register("finish_run","Persist completed/no-trade/failed run summary.",z.object({runId:z.string(),summary:z.string().min(1).max(10000),failed:z.boolean().default(false)}).strict(),a=>service.finishRun(a.runId,a.summary,a.failed),true);
register("request_wake","Persist one UTC follow-up with a concrete reason. Enforces user autoReactivate toggle; T3 clock dispatches it.",z.object({strategyId:sid,at:z.iso.datetime(),reason:z.string().min(1).max(1000)}).strict(),a=>service.wake(a.strategyId,a.at,a.reason),true);
register("run_python_model","Execute trusted local Python authored for this strategy. NOT a sandbox: code can access user files. Read docs/modeling.md. Forecasts never authorize trading.",z.object({strategyId:sid,source:z.string().min(1).max(1000000),input:z.unknown()}).strict(),a=>{service.strategy(a.strategyId);return runModel(a.strategyId,a.source,a.input);},true);
register("t3_schedule_plan","Return native T3 schedule_task arguments and MCP launch configuration. Creating a plan does not activate a schedule.",z.object({}).strict(),t3Plan);
await server.connect(new StdioServerTransport());
