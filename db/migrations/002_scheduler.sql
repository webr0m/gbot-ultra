CREATE TABLE IF NOT EXISTS scheduler_runs (
  name TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL
);
