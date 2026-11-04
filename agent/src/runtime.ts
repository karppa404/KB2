import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { Store } from "./store";
import { AgentService } from "./service";
import { createExchanges } from "./exchanges";
import { configureDefaultStrategy } from "./preset";

// Bun loads the cwd .env itself; explicit paths also support launching from a host's cwd.
for(const file of [resolve(import.meta.dir,"../../.env"),resolve(import.meta.dir,"../.env")]) {
  if(!existsSync(file)) continue;
  for(const line of readFileSync(file,"utf8").split(/\r?\n/)) {
    const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(!match)continue;
    let value=match[2]!.trim(); if(value.startsWith('"')&&value.endsWith('"')) {try{value=JSON.parse(value);}catch{continue;}} else if(value.startsWith("'")&&value.endsWith("'")) value=value.slice(1,-1);
    if(process.env[match[1]!]===undefined)process.env[match[1]!]=value;
  }
}
export function createService() { const service=new AgentService(new Store(),createExchanges());configureDefaultStrategy(service);return service; }
