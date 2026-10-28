-- Review first. Stop admin writes; export admin_members/documents metadata before rollback.
-- Does not delete settings, Dropbox files, Google Drive files or vector/ingestion data.
BEGIN;
DROP FUNCTION voice_agent_admin.save_settings(jsonb, bigint);
DROP TRIGGER settings_revision ON voice_agent_admin.business_settings;
DROP FUNCTION voice_agent_admin.settings_revision();
DROP POLICY admin_read_settings ON voice_agent_admin.business_settings;
DROP POLICY admin_insert_settings ON voice_agent_admin.business_settings;
DROP POLICY admin_update_settings ON voice_agent_admin.business_settings;
DROP POLICY runtime_read_settings ON voice_agent_admin.business_settings;
DROP POLICY runtime_rate_limits ON voice_agent_admin.rate_limits;
DROP POLICY runtime_documents ON voice_agent_admin.documents;
DROP FUNCTION voice_agent_admin.is_admin();
REVOKE SELECT, INSERT, UPDATE ON voice_agent_admin.business_settings FROM authenticated;
REVOKE INSERT (id, settings), UPDATE (settings) ON voice_agent_admin.business_settings FROM authenticated;
REVOKE USAGE ON SCHEMA voice_agent_admin FROM authenticated;
DROP TABLE voice_agent_admin.admin_members;
DROP TABLE voice_agent_admin.documents;
ALTER TABLE voice_agent_admin.business_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_admin.rate_limits DISABLE ROW LEVEL SECURITY;
GRANT INSERT, UPDATE ON voice_agent_admin.business_settings TO voice_agent_runtime;
-- Keep version/updated_at and all saved values. Old code ignores the extra column.
COMMIT;
