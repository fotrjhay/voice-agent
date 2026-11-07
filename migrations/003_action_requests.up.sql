-- Apply in the database used by call_agent ACTIONS_DATABASE_URL.
-- Supports existing website-admin databases and standalone PostgreSQL databases.
-- The migration operator needs CREATE on the database and CREATEROLE if the role is absent.
BEGIN;
CREATE SCHEMA IF NOT EXISTS voice_agent_admin;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voice_agent_runtime') THEN
    CREATE ROLE voice_agent_runtime NOLOGIN;
  END IF;
END;
$migration$;
GRANT USAGE ON SCHEMA voice_agent_admin TO voice_agent_runtime;
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
REVOKE ALL ON voice_agent_admin.action_requests FROM PUBLIC;
-- Supabase browser roles do not exist in a plain PostgreSQL database.
DO $migration$
DECLARE browser_role text;
BEGIN
  FOR browser_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format('REVOKE ALL ON voice_agent_admin.action_requests FROM %I', browser_role);
  END LOOP;
END;
$migration$;
GRANT SELECT, INSERT, UPDATE ON voice_agent_admin.action_requests TO voice_agent_runtime;
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'voice_agent_admin'
      AND tablename = 'action_requests' AND policyname = 'runtime_actions'
  ) THEN
    CREATE POLICY runtime_actions ON voice_agent_admin.action_requests FOR ALL TO voice_agent_runtime
      USING (business_id = current_setting('app.business_id', true))
      WITH CHECK (business_id = current_setting('app.business_id', true));
  END IF;
END;
$migration$;
COMMIT;
