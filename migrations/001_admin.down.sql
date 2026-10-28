-- Destructive ONLY to the new admin settings/rate-limit tables. Export settings first.
-- Stop the admin app and remove voice_agent_runtime membership from its login first.
-- Deliberately no CASCADE: unexpected dependencies must be reviewed.
BEGIN;
DROP TABLE voice_agent_admin.rate_limits;
DROP TABLE voice_agent_admin.business_settings;
DROP SCHEMA voice_agent_admin;
DROP ROLE voice_agent_runtime;
COMMIT;
