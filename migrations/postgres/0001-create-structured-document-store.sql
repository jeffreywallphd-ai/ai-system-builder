CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS structured_documents (
  namespace text NOT NULL,
  document_key text NOT NULL,
  payload_json jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (namespace, document_key)
);

CREATE INDEX IF NOT EXISTS structured_documents_updated_at_idx
  ON structured_documents (namespace, updated_at DESC);
