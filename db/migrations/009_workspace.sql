CREATE TABLE setup_applications (
 token_hash TEXT PRIMARY KEY, chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 actor_id BIGINT NOT NULL, profile TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE member_reports (
 id BIGSERIAL PRIMARY KEY,chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
 reporter_id BIGINT NOT NULL,message_id BIGINT NOT NULL,target_id BIGINT,excerpt TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(chat_id,message_id,reporter_id)
);
CREATE TABLE pending_joins (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,user_id BIGINT NOT NULL,
 request_id UUID NOT NULL UNIQUE,first_name TEXT NOT NULL,username TEXT,state TEXT NOT NULL DEFAULT 'pending',
 requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ,resolved_by BIGINT,
 PRIMARY KEY(chat_id,user_id)
);
CREATE TABLE inbox_decisions (
 chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,kind TEXT NOT NULL,source_ref TEXT NOT NULL,
 state TEXT NOT NULL,decision TEXT NOT NULL,actor_id BIGINT NOT NULL,version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ,
 PRIMARY KEY(chat_id,kind,source_ref)
);
CREATE INDEX member_reports_recent ON member_reports(chat_id,created_at DESC);
CREATE INDEX pending_joins_open ON pending_joins(chat_id,requested_at DESC) WHERE state IN ('pending','uncertain');
CREATE INDEX inbox_decisions_recent ON inbox_decisions(chat_id,created_at DESC);
ALTER TABLE operation_receipts ADD COLUMN chat_id BIGINT;
UPDATE operation_receipts SET chat_id=split_part(key,':',2)::bigint
 WHERE key ~ '^(content|raid|topic|visual|publication|post):-[0-9]+:';
UPDATE operation_receipts SET chat_id=split_part(key,':',3)::bigint
 WHERE key ~ '^alliance:[0-9]+:-[0-9]+:';
CREATE INDEX operation_receipts_chat ON operation_receipts(chat_id,created_at) WHERE state IN ('pending','uncertain');
ALTER TABLE users ADD COLUMN bot_language TEXT;
