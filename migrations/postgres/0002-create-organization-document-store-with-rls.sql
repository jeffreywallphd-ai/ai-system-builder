
CREATE TABLE organization_documents (
  organization_id text NOT NULL,
  namespace text NOT NULL,
  document_key text NOT NULL,
  payload_json jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, namespace, document_key)
);

CREATE INDEX organization_documents_updated_at_idx
  ON organization_documents (organization_id, namespace, updated_at DESC);

ALTER TABLE organization_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_documents_isolation ON organization_documents
  USING (organization_id = current_setting('app.organization_id', true))
  WITH CHECK (organization_id = current_setting('app.organization_id', true));
