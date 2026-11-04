import { createService } from "./runtime";
import { t3Plan } from "./t3";
const service=createService();
const command=process.argv[2];
try {
 if(command==="claim")await service.priceRules.process();
 const result=command==="claim"?service.claimDue():command==="state"?service.dashboard():command==="t3-plan"?t3Plan():undefined;
 if(result===undefined) throw new Error("Usage: bun src/cli.ts claim|state|t3-plan");
 console.log(JSON.stringify(result,null,2));
} catch {console.error("KB2 command failed; check configuration and local state");process.exitCode=1;}
finally{service.store.close();}
