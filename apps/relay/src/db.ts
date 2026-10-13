import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ---------------------------------------------------------------- onchain (indexed)
CREATE TABLE IF NOT EXISTS users (
  fid INTEGER PRIMARY KEY,
  custody TEXT NOT NULL,
  recovery TEXT,
  handle TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_custody ON users(custody);
CREATE INDEX IF NOT EXISTS users_handle ON users(handle);

CREATE TABLE IF NOT EXISTS app_keys (
  fid INTEGER NOT NULL,
  key_hash TEXT NOT NULL,
  key_type INTEGER NOT NULL,
  key TEXT NOT NULL,
  signer TEXT,
  scope INTEGER NOT NULL,
  expiry INTEGER NOT NULL,
  client_fid INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fid, key_hash)
);
CREATE INDEX IF NOT EXISTS app_keys_signer ON app_keys(signer);

CREATE TABLE IF NOT EXISTS follows (
  fid INTEGER NOT NULL,
  target INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (fid, target)
);
CREATE INDEX IF NOT EXISTS follows_target ON follows(target);

CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY,
  owner_fid INTEGER NOT NULL,
  kind INTEGER NOT NULL,
  uri TEXT NOT NULL,
  def_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  price_usd INTEGER NOT NULL DEFAULT 0,
  creator_share_bps INTEGER NOT NULL DEFAULT 0,
  discovery_bps INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  meta TEXT
);
CREATE TABLE IF NOT EXISTS feed_versions (
  feed_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  uri TEXT NOT NULL,
  def_hash TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (feed_id, version)
);

CREATE TABLE IF NOT EXISTS communities (
  id INTEGER PRIMARY KEY,
  owner_fid INTEGER NOT NULL,
  join_type INTEGER NOT NULL,
  gate_token TEXT,
  gate_min TEXT NOT NULL DEFAULT '0',
  price_usd INTEGER NOT NULL DEFAULT 0,
  period INTEGER NOT NULL DEFAULT 0,
  feed_id INTEGER NOT NULL DEFAULT 0,
  uri TEXT NOT NULL DEFAULT '',
  meta TEXT
);
CREATE TABLE IF NOT EXISTS members (
  community_id INTEGER NOT NULL,
  fid INTEGER NOT NULL,
  role INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  custom_roles TEXT NOT NULL DEFAULT '0',
  PRIMARY KEY (community_id, fid)
);
CREATE INDEX IF NOT EXISTS members_fid ON members(fid);

CREATE TABLE IF NOT EXISTS subscriptions (
  fid INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (fid, feed_id)
);
CREATE TABLE IF NOT EXISTS sub_payments (
  tx TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  subscriber_fid INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  amount TEXT NOT NULL,
  to_creators TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (tx, log_index)
);
CREATE TABLE IF NOT EXISTS payout_leaves (
  epoch INTEGER NOT NULL,
  token TEXT NOT NULL,
  fid INTEGER NOT NULL,
  amount TEXT NOT NULL,
  proof TEXT NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (epoch, token, fid)
);
CREATE TABLE IF NOT EXISTS payout_roots (
  epoch INTEGER NOT NULL,
  token TEXT NOT NULL,
  root TEXT NOT NULL,
  total TEXT NOT NULL,
  tx TEXT,
  PRIMARY KEY (epoch, token)
);

-- ---------------------------------------------------------------- offchain messages
CREATE TABLE IF NOT EXISTS messages (
  relay_seq INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL UNIQUE,
  fid INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  signer TEXT NOT NULL,
  raw TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  anchor_batch INTEGER
);
CREATE INDEX IF NOT EXISTS messages_fid_seq ON messages(fid, seq);
CREATE INDEX IF NOT EXISTS messages_unanchored ON messages(anchor_batch) WHERE anchor_batch IS NULL;

CREATE TABLE IF NOT EXISTS posts (
  hash TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  text TEXT NOT NULL,
  tags TEXT NOT NULL,
  links TEXT NOT NULL,
  media TEXT NOT NULL,
  community INTEGER,
  parent TEXT,
  root TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  trial TEXT,
  trial_status TEXT,
  trial_group TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS posts_fid ON posts(fid, ts);
CREATE INDEX IF NOT EXISTS posts_ts ON posts(ts);
CREATE INDEX IF NOT EXISTS posts_parent ON posts(parent);
CREATE INDEX IF NOT EXISTS posts_root ON posts(root);
CREATE INDEX IF NOT EXISTS posts_community ON posts(community);

CREATE TABLE IF NOT EXISTS post_tags (hash TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (tag, hash));

CREATE TABLE IF NOT EXISTS reactions (
  hash TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  type TEXT NOT NULL,
  target TEXT NOT NULL,
  ts INTEGER NOT NULL,
  UNIQUE (fid, type, target)
);
CREATE INDEX IF NOT EXISTS reactions_target ON reactions(target);

CREATE TABLE IF NOT EXISTS backs (
  fid INTEGER NOT NULL,
  creator INTEGER NOT NULL,
  target TEXT,
  ts INTEGER NOT NULL,
  PRIMARY KEY (fid, creator)
);
CREATE INDEX IF NOT EXISTS backs_target ON backs(target);

CREATE TABLE IF NOT EXISTS views (
  hash TEXT PRIMARY KEY,
  fid INTEGER NOT NULL,
  target TEXT NOT NULL,
  creator INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  completion REAL NOT NULL DEFAULT 0,
  UNIQUE (fid, target)
);
CREATE INDEX IF NOT EXISTS views_target ON views(target);

CREATE TABLE IF NOT EXISTS chat (
  hash TEXT PRIMARY KEY,
  community INTEGER NOT NULL,
  room TEXT NOT NULL,
  fid INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_room ON chat(community, room, ts);

CREATE TABLE IF NOT EXISTS labels (
  target TEXT NOT NULL,
  labeler INTEGER NOT NULL,
  label TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (target, labeler, label)
);

CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY,
  root TEXT NOT NULL,
  count INTEGER NOT NULL,
  from_seq INTEGER NOT NULL,
  to_seq INTEGER NOT NULL,
  tx TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  fid INTEGER PRIMARY KEY,
  display_name TEXT,
  bio TEXT,
  avatar TEXT,
  banner TEXT,
  url TEXT,
  location TEXT,
  ts INTEGER NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
  fid INTEGER NOT NULL,
  target INTEGER NOT NULL,
  kind TEXT NOT NULL, -- 'mute' | 'block'
  ts INTEGER NOT NULL,
  PRIMARY KEY (fid, target, kind)
);
CREATE INDEX IF NOT EXISTS relations_target ON relations(target, kind);

CREATE TABLE IF NOT EXISTS invites (
  community_id INTEGER NOT NULL,
  fid INTEGER NOT NULL,
  by_fid INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (community_id, fid)
);

CREATE TABLE IF NOT EXISTS mentions (
  hash TEXT NOT NULL,
  fid INTEGER NOT NULL, -- mentioned
  author INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (hash, fid)
);
CREATE INDEX IF NOT EXISTS mentions_fid ON mentions(fid, ts);

-- ---------------------------------------------------------------- derived
CREATE TABLE IF NOT EXISTS reputation (
  fid INTEGER PRIMARY KEY,
  rep REAL NOT NULL,
  verified_followers INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scout_scores (
  fid INTEGER PRIMARY KEY,
  score INTEGER NOT NULL,
  backed INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  top TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sponsor_usage (
  fid INTEGER NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (fid, day)
);
`);

export function kvGet(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function kvSet(key: string, value: string) {
  db.prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type Row = Record<string, unknown>;
export const all = <T = Row>(sql: string, ...args: (string | number | bigint | null)[]) =>
  db.prepare(sql).all(...args) as T[];
export const get = <T = Row>(sql: string, ...args: (string | number | bigint | null)[]) =>
  db.prepare(sql).get(...args) as T | undefined;
export const run = (sql: string, ...args: (string | number | bigint | null)[]) => db.prepare(sql).run(...args);
