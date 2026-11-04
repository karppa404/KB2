import {test,expect} from "bun:test";
import {handler} from "../src/server";
import {AgentService} from "../src/service";
import {Store} from "../src/store";
const exchange:any={};
const service=new AgentService(new Store(":memory:"),{kalshi:exchange,polymarket:exchange});const handle=handler(service);
const config={id:"test",name:"Test",instructions:"Wait for good evidence",timezone:"America/Chicago",venues:["kalshi"],categories:["weather"]};
test("dashboard serves local assets and safe empty state",async()=>{
 for(const path of ['/','/app.js','/style.css','/api/state','/api/t3-plan']){const r=await handle(new Request('http://localhost:3100'+path));expect(r.status).toBe(200);expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");}
 expect((await handle(new Request('http://evil.test/api/state'))).status).toBe(403);
});
test("mutations require same-origin JSON and validate strategy",async()=>{
 const request=(headers:any,body:any=config)=>new Request('http://localhost:3100/api/strategies',{method:'POST',headers,body:JSON.stringify(body)});
 expect((await handle(request({'content-type':'application/json',origin:'https://evil.test'}))).status).toBe(403);
 expect((await handle(request({'content-type':'text/plain',origin:'http://localhost:3100'}))).status).toBe(403);
 expect((await handle(request({'content-type':'application/json',origin:'http://localhost:3100'},{...config,timezone:'invalid'}))).status).toBe(400);
 const response=await handle(request({'content-type':'application/json',origin:'http://localhost:3100'}));expect(response.status).toBe(200);expect((await response.json()).mode).toBe('paper');
});
