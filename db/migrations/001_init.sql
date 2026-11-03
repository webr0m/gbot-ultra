-- ============================================================
--  GBot Ultra — esquema inicial
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  user_id       BIGINT PRIMARY KEY,
  username      TEXT,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT,
  language_code TEXT,
  is_bot        BOOLEAN NOT NULL DEFAULT FALSE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_username_idx ON users (lower(username));

CREATE TABLE IF NOT EXISTS chats (
  chat_id               BIGINT PRIMARY KEY,
  title                 TEXT NOT NULL,
  username              TEXT,
  type                  TEXT NOT NULL,
  description           TEXT,
  owner_id              BIGINT,
  premium_until         TIMESTAMPTZ,
  premium_plan          TEXT,
  premium_reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  settings              JSONB NOT NULL DEFAULT '{}'::jsonb,
  boosts                INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chats_active_idx ON chats (active);
CREATE INDEX IF NOT EXISTS chats_premium_idx ON chats (premium_until)
  WHERE premium_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id         BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'member',
  custom_title    TEXT,
  is_bot          BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  message_count   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_members_recent_idx
  ON chat_members (chat_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS chat_members_status_idx
  ON chat_members (chat_id, status);

CREATE TABLE IF NOT EXISTS warnings (
  id         BIGSERIAL PRIMARY KEY,
  chat_id    BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  admin_id   BIGINT,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warnings_chat_user_idx ON warnings (chat_id, user_id);

CREATE TABLE IF NOT EXISTS moderation_log (
  id               BIGSERIAL PRIMARY KEY,
  chat_id          BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  actor_id         BIGINT,
  target_id        BIGINT,
  action           TEXT NOT NULL,
  reason           TEXT,
  duration_seconds INTEGER,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS moderation_log_chat_idx
  ON moderation_log (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS custom_commands (
  chat_id    BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_by BIGINT,
  uses       BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, name)
);

CREATE TABLE IF NOT EXISTS notes (
  chat_id    BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_by BIGINT,
  uses       BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, name)
);

CREATE TABLE IF NOT EXISTS blacklist (
  chat_id    BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  pattern    TEXT NOT NULL,
  is_regex   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, pattern)
);

CREATE TABLE IF NOT EXISTS gbans (
  user_id    BIGINT PRIMARY KEY,
  reason     TEXT,
  banned_by  BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS premium_codes (
  code             TEXT PRIMARY KEY,
  days             INTEGER NOT NULL,
  plan             TEXT,
  created_by       BIGINT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  redeemed_by      BIGINT,
  redeemed_chat_id BIGINT,
  redeemed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payments (
  id         BIGSERIAL PRIMARY KEY,
  charge_id  TEXT UNIQUE,
  user_id    BIGINT,
  chat_id    BIGINT,
  amount     INTEGER NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'XTR',
  plan       TEXT,
  days       INTEGER,
  payload    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_chat_idx ON payments (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_stats (
  chat_id  BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  date     DATE NOT NULL,
  messages BIGINT NOT NULL DEFAULT 0,
  joins    BIGINT NOT NULL DEFAULT 0,
  leaves   BIGINT NOT NULL DEFAULT 0,
  commands BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, date)
);

CREATE TABLE IF NOT EXISTS member_daily (
  chat_id  BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL,
  date     DATE NOT NULL,
  messages BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id, date)
);

CREATE INDEX IF NOT EXISTS member_daily_chat_date_idx
  ON member_daily (chat_id, date);

CREATE TABLE IF NOT EXISTS captcha_pending (
  chat_id    BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  message_id BIGINT,
  answer     TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS action_counters (
  chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  date    DATE NOT NULL,
  actions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, date)
);

CREATE TABLE IF NOT EXISTS chat_boosts (
  chat_id  BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  boost_id TEXT NOT NULL,
  user_id  BIGINT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, boost_id)
);
