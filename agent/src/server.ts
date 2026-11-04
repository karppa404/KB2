import { AgentService, strategySchema } from "./service";
import { createService } from "./runtime";
import { t3Plan } from "./t3";
import { z } from "zod";
import { resolve } from "node:path";
export function handler(service:AgentService) {
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url);
  if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))return new Response("Local access only",{status:403});
  const headers={"cache-control":"no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"};
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers});
  try {
   if(request.method==="GET") {
    if(url.pathname==="/api/state")return json(service.dashboard());
    if(url.pathname==="/api/t3-plan")return json(t3Plan());
    const files:Record<string,string>={"/":"index.html","/app.js":"app.js","/style.css":"style.css"};
    const file=files[url.pathname];if(file)return new Response(Bun.file(resolve(import.meta.dir,"../web",file)),{headers});
    return json({error:"Not found"},404);
   }
   if(request.method!=="POST")return json({error:"Method not allowed"},405);
   if(request.headers.get("origin")!==url.origin || !request.headers.get("content-type")?.startsWith("application/json"))return json({error:"Same-origin JSON required"},403);
   const body=await request.text();if(Buffer.byteLength(body)>50000)return json({error:"Request too large"},413);
   const input=JSON.parse(body);
   if(url.pathname==="/api/strategies") return json(service.saveStrategy(strategySchema.parse(input)));
   if(url.pathname==="/api/feedback") {const a=z.object({strategyId:z.string(),note:z.string().min(1).max(5000),tradeId:z.string().optional()}).strict().parse(input);return json(service.addFeedback(a.strategyId,a.note,a.tradeId));}
   if(url.pathname==="/api/reconcile"||url.pathname==="/api/snapshot") {const a=z.object({strategyId:z.string()}).strict().parse(input);return json(url.pathname.endsWith("snapshot")?await service.snapshot(a.strategyId):await service.reconcile(a.strategyId));}
   if(url.pathname==="/api/cancel") {const a=z.object({strategyId:z.string(),tradeId:z.string()}).strict().parse(input);return json(await service.cancel(a.strategyId,a.tradeId));}
   if(url.pathname==="/api/finish-run") {const a=z.object({runId:z.string(),summary:z.string().min(1).max(10000)}).strict().parse(input);return json(service.finishRun(a.runId,a.summary,true));}
   return json({error:"Not found"},404);
  } catch(error) {
   // Upstream error payloads may contain private account or signing details.
   return json({error:error instanceof z.ZodError?"Invalid settings; check required fields and limits":"Operation failed. Check strategy settings, exchange connectivity, and current order state."},400);
  }
 };
}
if(import.meta.main){const port=Number(process.env.KB2_AGENT_PORT??3100);const server=Bun.serve({hostname:"127.0.0.1",port,fetch:handler(createService())});console.log(`KB2 agent desk: ${server.url}`);}
