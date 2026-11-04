import {test,expect} from "bun:test";
import {AgentService,categories} from "../src/service";
import {configureDefaultStrategy} from "../src/preset";
import {Store} from "../src/store";
function service(){return new AgentService(new Store(":memory:"),{kalshi:{} as any});}
test("default strategy is liquid non-sports Kalshi, paper and paused",()=>{
 const s=service();configureDefaultStrategy(s);const strategy=s.strategy("liquid-non-sports");
 expect(strategy.venues).toEqual(["kalshi"]);expect(strategy.categories).toEqual([...categories]);expect(strategy.categories).not.toContain("sports");
 expect(strategy.liquidity).toEqual({minVolume24hContracts:10000,maxSpreadUsd:.03,minBestDepthContracts:100});expect(strategy.mode).toBe("paper");expect(strategy.enabled).toBe(false);
 s.saveStrategy({...strategy,maxOrderUsd:2});configureDefaultStrategy(s);expect(s.strategy(strategy.id).maxOrderUsd).toBe(2);
});
test("old strategy settings migrate without altering capital or live/pause flags",()=>{
 const s=service();s.store.exec("INSERT INTO strategies VALUES(?,?)","legacy",JSON.stringify({id:"legacy",name:"Legacy",instructions:"Research",categories:["sports","weather"],venues:["kalshi","polymarket"],timezone:"UTC",mode:"live",enabled:false,initialCashUsd:500}));
 configureDefaultStrategy(s);const strategy=s.strategy("legacy");expect(strategy.venues).toEqual(["kalshi"]);expect(strategy.categories).toEqual(["weather"]);expect(strategy.mode).toBe("live");expect(strategy.enabled).toBe(false);expect(strategy.initialCashUsd).toBe(500);
});
