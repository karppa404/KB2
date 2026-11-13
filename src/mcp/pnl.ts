import { randomUUID } from "node:crypto";
import { constants, closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { defaultDataDirectory, privateDirectory } from "./paper";

export interface PnlPoint { timestamp: number; pnlUsd: number }
export interface SettlementPnlInput { revenue: number; yes_total_cost_dollars: string; no_total_cost_dollars: string; fee_cost: string; settled_time: string }
export function settlementPnlPoints(settlements: unknown[]): PnlPoint[] {
  return settlements.map(item => {
    if (!item || typeof item !== "object") throw new Error("Invalid settlement record");
    const s = item as SettlementPnlInput;
    if (typeof s.settled_time !== "string") throw new Error("Invalid settlement timestamp");
    const timestamp = Date.parse(s.settled_time) / 1000;
    const values = [s.yes_total_cost_dollars, s.no_total_cost_dollars, s.fee_cost];
    if (!Number.isFinite(timestamp) || !Number.isSafeInteger(s.revenue) || s.revenue < 0 || values.some(v => typeof v !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(v))) throw new Error("Invalid settlement monetary fields or timestamp; cannot calculate P/L");
    return { timestamp, pnlUsd: (s.revenue * 10000 - values.reduce((sum,v) => sum + Math.round(Number(v) * 1_000_000), 0)) / 1_000_000 };
  });
}

const font: Record<string,string> = {
  A:"01110/10001/10001/11111/10001/10001/10001",B:"11110/10001/10001/11110/10001/10001/11110",C:"01111/10000/10000/10000/10000/10000/01111",D:"11110/10001/10001/10001/10001/10001/11110",E:"11111/10000/10000/11110/10000/10000/11111",F:"11111/10000/10000/11110/10000/10000/10000",G:"01111/10000/10000/10111/10001/10001/01111",H:"10001/10001/10001/11111/10001/10001/10001",I:"11111/00100/00100/00100/00100/00100/11111",J:"00111/00010/00010/00010/00010/10010/01100",K:"10001/10010/10100/11000/10100/10010/10001",L:"10000/10000/10000/10000/10000/10000/11111",M:"10001/11011/10101/10101/10001/10001/10001",N:"10001/11001/10101/10011/10001/10001/10001",O:"01110/10001/10001/10001/10001/10001/01110",P:"11110/10001/10001/11110/10000/10000/10000",Q:"01110/10001/10001/10001/10101/10010/01101",R:"11110/10001/10001/11110/10100/10010/10001",S:"01111/10000/10000/01110/00001/00001/11110",T:"11111/00100/00100/00100/00100/00100/00100",U:"10001/10001/10001/10001/10001/10001/01110",V:"10001/10001/10001/10001/10001/01010/00100",W:"10001/10001/10001/10101/10101/10101/01010",X:"10001/10001/01010/00100/01010/10001/10001",Y:"10001/10001/01010/00100/00100/00100/00100",Z:"11111/00001/00010/00100/01000/10000/11111",
  "0":"01110/10001/10011/10101/11001/10001/01110","1":"00100/01100/00100/00100/00100/00100/01110","2":"01110/10001/00001/00010/00100/01000/11111","3":"11110/00001/00001/01110/00001/00001/11110","4":"00010/00110/01010/10010/11111/00010/00010","5":"11111/10000/10000/11110/00001/00001/11110","6":"01110/10000/10000/11110/10001/10001/01110","7":"11111/00001/00010/00100/01000/01000/01000","8":"01110/10001/10001/01110/10001/10001/01110","9":"01110/10001/10001/01111/00001/00001/01110",
  "$":"00100/01111/10100/01110/00101/11110/00100","-":"00000/00000/00000/11111/00000/00000/00000","+":"00000/00100/00100/11111/00100/00100/00000",".":"00000/00000/00000/00000/00000/00110/00110",":":"00000/00110/00110/00000/00110/00110/00000","/":"00001/00010/00010/00100/01000/01000/10000","(":"00010/00100/01000/01000/01000/00100/00010",")":"01000/00100/00010/00010/00010/00100/01000","%":"11001/11010/00100/00100/01000/10110/00110",
};
const width = 1200, height = 720;
type Color = [number,number,number];
const colors = { background:[16,23,36] as Color, text:[232,238,246] as Color, muted:[155,172,193] as Color, grid:[47,61,80] as Color, green:[66,222,173] as Color, red:[255,120,128] as Color };
function crc32(data: Uint8Array) { let crc = 0xffffffff; for (const byte of data) { crc ^= byte; for (let k=0;k<8;k++) crc = (crc>>>1) ^ (0xedb88320 & -(crc&1)); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const name=Buffer.from(type); const size=Buffer.alloc(4);size.writeUInt32BE(data.length); const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([name,data]))); return Buffer.concat([size,name,data,crc]); }
function png(data: Buffer, metadata: unknown) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const scan=Buffer.alloc(height*(1+width*3)); for(let y=0;y<height;y++) data.copy(scan,y*(1+width*3)+1,y*width*3,(y+1)*width*3);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("tEXt",Buffer.from(`Description\0${JSON.stringify(metadata)}`)),chunk("IDAT",deflateSync(scan)),chunk("IEND",Buffer.alloc(0))]);
}
function drawGraph(points: PnlPoint[], startTs: number, endTs: number, source: string) {
  const data=Buffer.alloc(width*height*3);for(let i=0;i<data.length;i+=3){ data[i]=colors.background[0];data[i+1]=colors.background[1];data[i+2]=colors.background[2]; }
  const pixel=(x:number,y:number,color:Color)=>{ x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=width||y>=height)return;const i=(y*width+x)*3;data[i]=color[0];data[i+1]=color[1];data[i+2]=color[2]; };
  const text=(s:string,x:number,y:number,scale=2,color=colors.text)=>{for(const c of s.toUpperCase()){const rows=font[c]?.split("/");if(rows)for(let row=0;row<7;row++)for(let col=0;col<5;col++)if(rows[row]?.[col]==="1")for(let a=0;a<scale;a++)for(let b=0;b<scale;b++)pixel(x+col*scale+a,y+row*scale+b,color);x+=6*scale;} };
  const line=(x0:number,y0:number,x1:number,y1:number,color:Color,thickness=1)=>{const steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0),1);for(let i=0;i<=steps;i++){const t=i/steps;for(let s=0;s<thickness;s++)pixel(x0+(x1-x0)*t,y0+(y1-y0)*t+s,color);} };
  const left=160,right=1140,top=210,bottom=565;
  let total=0;const cumulative=points.map(p=>({timestamp:p.timestamp,pnlUsd:total=Math.round((total+p.pnlUsd)*1e6)/1e6}));
  const values=[0,...cumulative.map(p=>p.pnlUsd)];const minimum=values.reduce((a,b)=>Math.min(a,b),0),maximum=values.reduce((a,b)=>Math.max(a,b),0);const padding=Math.max((maximum-minimum)*0.15,0.1);const min=minimum-padding,max=maximum+padding;
  const X=(ts:number)=>left+(ts-startTs)/(endTs-startTs)*(right-left);const Y=(pnl:number)=>bottom-(pnl-min)/(max-min)*(bottom-top);
  text(source==="paper"?"PAPER REALIZED P/L":"LIVE SETTLEMENT P/L",60,45,3);text(`${new Date(startTs*1000).toISOString().slice(0,10)} TO ${new Date(endTs*1000).toISOString().slice(0,10)} UTC`,60,85,2,colors.muted);
  text(`${total<0?"-":"+"}$${Math.abs(total).toFixed(2)}`,60,125,4,total<0?colors.red:colors.green);
  text(`${points.length} RECORDS IN RANGE`,700,144,2,colors.muted);
  for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,y=Y(value);line(left,y,right,y,colors.grid);const label=`${value<0?"-":""}$${Math.abs(value).toFixed(2)}`;text(label,Math.max(6,left-12-label.length*12),y-6,2,colors.muted);}
  line(left,Y(0),right,Y(0),colors.muted);line(left,top,left,bottom,colors.grid);line(left,bottom,right,bottom,colors.grid);
  let previous={timestamp:startTs,pnlUsd:0};for(const point of cumulative){line(X(previous.timestamp),Y(previous.pnlUsd),X(point.timestamp),Y(previous.pnlUsd),colors.green,3);line(X(point.timestamp),Y(previous.pnlUsd),X(point.timestamp),Y(point.pnlUsd),point.pnlUsd>=previous.pnlUsd?colors.green:colors.red,3);previous=point;}line(X(previous.timestamp),Y(previous.pnlUsd),right,Y(previous.pnlUsd),total<0?colors.red:colors.green,3);
  for(let i=0;i<=3;i++){const ts=startTs+(endTs-startTs)*i/3;const label=new Date(ts*1000).toISOString().slice(0,10);text(label,Math.max(left,Math.min(right-label.length*12,X(ts)-label.length*6)),590,2,colors.muted);}
  if(!points.length)text("NO P/L RECORDS IN THIS RANGE",380,340,2,colors.muted);
  text("PERIOD CHANGE STARTS AT ZERO. UNREALIZED P/L EXCLUDED.",60,640,2,colors.muted);
  text(source==="paper"?"SIMULATED CLOSED-POSITION P/L. FEES ASSUMED ZERO.":"SETTLEMENT PAYOUT - POSITION COST - SETTLEMENT FEES.",60,669,2,colors.muted);
  return {data,total};
}
export function exportPnlPng(options:{points:PnlPoint[];startTs:number;endTs:number;source:"paper"|"live-settlements";directory?:string}) {
  const {startTs,endTs,source}=options;
  if(![startTs,endTs].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=253402300799)||startTs>=endTs)throw new Error("P/L range requires nonnegative Unix seconds and startTs < endTs");
  if(endTs-startTs>10*366*86400)throw new Error("P/L range must not exceed ten years");
  if(!["paper","live-settlements"].includes(source))throw new Error("Invalid P/L source");
  if(options.points.length>100_000)throw new Error("P/L graph supports up to 100,000 records; narrow the date range");
  if(options.points.some(p=>!Number.isFinite(p.timestamp)||!Number.isFinite(p.pnlUsd)||Math.abs(p.pnlUsd)>1e12))throw new Error("Invalid P/L point");
  const points=options.points.filter(p=>p.timestamp>=startTs&&p.timestamp<=endTs).sort((a,b)=>a.timestamp-b.timestamp);
  const {data,total}=drawGraph(points,startTs,endTs,source);
  const summary={source,startTs,endTs,records:points.length,periodPnlUsd:total,metric:source==="paper"?"Realized paper closed-position P/L, zero simulated fees":"Settlement payouts minus settled position costs and reported settlement fees; excludes early-exit trading P/L",baseline:"zero at range start",unrealizedPnlIncluded:false};
  const image=png(data,summary);const directory=options.directory??join(defaultDataDirectory(),"exports");privateDirectory(directory);
  const path=join(directory,`pnl-${source}-${startTs}-${endTs}-${randomUUID()}.png`);const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);try{writeFileSync(fd,image);}finally{closeSync(fd);}
  return {path,mimeType:"image/png" as const,base64:image.toString("base64"),width,height,summary};
}
