CREATE TABLE group_invites (
  id uuid PRIMARY KEY,
  chat_id bigint NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  actor_id bigint NOT NULL,
  bot_id bigint NOT NULL,
  invite_link text NOT NULL,
  name text NOT NULL,
  member_limit integer NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX group_invites_chat_expiry ON group_invites(chat_id, expires_at DESC);
