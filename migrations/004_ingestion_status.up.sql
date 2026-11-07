BEGIN;
ALTER TABLE voice_agent_admin.documents ADD COLUMN ingestion_state text NOT NULL DEFAULT 'uploaded'
  CHECK (ingestion_state IN ('uploaded', 'processing', 'indexed', 'failed'));
COMMIT;
