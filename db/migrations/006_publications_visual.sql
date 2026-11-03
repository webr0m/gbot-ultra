CREATE TABLE scheduled_posts (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL, create_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, content TEXT NOT NULL,
 timezone TEXT NOT NULL, local_time TEXT NOT NULL, recurrence TEXT NOT NULL,
 next_run_at TIMESTAMPTZ NOT NULL, thread_id INTEGER NOT NULL DEFAULT 0,
 button_label TEXT, button_url TEXT, state TEXT NOT NULL DEFAULT 'active',
 version INTEGER NOT NULL DEFAULT 1, last_error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scheduled_posts_due ON scheduled_posts(next_run_at) WHERE state='active';
CREATE TABLE publication_runs (
 id BIGSERIAL PRIMARY KEY, post_id BIGINT NOT NULL REFERENCES scheduled_posts(id) ON DELETE CASCADE,
 chat_id BIGINT NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, state TEXT NOT NULL,
 message_id BIGINT, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(post_id,scheduled_at)
);
CREATE TABLE visual_config (
 chat_id BIGINT PRIMARY KEY REFERENCES chats(chat_id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT false,
 mode TEXT NOT NULL DEFAULT 'review', threshold NUMERIC NOT NULL DEFAULT 0.9,
 consent BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE visual_jobs (
 id BIGSERIAL PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 message_id BIGINT NOT NULL, user_id BIGINT NOT NULL, file_id TEXT NOT NULL, cache_key TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', score NUMERIC, detail TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(chat_id,message_id)
);
CREATE INDEX visual_jobs_pending ON visual_jobs(created_at) WHERE state IN ('pending','processing');
CREATE TABLE visual_cache (
 cache_key TEXT PRIMARY KEY, sexual BOOLEAN NOT NULL, score NUMERIC NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE visual_usage (
 day DATE NOT NULL, chat_id BIGINT NOT NULL, calls INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,chat_id)
);
