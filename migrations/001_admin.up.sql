-- Review and apply explicitly as a migration operator with CREATE ROLE/SCHEMA rights.
-- No changes to vector tables, ingestion data, or the public schema.
BEGIN;
CREATE ROLE voice_agent_runtime NOLOGIN;
CREATE SCHEMA voice_agent_admin;
REVOKE ALL ON SCHEMA voice_agent_admin FROM PUBLIC;
CREATE TABLE voice_agent_admin.business_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE voice_agent_admin.rate_limits (
  bucket text PRIMARY KEY CHECK (bucket IN ('auth', 'admin-read', 'admin-write', 'admin-upload')),
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);
REVOKE ALL ON ALL TABLES IN SCHEMA voice_agent_admin FROM PUBLIC;
GRANT USAGE ON SCHEMA voice_agent_admin TO voice_agent_runtime;
GRANT SELECT, INSERT, UPDATE ON voice_agent_admin.business_settings TO voice_agent_runtime;
GRANT SELECT, INSERT, UPDATE ON voice_agent_admin.rate_limits TO voice_agent_runtime;
-- No seed is inserted. The first authenticated Save persists environment defaults or edits.
COMMIT;
