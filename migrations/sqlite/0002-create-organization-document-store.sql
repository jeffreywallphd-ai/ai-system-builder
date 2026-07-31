
CREATE TABLE IF NOT EXISTS organization_documents (
  organization_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  document_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, namespace, document_key)
) STRICT;

CREATE INDEX IF NOT EXISTS organization_documents_updated_at_idx
  ON organization_documents (organization_id, namespace, updated_at DESC);
