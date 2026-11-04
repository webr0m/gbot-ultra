CREATE TABLE delegated_roles (
  chat_id bigint NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
  user_id bigint NOT NULL,
  granted_by bigint NOT NULL,
  scopes text[] NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);
