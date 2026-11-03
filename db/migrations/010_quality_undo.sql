-- Minimal rule telemetry: no message bodies, patterns, URLs or user names.
CREATE TABLE rule_events (
 id UUID PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 rule_key TEXT NOT NULL, revision TEXT NOT NULL, message_id BIGINT NOT NULL,
 action TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('applied','observation','error')),
 review TEXT CHECK(review IN ('correct','false_positive','unsure')), review_version INTEGER NOT NULL DEFAULT 0,
 reviewer_id BIGINT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(chat_id, message_id, rule_key)
);
CREATE INDEX rule_events_recent ON rule_events(chat_id, created_at DESC);
CREATE TABLE rule_reviews (
 id BIGSERIAL PRIMARY KEY, event_id UUID NOT NULL REFERENCES rule_events(id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL, verdict TEXT NOT NULL, version INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sanction_versions (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE, user_id BIGINT NOT NULL,
 version BIGINT NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(chat_id,user_id)
);
CREATE TABLE sanction_actions (
 id UUID PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 user_id BIGINT NOT NULL, actor_id BIGINT NOT NULL, bot_id BIGINT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('ban','mute')), source TEXT NOT NULL, version BIGINT NOT NULL,
 before_state JSONB NOT NULL, after_state JSONB,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','applied','uncertain','failed')),
 undo_state TEXT NOT NULL DEFAULT 'none' CHECK(undo_state IN ('none','processing','done','uncertain')),
 undone_by BIGINT, undone_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sanction_actions_recent ON sanction_actions(chat_id,created_at DESC);

CREATE INDEX rule_reviews_event ON rule_reviews(event_id);
CREATE INDEX sanction_actions_target ON sanction_actions(chat_id,user_id,created_at DESC);
