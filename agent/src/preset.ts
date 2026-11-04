import { AgentService, categories, strategySchema } from "./service";

export const liquidStrategy = {
  id:"liquid-non-sports",name:"Liquid non-sports",
  instructions:"Trade only liquid Kalshi markets outside sports. Explore politics, economics, weather, technology and entertainment. Require at least 10,000 contracts traded in the last 24 hours, a bid/ask spread no wider than $0.03, and at least 100 contracts at each best bid and ask. Size every entry within current book depth and the strategy budgets. Read resolution rules and use verifiable, timely evidence to estimate probabilities; enter only when the estimated edge remains positive after spread and fees. Do not trade just to be active. Reconcile existing orders before changing positions; prefer limit orders, reduce exposure when the thesis weakens, and record the rationale. Do not provide liquidity unless the user enables market making.",
  categories:[...categories],venues:["kalshi"],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
  mode:"paper",enabled:false,autoReactivate:false,
};

export function configureDefaultStrategy(service:AgentService) {
  const rows=service.store.all<{body:string}>("SELECT body FROM strategies");
  if(!rows.length) {service.saveStrategy(liquidStrategy);return;}
  for(const row of rows) {
    const old=JSON.parse(row.body);
    const allowed=Array.isArray(old.categories)?old.categories.filter((category:string)=>categories.includes(category as any)):[];
    // Retain accounting, capital, mode and user pauses; obsolete sports-only strategies stay paused.
    const next=strategySchema.parse({...old,venues:["kalshi"],categories:allowed.length?allowed:[...categories],enabled:allowed.length?old.enabled:false});
    service.saveStrategy(next);
  }
}
