-- DISPOSABLE SUPABASE ONLY. Run by scripts/test-supabase-rls.mjs; always rolled back.
BEGIN;
SELECT set_config('voice_test.admin', gen_random_uuid()::text, true);
SELECT set_config('voice_test.ordinary', gen_random_uuid()::text, true);
INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
VALUES (current_setting('voice_test.admin')::uuid, 'authenticated', 'authenticated', 'admin-rls-test@example.invalid', '{}', '{}', now(), now()),
       (current_setting('voice_test.ordinary')::uuid, 'authenticated', 'authenticated', 'user-rls-test@example.invalid', '{"is_admin":true}', '{}', now(), now());
INSERT INTO voice_agent_admin.admin_members (user_id) VALUES (current_setting('voice_test.admin')::uuid);
INSERT INTO voice_agent_admin.business_settings (id, settings) VALUES (1, '{"businessName":"RLS test","greeting":"Hello","tone":"friendly","instructions":"Use evidence.","supportEmail":"","supportPhone":"","supportUrl":""}') ON CONFLICT (id) DO NOTHING;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM * FROM voice_agent_admin.business_settings; RAISE EXCEPTION 'Anonymous settings read was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('voice_test.ordinary'), true);
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('voice_test.ordinary'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE affected integer; BEGIN
  IF voice_agent_admin.is_admin() THEN RAISE EXCEPTION 'Metadata granted admin'; END IF;
  IF EXISTS (SELECT 1 FROM voice_agent_admin.business_settings) THEN RAISE EXCEPTION 'Non-admin settings read allowed'; END IF;
  UPDATE voice_agent_admin.business_settings SET settings = settings WHERE id = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Non-admin settings update allowed'; END IF;
  BEGIN INSERT INTO voice_agent_admin.admin_members (user_id) VALUES (auth.uid()); RAISE EXCEPTION 'Self-grant allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM voice_agent_admin.save_settings('{}', 0); RAISE EXCEPTION 'Non-admin RPC write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', current_setting('voice_test.admin'), true);
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('voice_test.admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE before_row voice_agent_admin.business_settings; after_row voice_agent_admin.business_settings; BEGIN
  IF NOT voice_agent_admin.is_admin() THEN RAISE EXCEPTION 'Explicit admin denied'; END IF;
  SELECT * INTO STRICT before_row FROM voice_agent_admin.business_settings WHERE id = 1;
  SELECT * INTO STRICT after_row FROM voice_agent_admin.save_settings(before_row.settings, before_row.version);
  IF after_row.version <> before_row.version + 1 THEN RAISE EXCEPTION 'Version not incremented'; END IF;
  BEGIN PERFORM * FROM voice_agent_admin.save_settings(before_row.settings, before_row.version); RAISE EXCEPTION 'Stale update allowed' USING ERRCODE='P0002';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL; END;
  BEGIN DELETE FROM voice_agent_admin.admin_members WHERE user_id = auth.uid(); RAISE EXCEPTION 'Admin membership mutation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
