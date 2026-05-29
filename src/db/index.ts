import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";

export interface CommandLog {
  id: number;
  timestamp: string;
  command: string;
  args: string | null;
  result: string | null;
  error: string | null;
  duration_ms: number | null;
}

const defaultDbPath = "./data/log.db";
const dbPath = resolve(Bun.env.DB_PATH ?? defaultDbPath);
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS command_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
    command     TEXT    NOT NULL,
    args        TEXT,
    result      TEXT,
    error       TEXT,
    duration_ms INTEGER
  );
`);

const insertLog = db.prepare(`
  INSERT INTO command_log (command, args, result, error, duration_ms)
  VALUES ($command, $args, $result, $error, $duration_ms)
`);

const selectHistory = db.prepare(`
  SELECT id, timestamp, command, args, result, error, duration_ms
  FROM command_log
  ORDER BY id DESC
  LIMIT $limit
`);

const selectHistoryByCommand = db.prepare(`
  SELECT id, timestamp, command, args, result, error, duration_ms
  FROM command_log
  WHERE command = $command
  ORDER BY id DESC
  LIMIT $limit
`);

export function logCommand(opts: {
  command: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  duration_ms: number;
}): void {
  insertLog.run({
    $command: opts.command,
    $args: JSON.stringify(opts.args ?? {}),
    $result: opts.result === undefined ? null : JSON.stringify(opts.result),
    $error: opts.error ?? null,
    $duration_ms: Math.round(opts.duration_ms),
  });
}

export function getHistory(limit = 20): CommandLog[] {
  return selectHistory.all({ $limit: limit }) as CommandLog[];
}

export function getHistoryByCommand(command: string, limit = 20): CommandLog[] {
  return selectHistoryByCommand.all({ $command: command, $limit: limit }) as CommandLog[];
}
