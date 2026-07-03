import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'monitor.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// Multiple checker processes (one per region) share this file. WAL allows
// concurrent readers + a single writer at a time; busy_timeout makes a
// writer wait instead of erroring immediately if another process is
// mid-write, which matters now that more than one process opens this file.
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every individual ping, tagged with the region that performed it.
  -- checked_at is an explicit JS-generated ISO timestamp (not a SQL
  -- default) so it's directly comparable with other JS-generated values.
  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    region TEXT NOT NULL DEFAULT 'local',
    status_code INTEGER,
    response_time_ms INTEGER,
    is_up INTEGER NOT NULL,
    error TEXT,
    checked_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_checks_url_id_checked_at
    ON checks (url_id, checked_at DESC);

  CREATE INDEX IF NOT EXISTS idx_checks_url_id_region_checked_at
    ON checks (url_id, region, checked_at DESC);

  -- Per-(url, region) debounce state: how many consecutive failures that
  -- region has seen, and whether that region currently considers the URL
  -- confirmed-down. This is layer 1 of the two-layer false-positive guard —
  -- see incidentState.js.
  CREATE TABLE IF NOT EXISTS region_state (
    url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    region TEXT NOT NULL,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    confirmed_down INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (url_id, region)
  );

  -- URL-level confirmed outages, decided by cross-region quorum (layer 2).
  -- Real rows, not a derived flag, so real outage history/duration exists.
  CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url_id INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    resolved_at TEXT,
    duration_seconds INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_incidents_url_id
    ON incidents (url_id, started_at DESC);

  -- One row per monitored URL with an https:// origin. Refreshed on a
  -- slower cadence than health checks (certs don't change minute to
  -- minute) — see ssl.js.
  CREATE TABLE IF NOT EXISTS ssl_info (
    url_id INTEGER PRIMARY KEY REFERENCES urls(id) ON DELETE CASCADE,
    valid_to TEXT,
    days_remaining INTEGER,
    checked_at TEXT,
    error TEXT
  );
`);

export default db;
