import Database from "better-sqlite3";

export function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      host_hash TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      ended_at INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      pid TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      key TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, pid)
    );
    CREATE TABLE IF NOT EXISTS outs (
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      runner_name TEXT NOT NULL,
      hunter_pid TEXT,
      hunter_name TEXT,
      t INTEGER NOT NULL,
      PRIMARY KEY (game_id, key)
    );
    CREATE INDEX IF NOT EXISTS outs_t ON outs (game_id, t);
  `);
  return db;
}
