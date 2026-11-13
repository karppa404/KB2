import { Database } from "bun:sqlite";
import { closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PnlPoint } from "./pnl";

const SCALE = 1_000_000;
const usd = (micros: number) => micros / SCALE;
const micros = (amount: number) => Math.round(amount * SCALE);
export function privateDirectory(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) {
    throw new Error("Plugin data directory must be owner-only and not a symlink");
  }
}
export function defaultDataDirectory() {
  return resolve(process.env.KALSHI_MCP_DATA_DIR ?? join(homedir(), ".local", "share", "kalshi-mcp"));
}
export interface PaperOrder {
  ticker: string; action: "buy" | "sell"; side: "yes" | "no"; count: number;
  yes_price?: number; no_price?: number; expiration_ts?: number; time_in_force?: string;
  buy_max_cost?: number; reduce_only?: boolean; post_only?: boolean;
}
interface AccountRow { enabled: number; revision: number; cash: number; initial_cash: number; realized: number }
interface PositionRow { ticker: string; side: "yes" | "no"; count: number; cost: number }
interface FillRow { id: string; ticker: string; side: "yes" | "no"; action: "buy" | "sell"; count: number; price: number; realized: number; timestamp: number }
const limitation = "Paper simulation: immediate full fills against a snapshot of visible depth; no resting orders, short sales, exchange settlements or fees. Holdings on YES and NO are tracked independently. No real orders are sent.";

export class PaperAccount {
  private db: Database;
  constructor(path = join(defaultDataDirectory(), "paper.db")) {
    privateDirectory(dirname(path));
    try { closeSync(openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)); }
    catch (error: any) { if (error.code !== "EEXIST") throw error; }
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("Paper database must be an owner-only regular file");
    this.db = new Database(path);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS paper_account (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL, revision INTEGER NOT NULL, cash INTEGER NOT NULL, initial_cash INTEGER NOT NULL, realized INTEGER NOT NULL);
      INSERT OR IGNORE INTO paper_account VALUES (1,1,0,10000000000,10000000000,0);
      CREATE TABLE IF NOT EXISTS paper_positions (ticker TEXT NOT NULL,side TEXT NOT NULL,count INTEGER NOT NULL,cost INTEGER NOT NULL,PRIMARY KEY(ticker,side));
      CREATE TABLE IF NOT EXISTS paper_fills (id TEXT PRIMARY KEY,ticker TEXT NOT NULL,side TEXT NOT NULL,action TEXT NOT NULL,count INTEGER NOT NULL,price REAL NOT NULL,realized INTEGER NOT NULL,timestamp INTEGER NOT NULL);`);
  }
  close() { this.db.close(); }
  private account() { return this.db.query("SELECT * FROM paper_account WHERE id=1").get() as AccountRow; }
  status() {
    const account = this.account();
    const positions = this.db.query("SELECT * FROM paper_positions WHERE count > 0 ORDER BY ticker,side").all() as PositionRow[];
    return { mode: account.enabled ? "paper" as const : "live" as const, revision: account.revision,
      balanceUsd: usd(account.cash), startingCashUsd: usd(account.initial_cash), realizedPnlUsd: usd(account.realized),
      positions: positions.map(p => ({ ticker: p.ticker, side: p.side, count: p.count / 100, costBasisUsd: usd(p.cost), averagePriceUsd: usd(p.cost) / (p.count / 100) })), limitation };
  }
  setMode(enabled: boolean) {
    if (typeof enabled !== "boolean") throw new Error("Paper mode must be a boolean");
    this.db.query("UPDATE paper_account SET enabled=?,revision=revision+1 WHERE id=1").run(enabled ? 1 : 0);
    return this.status();
  }
  reset(startingCashUsd: number) {
    if (!Number.isFinite(startingCashUsd) || startingCashUsd < 0 || startingCashUsd > 1_000_000_000 || Math.abs(startingCashUsd * 100 - Math.round(startingCashUsd * 100)) > 1e-6) throw new Error("Starting cash must be $0 to $1 billion with at most two decimals");
    this.db.transaction(() => {
      this.db.query("UPDATE paper_account SET cash=?,initial_cash=?,realized=0,revision=revision+1 WHERE id=1").run(micros(startingCashUsd), micros(startingCashUsd));
      this.db.exec("DELETE FROM paper_positions; DELETE FROM paper_fills;");
    }).immediate();
    return this.status();
  }
  fills() {
    return { mode: "paper", fills: (this.db.query("SELECT * FROM paper_fills ORDER BY timestamp,id").all() as FillRow[]).map(f => ({
      fill_id: f.id, order_id: f.id, ticker: f.ticker, action: f.action, side: f.side, count_fp: (f.count / 100).toFixed(2),
      price_dollars: f.price.toFixed(6), fee_cost: "0", realized_pnl_dollars: usd(f.realized).toFixed(6), created_time: new Date(f.timestamp * 1000).toISOString(),
    })), cursor: "" };
  }
  orders() { return { mode: "paper", orders: [], cursor: "", limitation: "Paper orders fill immediately in full or are rejected; no resting orders exist." }; }
  pnl(startTs: number, endTs: number): PnlPoint[] {
    return (this.db.query("SELECT timestamp,realized FROM paper_fills WHERE timestamp>=? AND timestamp<=? ORDER BY timestamp,id").all(startTs, endTs) as Array<{timestamp:number;realized:number}>).map(f => ({ timestamp: f.timestamp, pnlUsd: usd(f.realized) }));
  }
  placeOrder(order: PaperOrder, book: unknown, expectedRevision?: number, nowTs = Math.floor(Date.now() / 1000)) {
    if (!order.ticker?.trim() || !["buy", "sell"].includes(order.action) || !["yes", "no"].includes(order.side)) throw new Error("Invalid paper order ticker, action or side");
    if (!Number.isFinite(order.count) || order.count <= 0 || order.count > 1_000_000 || Math.abs(order.count * 100 - Math.round(order.count * 100)) > 1e-7) throw new Error("Paper count must be positive, at most 1 million, with at most two decimals");
    if ((order.yes_price === undefined) === (order.no_price === undefined)) throw new Error("Provide exactly one of yes_price or no_price in cents");
    const specified = order.yes_price ?? order.no_price!;
    if (!Number.isFinite(specified) || specified <= 0 || specified >= 100 || Math.abs(specified * 100 - Math.round(specified * 100)) > 1e-7) throw new Error("Paper price must be between 0 and 100 cents with at most two decimals");
    if (order.buy_max_cost !== undefined || order.post_only || order.expiration_ts !== undefined || (order.reduce_only && order.action !== "sell")) throw new Error("Paper simulator does not support buy_max_cost, post_only, expiration or reduce-only buys");
    if (order.time_in_force !== undefined && !["good_till_canceled", "immediate_or_cancel", "fill_or_kill"].includes(order.time_in_force)) throw new Error("Invalid time_in_force");
    if (!Number.isSafeInteger(nowTs) || nowTs < 0) throw new Error("Invalid fill timestamp");
    const yesPrice = order.yes_price ?? 100 - order.no_price!;
    const limit = (order.side === "yes" ? yesPrice : 100 - yesPrice) / 100;
    const sideToRead = order.action === "buy" ? (order.side === "yes" ? "no" : "yes") : order.side;
    const levels = (book as any)?.orderbook_fp?.[`${sideToRead}_dollars`];
    if (!Array.isArray(levels)) throw new Error("Paper fill requires a valid fixed-point Kalshi orderbook snapshot");
    const quotes = levels.map((level: unknown) => {
      if (!Array.isArray(level) || level.length !== 2 || !["string", "number"].includes(typeof level[0]) || !["string", "number"].includes(typeof level[1])) throw new Error("Invalid orderbook depth");
      const bid = Number(level[0]); const count = Number(level[1]);
      if (!Number.isFinite(bid) || bid <= 0 || bid >= 1 || !Number.isFinite(count) || count <= 0 || Math.abs(count * 100 - Math.round(count * 100)) > 1e-7) throw new Error("Invalid orderbook quote");
      return { price: order.action === "buy" ? 1 - bid : bid, count: Math.round(count * 100) };
    }).sort((a,b) => order.action === "buy" ? a.price - b.price : b.price - a.price);
    let remaining = Math.round(order.count * 100); let totalMicros = 0;
    for (const quote of quotes) {
      if (order.action === "buy" ? quote.price > limit + 1e-9 : quote.price < limit - 1e-9) continue;
      const fill = Math.min(remaining, quote.count);
      totalMicros += micros((fill / 100) * quote.price); remaining -= fill;
      if (!remaining) break;
    }
    if (remaining) throw new Error("Paper order cannot fill fully within its limit and visible depth; no resting order was created");
    return this.db.transaction(() => {
      const account = this.account();
      if (!account.enabled || (expectedRevision !== undefined && account.revision !== expectedRevision)) throw new Error("Trading mode changed; request a fresh paper order");
      const count = Math.round(order.count * 100);
      const position = this.db.query("SELECT * FROM paper_positions WHERE ticker=? AND side=?").get(order.ticker, order.side) as PositionRow | null;
      let realized = 0;
      if (order.action === "buy") {
        if (totalMicros > account.cash) throw new Error("Insufficient paper cash");
        this.db.query("INSERT INTO paper_positions VALUES (?,?,?,?) ON CONFLICT(ticker,side) DO UPDATE SET count=count+excluded.count,cost=cost+excluded.cost").run(order.ticker, order.side, count, totalMicros);
      } else {
        if (!position || position.count < count) throw new Error("Insufficient paper holdings; short sales are unsupported");
        const basis = count === position.count ? position.cost : Math.round(position.cost * count / position.count);
        realized = totalMicros - basis;
        this.db.query("UPDATE paper_positions SET count=count-?,cost=cost-? WHERE ticker=? AND side=?").run(count, basis, order.ticker, order.side);
      }
      this.db.query("UPDATE paper_account SET cash=cash+?,realized=realized+? WHERE id=1").run(order.action === "buy" ? -totalMicros : totalMicros, realized);
      const id = `paper-${randomUUID()}`; const price = usd(totalMicros) / order.count;
      this.db.query("INSERT INTO paper_fills VALUES (?,?,?,?,?,?,?,?)").run(id, order.ticker, order.side, order.action, count, price, realized, nowTs);
      return { mode: "paper", order: { order_id: id, ticker: order.ticker, action: order.action, side: order.side, status: "executed", count_fp: order.count.toFixed(2), average_price_dollars: price.toFixed(6), fee_cost: "0", realized_pnl_dollars: usd(realized).toFixed(6) }, balanceUsd: usd(account.cash + (order.action === "buy" ? -totalMicros : totalMicros)), limitation };
    }).immediate();
  }
}
