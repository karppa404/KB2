import { afterEach, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { PaperAccount } from "./paper";
import { exportPnlPng, settlementPnlPoints } from "./pnl";

const directories: string[]=[];
const accounts: PaperAccount[]=[];
const directory=()=>{const p=mkdtempSync(join(tmpdir(),"kalshi-paper-test-"));directories.push(p);return p;};
const account=()=>{const a=new PaperAccount(join(directory(),"paper.db"));accounts.push(a);return a;};
afterEach(()=>{for(const a of accounts.splice(0))a.close();for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
const book={orderbook_fp:{yes_dollars:[["0.4000","2.00"],["0.5000","1.00"]],no_dollars:[["0.6000","2.00"],["0.7000","1.00"]]}};
const buy={ticker:"T",action:"buy" as const,side:"yes" as const,count:2,yes_price:50};
test("default paper mode, private files, persisted toggles and isolated reset",()=>{
 const dir=directory(), path=join(dir,"paper.db");const a=new PaperAccount(path);expect(a.status()).toMatchObject({mode:"paper",balanceUsd:10000,realizedPnlUsd:0});expect(lstatSync(path).mode&0o777).toBe(0o600);
 a.setMode(false);a.reset(250.25);a.close();const b=new PaperAccount(path);accounts.push(b);expect(b.status()).toMatchObject({mode:"live",balanceUsd:250.25,revision:2});
 expect(()=>b.reset(-1)).toThrow();expect(()=>b.reset(0.001)).toThrow();
});
test("weighted fills, cash and weighted cost basis realize exact fractional P/L",()=>{
 const a=account();a.reset(100);
 const filled=a.placeOrder(buy,book,1,100);expect(filled.order.average_price_dollars).toBe("0.350000");expect(a.status().balanceUsd).toBe(99.3);
 expect(a.status().positions[0]).toMatchObject({count:2,costBasisUsd:0.7});
 const sold=a.placeOrder({...buy,action:"sell",count:1.25,yes_price:40},book,1,200);expect(sold.order.realized_pnl_dollars).toBe("0.162500");
 expect(a.status()).toMatchObject({balanceUsd:99.9,realizedPnlUsd:0.1625});expect(a.status().positions[0]).toMatchObject({count:0.75,costBasisUsd:0.2625});
 a.placeOrder({...buy,action:"sell",count:0.75,yes_price:40},book,1,300);expect(a.status().positions).toHaveLength(0);expect(a.status().realizedPnlUsd).toBe(0.275);
 expect(a.pnl(150,250)).toEqual([{timestamp:200,pnlUsd:0.1625}]);expect(a.fills().fills).toHaveLength(3);expect(a.orders().orders).toEqual([]);
});
test("NO prices complement correctly and paper never short sells",()=>{
 const a=account();a.reset(10);
 const filled=a.placeOrder({...buy,side:"no",yes_price:undefined,no_price:60,count:1},book);
 expect(filled.order.average_price_dollars).toBe("0.500000");expect(a.status().balanceUsd).toBe(9.5);
 const sold=a.placeOrder({...buy,side:"no",action:"sell",yes_price:undefined,no_price:60,count:1},book);
 expect(sold.order.average_price_dollars).toBe("0.700000");expect(a.status().realizedPnlUsd).toBe(0.2);
 expect(()=>a.placeOrder({...buy,action:"sell",yes_price:40},book)).toThrow("Insufficient paper holdings");
});
test("failed depth, limit, balance and options never leave partial changes",()=>{
 const a=account();a.reset(1);const original=a.status();
 for(const order of [{...buy,count:4},{...buy,yes_price:20},{...buy,count:3,yes_price:80},{...buy,post_only:true},{...buy,expiration_ts:9999999999},{...buy,buy_max_cost:1},{...buy,no_price:20},{...buy,count:0.001}])expect(()=>a.placeOrder(order,book)).toThrow();
 expect(a.status()).toEqual(original);expect(a.fills().fills).toEqual([]);
 expect(()=>a.placeOrder(buy,{orderbook_fp:{no_dollars:[["oops","2"]]}})).toThrow();
});
test("toggle/reset revision race aborts snapshot instead of changing destination",()=>{
 const a=account();const captured=a.status().revision;a.setMode(false);a.setMode(true);
 expect(()=>a.placeOrder(buy,book,captured)).toThrow("Trading mode changed");expect(a.fills().fills).toEqual([]);
 const current=a.status().revision;a.reset(100);expect(()=>a.placeOrder(buy,book,current)).toThrow("Trading mode changed");
 a.setMode(false);expect(()=>a.placeOrder(buy,book)).toThrow("Trading mode changed");
});
test("unsafe paper database and directory rejected",()=>{
 const dir=directory();chmodSync(dir,0o755);expect(()=>new PaperAccount(join(dir,"paper.db"))).toThrow("owner-only");chmodSync(dir,0o700);
 const a=new PaperAccount(join(dir,"target.db"));a.close();symlinkSync(join(dir,"target.db"),join(dir,"paper.db"));expect(()=>new PaperAccount(join(dir,"paper.db"))).toThrow("owner-only");
});
test("settlement P/L distinguishes revenue cents from dollar costs and fees",()=>{
 expect(settlementPnlPoints([{revenue:150,yes_total_cost_dollars:"0.500000",no_total_cost_dollars:"0.1",fee_cost:"0.02",settled_time:"2026-01-01T00:00:00Z"}])).toEqual([{timestamp:1767225600,pnlUsd:0.88}]);
 expect(()=>settlementPnlPoints([{revenue:100,yes_total_cost_dollars:"invalid",no_total_cost_dollars:"0",fee_cost:"0",settled_time:"2026-01-01"}])).toThrow();
});
function chunks(image:Buffer){const result:Array<{type:string;data:Buffer}>=[];for(let p=8;p<image.length;){const size=image.readUInt32BE(p),type=image.toString("ascii",p+4,p+8);result.push({type,data:image.subarray(p+8,p+8+size)});p+=size+12;}return result;}
test("exports valid PNG with correct range baseline, loss values and private file",()=>{
 const result=exportPnlPng({points:[{timestamp:99,pnlUsd:999},{timestamp:100,pnlUsd:5},{timestamp:150,pnlUsd:-9},{timestamp:200,pnlUsd:1},{timestamp:201,pnlUsd:100}],startTs:100,endTs:200,source:"paper",directory:directory()});
 expect(result.summary).toMatchObject({records:3,periodPnlUsd:-3,baseline:"zero at range start",unrealizedPnlIncluded:false});expect(lstatSync(result.path).mode&0o777).toBe(0o600);
 const image=readFileSync(result.path);expect(image.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(image.toString("base64")).toBe(result.base64);
 const entries=chunks(image),header=entries.find(c=>c.type==="IHDR")!.data;expect(header.readUInt32BE(0)).toBe(1200);expect(header.readUInt32BE(4)).toBe(720);
 const raw=inflateSync(entries.find(c=>c.type==="IDAT")!.data);expect(raw.length).toBe(720*(1+1200*3));expect(entries.find(c=>c.type==="tEXt")!.data.toString()).toContain('"periodPnlUsd":-3');
});
test("empty export is honest zero-period graph and invalid range is rejected",()=>{
 const output=directory();expect(exportPnlPng({points:[],startTs:0,endTs:86400,source:"live-settlements",directory:output}).summary).toMatchObject({records:0,periodPnlUsd:0});
 for(const [startTs,endTs]of [[100,100],[200,100],[-1,100],[0,86400*366*11]])expect(()=>exportPnlPng({points:[],startTs:startTs!,endTs:endTs!,source:"paper",directory:output})).toThrow();
 expect(()=>exportPnlPng({points:[{timestamp:100,pnlUsd:NaN}],startTs:0,endTs:200,source:"paper",directory:output})).toThrow();
});
