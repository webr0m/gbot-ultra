ALTER TABLE chats ADD COLUMN premium_tier TEXT;
ALTER TABLE premium_codes ADD COLUMN premium_tier TEXT NOT NULL DEFAULT 'premium';
UPDATE chats SET premium_tier='ultra' WHERE premium_until > now();
UPDATE premium_codes SET premium_tier='ultra';
ALTER TABLE warnings ADD COLUMN expires_at TIMESTAMPTZ;
ALTER TABLE warnings ADD COLUMN resolved_at TIMESTAMPTZ;
CREATE INDEX warnings_active_idx ON warnings(chat_id,user_id) WHERE resolved_at IS NULL;
CREATE TABLE advanced_config (
 chat_id BIGINT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
 settings JSONB NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
 updated_by BIGINT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE advanced_history (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 version INTEGER NOT NULL, actor_id BIGINT NOT NULL, settings JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(chat_id,version)
);
CREATE TABLE trusted_users (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE, user_id BIGINT NOT NULL,
 scopes TEXT[] NOT NULL, reason TEXT NOT NULL DEFAULT '', actor_id BIGINT NOT NULL,
 expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(chat_id,user_id)
);
CREATE TABLE auto_responses (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 trigger TEXT NOT NULL, mode TEXT NOT NULL, content TEXT NOT NULL,
 button_label TEXT, button_url TEXT, cooldown_seconds INTEGER NOT NULL DEFAULT 60,
 enabled BOOLEAN NOT NULL DEFAULT true, last_sent_at TIMESTAMPTZ,
 UNIQUE(chat_id,trigger)
);
CREATE TABLE rich_notes (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE, name TEXT NOT NULL,
 content TEXT NOT NULL DEFAULT '', media_type TEXT, file_id TEXT, buttons JSONB NOT NULL DEFAULT '[]',
 private_delivery BOOLEAN NOT NULL DEFAULT false, actor_id BIGINT NOT NULL,
 PRIMARY KEY(chat_id,name)
);
CREATE TABLE raid_joins (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX raid_joins_time ON raid_joins(chat_id,joined_at);
CREATE TABLE raid_state (
 chat_id BIGINT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
 until_at TIMESTAMPTZ NOT NULL, activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE join_challenges (
 token TEXT PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL, user_chat_id BIGINT NOT NULL, answer TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, expires_at TIMESTAMPTZ NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', UNIQUE(chat_id,user_id)
);
CREATE TABLE night_state (
 chat_id BIGINT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
 permissions JSONB NOT NULL, applied_permissions JSONB NOT NULL, applied BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE alliances (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, owner_id BIGINT NOT NULL,
 invite_code TEXT NOT NULL UNIQUE, profile JSONB, profile_version INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE alliance_chats (
 chat_id BIGINT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
 alliance_id BIGINT NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
 joined_by BIGINT NOT NULL, joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), profile_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE alliance_cases (
 id BIGSERIAL PRIMARY KEY, alliance_id BIGINT NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
 source_chat_id BIGINT NOT NULL REFERENCES chats(chat_id), user_id BIGINT NOT NULL,
 reason TEXT NOT NULL, actor_id BIGINT NOT NULL, duration_seconds INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), withdrawn_at TIMESTAMPTZ
);
CREATE TABLE alliance_reviews (
 case_id BIGINT NOT NULL REFERENCES alliance_cases(id) ON DELETE CASCADE,
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL, decision TEXT NOT NULL, previous_status TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(case_id,chat_id)
);
CREATE TABLE operation_receipts (
 key TEXT PRIMARY KEY, state TEXT NOT NULL, result JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ
);
CREATE TABLE update_receipts (
 update_id BIGINT PRIMARY KEY, state TEXT NOT NULL, chat_id BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE pro_licenses (
 id BIGSERIAL PRIMARY KEY, owner_id BIGINT NOT NULL, charge_id TEXT UNIQUE,
 slots INTEGER NOT NULL DEFAULT 10 CHECK(slots=10), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE chats ADD COLUMN pro_license_id BIGINT REFERENCES pro_licenses(id);
ALTER TABLE chats ADD COLUMN pro_owner_id BIGINT;
CREATE INDEX pro_owner_groups ON chats(pro_owner_id) WHERE pro_license_id IS NOT NULL;
