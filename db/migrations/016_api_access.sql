CREATE TABLE api_keys (
  id uuid PRIMARY KEY,
  chat_id bigint NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['read']::text[],
  created_by bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  requests_total bigint NOT NULL DEFAULT 0,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX api_keys_chat ON api_keys(chat_id);
