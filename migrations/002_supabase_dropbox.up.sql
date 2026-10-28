-- Review/apply manually in the selected Supabase project after 001_admin.up.sql.
-- Existing settings are preserved. No user is automatically made an administrator.
BEGIN;
ALTER TABLE voice_agent_admin.business_settings ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
CREATE TABLE voice_agent_admin.admin_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE voice_agent_admin.documents (
  document_id uuid PRIMARY KEY,
  idempotency_key uuid NOT NULL,
  created_by uuid NOT NULL,
  business_id text NOT NULL,
  provider text NOT NULL DEFAULT 'dropbox',
  original_name text NOT NULL,
  content_hash text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 3145728),
  mime_type text NOT NULL,
  provider_path text NOT NULL,
  provider_file_id text,
  revision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, idempotency_key),
  UNIQUE (provider, provider_path)
);
ALTER TABLE voice_agent_admin.admin_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_admin.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_admin.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_agent_admin.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA voice_agent_admin FROM anon, authenticated;
REVOKE INSERT, UPDATE ON voice_agent_admin.business_settings FROM voice_agent_runtime;
GRANT USAGE ON SCHEMA voice_agent_admin TO authenticated;
GRANT SELECT ON voice_agent_admin.business_settings TO authenticated;
GRANT INSERT (id, settings), UPDATE (settings) ON voice_agent_admin.business_settings TO authenticated;
GRANT SELECT ON voice_agent_admin.business_settings TO voice_agent_runtime;
GRANT SELECT, INSERT, UPDATE ON voice_agent_admin.documents TO voice_agent_runtime;

-- Owner executes the membership lookup. No policy on admin_members calls itself.
CREATE FUNCTION voice_agent_admin.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM voice_agent_admin.admin_members WHERE user_id = (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION voice_agent_admin.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_agent_admin.is_admin() TO authenticated;
CREATE POLICY admin_read_settings ON voice_agent_admin.business_settings FOR SELECT TO authenticated USING ((SELECT voice_agent_admin.is_admin()));
CREATE POLICY admin_insert_settings ON voice_agent_admin.business_settings FOR INSERT TO authenticated WITH CHECK (id = 1 AND (SELECT voice_agent_admin.is_admin()));
CREATE POLICY admin_update_settings ON voice_agent_admin.business_settings FOR UPDATE TO authenticated USING ((SELECT voice_agent_admin.is_admin())) WITH CHECK (id = 1 AND (SELECT voice_agent_admin.is_admin()));
CREATE POLICY runtime_read_settings ON voice_agent_admin.business_settings FOR SELECT TO voice_agent_runtime USING (id = 1);
CREATE POLICY runtime_rate_limits ON voice_agent_admin.rate_limits FOR ALL TO voice_agent_runtime USING (true) WITH CHECK (true);
CREATE POLICY runtime_documents ON voice_agent_admin.documents FOR ALL TO voice_agent_runtime USING (true) WITH CHECK (true);

CREATE FUNCTION voice_agent_admin.settings_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER settings_revision BEFORE UPDATE ON voice_agent_admin.business_settings FOR EACH ROW EXECUTE FUNCTION voice_agent_admin.settings_revision();

-- SECURITY INVOKER: writes still require the caller's grants and RLS membership.
CREATE FUNCTION voice_agent_admin.save_settings(new_settings jsonb, expected_version bigint)
RETURNS SETOF voice_agent_admin.business_settings LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE saved voice_agent_admin.business_settings;
BEGIN
  IF NOT voice_agent_admin.is_admin() THEN RAISE insufficient_privilege; END IF;
  IF expected_version = 0 THEN
    INSERT INTO voice_agent_admin.business_settings (id, settings) VALUES (1, new_settings)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE voice_agent_admin.business_settings SET settings = new_settings
    WHERE id = 1 AND version = expected_version RETURNING * INTO saved;
  END IF;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'settings_conflict' USING ERRCODE = 'P0001'; END IF;
  RETURN NEXT saved;
END;
$$;
REVOKE ALL ON FUNCTION voice_agent_admin.settings_revision() FROM PUBLIC;
REVOKE ALL ON FUNCTION voice_agent_admin.save_settings(jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION voice_agent_admin.save_settings(jsonb, bigint) TO authenticated;
COMMIT;
-- Operator: expose ONLY voice_agent_admin as an additional Data API schema in Supabase.
-- Then provision verified UUIDs with an explicit operator INSERT into admin_members.
