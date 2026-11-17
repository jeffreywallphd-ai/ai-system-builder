CREATE INDEX organization_documents_system_builder_workspace_idx
  ON organization_documents (organization_id, document_key COLLATE "C")
  WHERE namespace = 'system-builder/records' AND payload_json->>'status' <> 'archived';
