CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS structured_documents (
  namespace TEXT NOT NULL,
  document_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (namespace, document_key)
) STRICT;

CREATE INDEX IF NOT EXISTS structured_documents_updated_at_idx
  ON structured_documents (namespace, updated_at DESC);
