ALTER TABLE scheduler_runs ADD COLUMN started_at TIMESTAMPTZ;
ALTER TABLE scheduler_runs ADD COLUMN failed_at TIMESTAMPTZ;
ALTER TABLE scheduler_runs ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX warnings_open_member_idx ON warnings(chat_id,user_id) WHERE resolved_at IS NULL;
