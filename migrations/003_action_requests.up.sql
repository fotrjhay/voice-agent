BEGIN;
CREATE TABLE IF NOT EXISTS voice_agent_admin.action_requests (
  business_id text NOT NULL,
  request_id text NOT NULL,
  payload_hash text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, request_id)
);
ALTER TABLE voice_agent_admin.action_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON voice_agent_admin.action_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON voice_agent_admin.action_requests TO voice_agent_runtime;
CREATE POLICY runtime_actions ON voice_agent_admin.action_requests FOR ALL TO voice_agent_runtime
  USING (business_id = current_setting('app.business_id', true))
  WITH CHECK (business_id = current_setting('app.business_id', true));
COMMIT;
