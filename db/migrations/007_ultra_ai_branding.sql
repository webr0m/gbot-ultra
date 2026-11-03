CREATE TABLE ai_config (
 chat_id BIGINT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL,enabled BOOLEAN NOT NULL DEFAULT false,consent BOOLEAN NOT NULL DEFAULT false,
 instructions TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ai_cache (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,cache_key TEXT NOT NULL,
 answer TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,PRIMARY KEY(chat_id,cache_key)
);
CREATE TABLE ai_usage (
 id BIGSERIAL PRIMARY KEY,chat_id BIGINT NOT NULL,user_id BIGINT NOT NULL,
 reserved_tokens INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_time ON ai_usage(created_at);
CREATE INDEX ai_usage_user ON ai_usage(chat_id,user_id,created_at);
CREATE TABLE branded_bots (
 id UUID PRIMARY KEY,chat_id BIGINT NOT NULL UNIQUE REFERENCES chats(chat_id) ON DELETE CASCADE,
 owner_id BIGINT NOT NULL,bot_id BIGINT NOT NULL UNIQUE,username TEXT NOT NULL,name TEXT NOT NULL,
 description TEXT NOT NULL,token_ciphertext TEXT NOT NULL,token_fingerprint TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'paused',version INTEGER NOT NULL DEFAULT 1,
 last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE branded_update_receipts (
 bot_id BIGINT NOT NULL,update_id BIGINT NOT NULL,state TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(bot_id,update_id)
);
CREATE TABLE group_update_receipts (
 chat_id BIGINT NOT NULL,event_key TEXT NOT NULL,bot_id BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(chat_id,event_key)
);
CREATE TABLE media_sources (
 file_id TEXT PRIMARY KEY,bot_id BIGINT NOT NULL,chat_id BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE media_bridge_cache (
 bot_id BIGINT NOT NULL,source_file_id TEXT NOT NULL,file_id TEXT NOT NULL,PRIMARY KEY(bot_id,source_file_id)
);
