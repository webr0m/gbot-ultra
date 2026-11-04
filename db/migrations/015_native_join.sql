ALTER TABLE join_challenges
  ADD COLUMN native_query text,
  ADD COLUMN native_bot_id bigint,
  ADD COLUMN native_request_id uuid,
  ADD COLUMN native_prompt text;

CREATE INDEX join_challenges_native_expiry ON join_challenges(expires_at)
  WHERE native_query IS NOT NULL;
