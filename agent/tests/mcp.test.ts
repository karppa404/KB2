import {test,expect} from "bun:test";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
test("actual MCP stdio supports strategy setup, model, feedback, wakes and run lifecycle",async()=>{
 const dir=mkdtempSync(join(tmpdir(),'kb2-mcp-'));const client=new Client({name:'proof',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['run',resolve(import.meta.dir,'../src/mcp.ts')],env:{PATH:process.env.PATH??'',KB2_AGENT_DB:join(dir,'state.db'),KB2_ENABLE_LIVE:'false',KALSHI_API_ID:'',KALSHI_PRIVATE_KEY:''},stderr:'pipe'});
 try{
  await client.connect(transport);const tools=await client.listTools();expect(tools.tools).toHaveLength(19);
  const call=async(name:string,args:any={})=>{const result=await client.callTool({name,arguments:args});expect(result.isError).not.toBe(true);return (result.structuredContent as any).result;};
  const now=new Date();const at=now.toISOString().slice(11,16);
  const config={id:'stdio',name:'Stdio',instructions:'Research before trading',categories:['weather'],venues:['kalshi'],timezone:'UTC',dailyAt:at,enabled:true,autoReactivate:true};
  expect((await call('configure_strategy',config)).mode).toBe('paper');
  await call('trade_feedback',{strategyId:'stdio',note:'Wait for official weather reports'});
  const claims=await call('claim_due_runs');expect(claims).toHaveLength(1);expect(claims[0].feedback).toHaveLength(1);
  const model=await call('run_python_model',{strategyId:'stdio',source:'import json,sys\nx=json.load(sys.stdin)\nprint(json.dumps({"forecasts":[],"metrics":{"observations":len(x)}}))',input:[]});expect(model.version).toHaveLength(64);
  await call('request_wake',{strategyId:'stdio',at:new Date(Date.now()+120000).toISOString(),reason:'Updated forecast release'});
  await call('record_equity',{strategyId:'stdio'});
  await call('finish_run',{runId:claims[0].runId,summary:'No evidence, no trade'});
  expect(await call('claim_due_runs')).toHaveLength(0);
  expect((await call('agent_state')).snapshots).toHaveLength(1);
  expect((await call('t3_schedule_plan')).enabled).toBe(false);expect(await call('process_price_rules')).toEqual([]);
 }finally{await client.close();rmSync(dir,{recursive:true,force:true});}
},10000);
