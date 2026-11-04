import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class Store {
  db: Database;
  constructor(path = process.env.KB2_AGENT_DB ?? resolve(import.meta.dir, "../state/agents.db")) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS strategies(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, request TEXT NOT NULL, fingerprint TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, trade_id TEXT, note TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, due_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT, summary TEXT);
      CREATE TABLE IF NOT EXISTS wakes(id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, at TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY, strategy_id TEXT NOT NULL, at TEXT NOT NULL, equity REAL NOT NULL, mode TEXT NOT NULL);
    `);
  }
  all<T>(sql: string, ...args: any[]): T[] { return this.db.query(sql).all(...args) as T[]; }
  one<T>(sql: string, ...args: any[]): T | undefined { return this.db.query(sql).get(...args) as T | undefined; }
  exec(sql: string, ...args: any[]) { return this.db.query(sql).run(...args); }
  atomic<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  close() { this.db.close(); }
}
