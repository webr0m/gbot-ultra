CREATE TABLE bot_contacts (
 bot_id BIGINT NOT NULL,user_id BIGINT NOT NULL,can_contact BOOLEAN,
 client_language TEXT,last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 source TEXT NOT NULL,last_delivery_at TIMESTAMPTZ,PRIMARY KEY(bot_id,user_id)
);
CREATE TABLE broadcast_campaigns (
 id UUID PRIMARY KEY,actor_id BIGINT NOT NULL,bot_id BIGINT NOT NULL,request_key UUID NOT NULL UNIQUE,
 title TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('admins','users','both')),
 source_language TEXT NOT NULL,source_text TEXT NOT NULL,english_text TEXT NOT NULL,
 translations JSONB NOT NULL DEFAULT '{}',translate_consent BOOLEAN NOT NULL DEFAULT false,
 translations_attempted TEXT[] NOT NULL DEFAULT '{}',translation_warnings TEXT[] NOT NULL DEFAULT '{}',
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','preparing','ready','queued','sending','paused','completed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1,group_ids BIGINT[] NOT NULL DEFAULT '{}',group_cursor INTEGER NOT NULL DEFAULT 0,
 users_prepared BOOLEAN NOT NULL DEFAULT false,prepared_at TIMESTAMPTZ,
 groups_verified INTEGER NOT NULL DEFAULT 0,groups_failed INTEGER NOT NULL DEFAULT 0,
 excluded_contacts INTEGER NOT NULL DEFAULT 0,hold_until TIMESTAMPTZ,last_worker_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ
);
CREATE TABLE broadcast_recipients (
 campaign_id UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,user_id BIGINT NOT NULL,
 language TEXT NOT NULL DEFAULT 'en',language_rank INTEGER NOT NULL DEFAULT 0,is_admin BOOLEAN NOT NULL DEFAULT false,is_user BOOLEAN NOT NULL DEFAULT false,
 group_ids BIGINT[] NOT NULL DEFAULT '{}',
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','sent','unreachable','failed','uncertain','skipped')),
 attempts INTEGER NOT NULL DEFAULT 0,language_sent TEXT,message_id BIGINT,error_kind TEXT,error_code INTEGER,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,user_id)
);
CREATE INDEX broadcast_dispatch ON broadcast_recipients(campaign_id,state,next_attempt_at,user_id);
CREATE INDEX broadcast_queue ON broadcast_campaigns(state,created_at);
CREATE TABLE broadcast_events (
 id BIGSERIAL PRIMARY KEY,campaign_id UUID NOT NULL REFERENCES broadcast_campaigns(id) ON DELETE CASCADE,
 actor_id BIGINT,action TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
