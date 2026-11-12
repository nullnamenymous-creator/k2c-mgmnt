import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const data = process.env.K2C_DATA_DIR || 'data';
mkdirSync(data, { recursive: true });
export const db = new DatabaseSync(join(data, 'k2c.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, body BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS submissions (actor TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(actor, token));
  INSERT OR IGNORE INTO state VALUES (1, '{"products":[],"sales":[],"purchases":[],"movements":[]}');
`);

