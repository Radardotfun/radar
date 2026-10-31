-- Radar's own record of which X accounts posted which coins (server/ledger.js).
-- npx wrangler d1 execute radar-ledger --remote --file server/ledger.sql
CREATE TABLE IF NOT EXISTS posts (
  id TEXT NOT NULL,          -- the post's status id
  author TEXT NOT NULL,      -- its X handle, lowercase
  ca TEXT NOT NULL,          -- the contract address written in it
  at INTEGER NOT NULL,       -- when it was posted (ms)
  gone INTEGER NOT NULL DEFAULT 0,    -- 1 once the post no longer opens
  checked INTEGER NOT NULL DEFAULT 0, -- when that was last looked at (ms)
  PRIMARY KEY (id, ca)
);
CREATE INDEX IF NOT EXISTS posts_author ON posts (author, at DESC);

-- The bot's Discord and Telegram side (bot/chat.js): small settings, usage limits, the narrative wire's minutes.
CREATE TABLE IF NOT EXISTS bot_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_usage (k TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS wire_rows (at INTEGER PRIMARY KEY, coins TEXT NOT NULL);

-- Daily totals with nothing about who: how many scans were opened from a bot reply.
CREATE TABLE IF NOT EXISTS counts (
  day TEXT NOT NULL,         -- UTC date
  name TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, name)
);
