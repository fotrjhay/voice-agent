# Dashboard setup: Supabase Auth/Postgres and Dropbox

This version keeps exactly two admin functions: assistant settings and document upload/listing. The application baseline and rag-wrapper contract remain in place. Browser voice is now selected by server-only `VOICE_BACKEND=pipecat|openai_direct`; see [backend deployment and rollback](PIPECAT_MIGRATION.md). No live migrations, uploads, credential revocations, infrastructure changes, webhooks or deployments are performed by installation or startup.

## 1. Local installation and configuration

Use Node.js 22.14 or later in the Node.js 22 line. In PowerShell:

```powershell
Set-Location C:\Software\voice_agent
npm install
# Only create this if absent. Otherwise edit the existing file.
Copy-Item .env.example .env.local
notepad .env.local
```

Keep real credentials in `.env.local` / hosting secrets. Do not paste them into chat or commit them. Public Supabase URL/publishable keys are project identifiers, not privileged credentials. Never prefix database passwords, Dropbox secrets, OpenAI keys, wrapper keys or the Pipecat service token with `NEXT_PUBLIC_`.

| Setting | Purpose |
| --- | --- |
| `VOICE_BACKEND` | `pipecat` by default; `openai_direct` for browser rollback |
| `PIPECAT_SERVICE_URL`, `PIPECAT_SERVICE_TOKEN` | Website-only service origin and secret matching Render `BROWSER_TOKEN` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Current publishable key (public); legacy anon key works if the project still uses it |
| `ADMIN_DATABASE_URL` | Server-only scoped PostgreSQL login in that same Supabase project |
| `ADMIN_DATABASE_TLS` / `ADMIN_DATABASE_CA` | Verified TLS; optional provider CA PEM |
| `VOICE_APP_ORIGIN` | Exact voice origin; falls back to existing `APP_ORIGIN` or Vercel production domain |
| `ADMIN_APP_ORIGIN` | Exact admin origin; defaults to voice origin, preserving `/admin` on the current domain |
| `BUSINESS_ID` | Stable server-owned document business ID; default `primary`; do not change after uploads |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` | Server-only App Folder credentials and offline authorization |
| `DROPBOX_UPLOAD_FOLDER` | Fixed path inside the App Folder namespace; default `/documents` |
| `DOCUMENT_MAX_UPLOAD_BYTES` | Positive integer, at most 3,145,728 bytes (3 MiB) |

No Supabase service-role/secret key is needed. The server reads only the fixed settings row through its scoped PostgreSQL role; user-scoped Supabase clients perform admin settings reads/writes under RLS. Supabase Storage is not used. Business defaults still initialize the first settings row. In Pipecat mode, OpenAI/model/voice/wrapper configuration belongs on the Python service; retain the website’s direct-mode variables if rollback is required. Do not copy the website `.env.local` into the Python service.

### Browser voice settings and backend selection

**There is no Pipecat/OpenAI selector in `/admin`.** The dashboard edits business settings and documents; backend selection is a website server environment setting, not a saved dashboard field.

To change the hosted website backend:

1. In the Vercel website project, open **Settings → Environment Variables**.
2. Set `VOICE_BACKEND` to exactly `pipecat` or `openai_direct` for the intended deployment environment (for example, Production).
3. For Pipecat, also configure `PIPECAT_SERVICE_URL` and `PIPECAT_SERVICE_TOKEN` as described in [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md). For direct mode, retain the website's OpenAI/retrieval configuration.
4. Redeploy the website with the updated variables, then start a new browser voice session. Saving a variable alone does not update an existing deployment.

Locally, edit `VOICE_BACKEND` in the website's `.env.local` and restart the development server. Do not add this variable to the independent Render service to switch the website backend. Neither action adds a dashboard control.

Deploy the Pipecat settings-handoff update before the website update, configure the website service URL/token, then select `VOICE_BACKEND=pipecat`. See [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md) for the exact environment values and rollout checks. The selector is not a dashboard field and visitors cannot choose it. Changing it requires a website restart/redeploy; it does not require a SQL migration or Supabase auth change.

Both backends load saved settings on the server for each new voice connection. Pipecat receives the compiled business instructions, baseline and greeting with the SDP offer; direct mode sends the configuration when minting the OpenAI client credential. Existing sessions retain their snapshot. The Python service acknowledges applied settings; an old service version is rejected rather than silently using its local prompt. Phone calls continue using their existing service configuration.

To roll browser voice back, set `VOICE_BACKEND=openai_direct` and redeploy the website with its OpenAI/retrieval variables configured. Do not roll back the database or remove saved settings just to switch voice backends. The protected admin voice test uses the selected backend and retains flag, opt-in, membership and origin checks; diagnostics differ by backend as described in [HOSTED_DIAGNOSTICS.md](HOSTED_DIAGNOSTICS.md).

## 2. Review and apply migrations to Supabase

Back up existing settings/schema before changes. Use the operator's SQL editor or migration connection, not the application's runtime login. Nothing runs SQL automatically.

1. Inspect the target project's existing tables. The code reuses `voice_agent_admin.business_settings` from this repository's earlier migration. Do not replace an unrelated table or drop existing data.
2. For a fresh project, review/apply `migrations/001_admin.up.sql` once. If it is already applied, do not rerun it.
3. Review/apply `migrations/002_supabase_dropbox.up.sql` once. It adds a version column without replacing settings, explicit membership, RLS, a concurrency-aware save function and document idempotency receipts.
4. Add `voice_agent_admin` to the project's **Data API exposed schemas**. Keep its explicit grants/RLS; exposing a schema does not mean granting public table access.
5. Create the dedicated application login in an operator `psql` session:

   ```sql
   CREATE ROLE voice_agent_login LOGIN;
   \password voice_agent_login
   GRANT voice_agent_runtime TO voice_agent_login;
   GRANT CONNECT ON DATABASE postgres TO voice_agent_login;
   ```

   Replace the database name if different. `\password` prompts privately. This role has no schema CREATE or membership management permissions. After 002, it can SELECT the single settings record and use rate-limit/document-receipt tables; it cannot write settings. Do not give it `authenticated`, owner, superuser or bypass-RLS privileges. Review existing database-wide PUBLIC grants separately.

6. Copy the connection endpoint from Supabase **Connect**, using the custom role, not the owner login, in `ADMIN_DATABASE_URL`.

For Vercel, the shared transaction pooler is suitable for short-lived serverless connections. Copy its actual host/port from the dashboard; do not invent the region/cluster host. A custom-role pooler username is `voice_agent_login.<PROJECT_REF>`. The shared transaction pooler normally uses port 6543; the session pooler uses 5432. Direct database endpoints may require IPv6 or a configured IPv4 option. This app uses parameterized, unnamed queries and does not rely on prepared statements or persistent SQL session state. Use direct/session connections for migration/backup tooling where needed. See [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Remote/production database certificates are verified; use `ADMIN_DATABASE_CA` if the provider requires its CA. URL SSL flags cannot disable verification. Only a loopback non-production database can use `ADMIN_DATABASE_TLS=disable`. A private Render TimescaleDB address is not made reachable by adding credentials: keep retrieval private and configure the admin database separately. Provider connection limits, pooling, network access, TLS certificates, project availability, regions and usage costs must be checked by the operator. No prices are assumed.

### Initialization and precedence

- No `ADMIN_DATABASE_URL`: public voice continues using environment defaults; the dashboard fails closed until complete auth/database setup.
- Configured database, no saved row: use validated environment business defaults, version `0`. The first authorized save inserts the row.
- Saved row: database settings override defaults. Existing values survive migration. No startup seed or automatic overwrite occurs.
- Configured database unavailable/unmigrated: show an error and deny new settings-dependent sessions; do not silently revert or serve stale cached settings.

The public reader accepts no browser-selected table/business/query. It selects row `id=1`, validates the approved settings fields, and passes only the business label to the public page. New Realtime sessions read saved configuration afresh. Saves need no code change/redeploy; existing sessions retain their initial settings. Refresh the public page for its new label.

Settings retain business name, greeting, supported tone, multiline instructions, support email, WhatsApp/phone and optional HTTPS support website. Length/content validation remains enforced. Saves include an expected version; a stale edit returns HTTP 409 instead of overwriting a newer edit. Use **Reload saved settings**, review changes and save again. Two simultaneous first saves are also protected.

## 3. Disable sign-ups and explicitly provision administrators

Supabase Auth email/password replaces GitHub OAuth. There is no public sign-up endpoint/form or first-user admin assignment in this app. **Disable “Allow new users to sign up” in the Supabase project's Auth configuration itself**. Keep email/password sign-in enabled. Review existing project usage first: Auth settings, Site URL and email templates affect other applications sharing that Supabase project. See [Supabase general configuration](https://supabase.com/docs/guides/auth/general-configuration).

1. In **Authentication → Users**, create or invite the intended administrator using the operator account. Use a strong password if creating directly; do not store it in source/env or share it in chat.
2. Verify the person and copy the new Supabase Auth **UUID**. Authenticated does not mean admin. Existing GitHub identity/numeric IDs are not Supabase UUIDs.
3. Grant membership only from an operator database session:

   ```sql
   INSERT INTO voice_agent_admin.admin_members (user_id)
   VALUES ('<verified-supabase-auth-user-uuid>');
   ```

4. Provision membership before the person opens an invite/reset link. Do not transfer privileges just because an email matches an old GitHub account. Old GitHub JWT sessions are not accepted by the new app.
5. To remove access, delete that UUID's membership using the operator account. No dashboard user can insert/update/delete membership, including an existing admin.

`is_admin()` uses a fixed-search-path security-definer lookup of `auth.uid()`; membership has no recursive self-referencing policy and no client table grants. Settings saves use a security-invoker RPC and user RLS, not an unchecked privileged client. Anonymous users and authenticated non-admins have no dashboard settings access. Dropbox metadata/receipts and tokens are not exposed through client tables.

Every dashboard page and operation verifies identity using `auth.getUser()` and then checks current membership. No authorization uses `getSession()` alone, user metadata or client flags. `proxy.ts` uses validated `getClaims()` for refresh, forwards changed cookies to downstream server rendering and the response, and marks auth responses private/no-store. Cookies are host-only, SameSite=Lax and Secure on HTTPS. Supabase SSR's compatible default JavaScript-readable auth-cookie behavior is retained; this flow does not claim HTTP-only cookies. Do not broaden cookie Domain to all subdomains.

Configure Supabase JWT/session expiry, refresh-token rotation, recovery expiry and supported inactivity/time-box settings for your plan. The app does not claim its own former NextAuth one-hour hard limit. Sign-out requests global Supabase sign-out and clears local SSR cookies; server-verified `getUser()` plus fresh membership checks are used for sensitive operations. Test revoked/expired sessions in your project; token/session revocation semantics and refresh grace windows are provider-controlled. See [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and [advanced session guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

### Recovery, invitation email and redirects

Set the project's **Site URL** to the exact intended admin origin, without a trailing path/slash. Add only explicit redirect URLs for authorized environments, for example:

```text
http://localhost:3000/admin/reset
https://<admin-host>/admin/reset
```

Use real hostnames from your configuration; do not add wildcard production allowlists. Configure production SMTP/email delivery and a suitably short recovery OTP expiry. The default provider email service may have delivery/testing/rate restrictions; test the authorized inbox without exposing credentials.

This app intentionally receives tokens in a URL **fragment**, not server query parameters. Configure these email template links:

```html
<!-- Reset Password template: RedirectTo comes from this server's fixed admin reset URL. -->
<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a>
<!-- Invite User template: use the configured Site URL for this admin environment. -->
<a href="{{ .SiteURL }}/admin/reset#token_hash={{ .TokenHash }}&amp;type=invite">Set administrator password</a>
```

The reset page removes the fragment from browser history immediately and POSTs only the token hash and whitelisted `recovery`/`invite` type to the same-origin confirm endpoint. Supabase validates expiry/one-time use; the server verifies admin membership before retaining the session. Password changes require a verified member and 12–128 characters, then sign out. Arbitrary `next`/redirect destinations are not accepted. Email/password login and recovery use non-enumerating messages. Invalid links show a retry/recovery message. See [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

### Brute-force and application limits

Configure Supabase's Auth rate limits/password policy and hosting WAF/access protection for the deployment; the public Supabase API can be called directly with its publishable key, so app limits do not replace provider controls. CAPTCHA-enforced projects require a separately implemented captcha-token UI before this app's password forms can work; do not enable it and assume it is integrated here.

PostgreSQL supplies atomic fixed-minute buckets shared across Vercel processes: auth mutations 30/minute, admin reads 60, settings writes 20, uploads 10. They are bounded global pilot limits, not per-IP limits, and a flood can consume the shared auth budget. Database/limiter failures fail closed. Sign-out bypasses the database limiter so cookies can be cleared during an outage, while retaining origin protection. Public voice/search still require their own commercial authentication/quotas; admin login does not protect them.

## 4. Authorize the single Dropbox account

1. In the Dropbox developer **App Console**, create a **Scoped Access → App Folder** app. Do not choose Full Dropbox access. A folder app sees only its own namespace.
2. Enable `files.content.write` and `files.metadata.read`. The dashboard uses no file downloads. If n8n will read using this same app, also enable `files.content.read` and authorize with the helper's `--ingestion-read` option below.
3. Register this exact loopback redirect for the operator-only setup helper:

   ```text
   http://localhost:53682/dropbox/callback
   ```

4. Put `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` in `.env.local`. Do not use the developer console's short-lived generated access token as a permanent refresh token.
5. Run the helper **yourself** in PowerShell:

   ```powershell
   npm run setup:dropbox
   # If files.content.read is enabled for the later n8n handoff:
   node scripts/dropbox-authorize.mjs --ingestion-read
   ```

6. Open the printed authorization URL, sign in to the chosen operator Dropbox account and approve. The helper requests offline access, binds only to loopback, validates random OAuth state and times out after ten minutes. There is no public setup/token endpoint. It stores the refresh token in ignored `.env.dropbox-setup.local` with private-file permissions where supported, not in browser HTML or stdout. Protect its Windows folder/ACL as you would `.env.local`.
7. Copy the token privately into `.env.local` and Vercel's server-only `DROPBOX_REFRESH_TOKEN`. The helper does not overwrite an existing token file; move it to private storage or remove it yourself before repeating a new authorized setup.
8. In Dropbox, find **Apps → <your-app-name>** and create `documents` there. Set `DROPBOX_UPLOAD_FOLDER=/documents`. API paths are relative to the App Folder root: do **not** set `/Apps/<your-app-name>/documents` for this app token.
9. Restart locally / redeploy environment changes. Every admin uses this one operator-connected account; admins do not connect personal Dropbox accounts.

If scopes change, re-authorize and provision the resulting refresh token. Runtime code exchanges it for short-lived access tokens, caches those only in process memory and retries once after HTTP 401 with a refresh. It never rewrites environment variables/files. Provider errors and tokens/file contents are not logged. See [Dropbox OAuth](https://developers.dropbox.com/oauth-guide) and [App Folder/file access](https://developers.dropbox.com/dbx-file-access-guide).

The browser sends a raw body with a normalized display filename and UUID idempotency key, never a Dropbox folder/token. The server counts bytes before buffering beyond the limit. PDF/DOCX/TXT/MD/TEXT/CSV/JSON checks remain; these are type/content checks, not embeddings, business-document parsing or malware certification. The 3 MiB hard maximum stays below Vercel's 4.5 MB function payload cap; lower limits are configurable. Oversized requests may be rejected by Vercel before app code. Larger uploads need a separately reviewed resumable/staging design, not an increased local-only limit. See [Vercel limits](https://vercel.com/docs/functions/limitations).

### Stable IDs and retries

Before calling Dropbox, PostgreSQL reserves a server-generated document UUID for `(verified_user_uuid, idempotency_key)`. The reserved path uses that UUID and a validated extension, not a browser-selected destination. Reusing a key with changed content/name/type is rejected. Different selections receive new keys even if names match; files are not deduplicated by filename alone.

Uploads use add mode, no autorename and strict conflict handling. A retry checks Dropbox content hash at the same reserved path; concurrent conflicts resolve to the same confirmed file. No existing content is silently overwritten. Receipts retain provider `dropbox`, stable document ID, Dropbox file ID/revision, original display name and server business ID. Keep selecting the same file after an uncertain failure so its retry key remains. A receipt-save error can occur after Dropbox accepted bytes; retrying the same key repairs the receipt without a second file. A full page reload loses the selected browser file/key; inspect the list before starting a new selection.

Lists show actual non-deleted files directly inside the configured folder, not recursive folders. Pagination uses Dropbox cursors; returned paths are filtered against that fixed parent. Original display names are restored from app receipts. Outside/manual Dropbox files retain their Dropbox names and are marked as not registered by this app. Empty/error/loading states are separate from upload feedback. **Uploaded to Dropbox** confirms storage only; **search availability is not yet tracked**.

The old implementation had no persisted Drive document receipts, only live Drive listing. Existing Google Drive files are left untouched and are not presented as Dropbox files. If the target database has additional legacy document records outside this repository's schema, preserve/export them with explicit provider labels and review the migration rather than dropping or fabricating replacements. This task does not move/delete old documents or clean up vectors.

## 5. n8n handoff (documentation only)

No upload-completed webhook existed in the inspected code, so no notification hook is enabled or called. Upload success is independent of an n8n endpoint. Operators will update n8n separately. No workflow configuration was available here; monitoring/detection remains unverified.

n8n must access the **same account and app namespace**. Another App Folder app on the same account sees a different namespace. Use the same scoped app (with read permission) or an explicitly authorized mechanism that can access the physical `Apps/<app-name>/documents` folder. Do not assume same-account tokens from different App Folder apps are interchangeable.

Proposed later handoff payload (example values, not an emitted event):

```json
{
  "event_id": "<document-id>:<dropbox-revision>",
  "business_id": "<server-BUSINESS_ID>",
  "document_id": "<stable-server-uuid>",
  "source_id": "<BUSINESS_ID>:<document-id>",
  "provider": "dropbox",
  "provider_file_id": "id:<dropbox-id>",
  "revision": "<dropbox-revision>",
  "display_name": "Business guide.pdf"
}
```

The app returns this source identity in successful upload receipts/listing when registered. The stored filename contains the document UUID; `business_id` is server-owned. n8n must retain the same `source_id` when a revision changes; a revision is not a new logical source. A future webhook should use server-held authentication, bounded timeout, durable idempotent event IDs and separate notification error status, with awaited work rather than fire-and-forget. None is implemented/enabled in this version.

## 6. Domains and deployment sequence

`/admin` works on localhost and the current voice domain. Set `VOICE_APP_ORIGIN=https://<voice-host>` and `ADMIN_APP_ORIGIN=https://<admin-host>` for split hosts. The admin host's `/` server-renders the same protected admin component; it does not proxy an external rewrite, duplicate `/admin` prefixes, or loop. Login/reset/API paths remain `/admin/...` and `/api/...`. Each host uses its own same-origin backend and host-only cookies; there is no shared-domain cookie or cross-origin API request. Unknown application hosts and cross-subdomain mutations are rejected. `APP_ORIGIN` remains a compatible voice-origin fallback.

In Vercel, add both domains to this same project and follow the **actual DNS values shown in that project's Domains screen** at your DNS provider. Do not invent CNAME/A targets. Configure exact server origins and Supabase Site URL/reset allowlists, then create a new deployment. Local development may leave hosted origins blank and use `http://localhost:3000`. Preview hosts are not automatically trusted. No domain or DNS change is performed by this code.

Ordered rollout: review/back up → apply 001 if absent and 002 → expose schema/grants/RLS → disable public sign-up → provision Auth user and explicit membership → configure email templates/delivery/redirects → create/authorize Dropbox App Folder app → configure scoped database and server secrets → deploy only after separate authorization → validate checklist → retire obsolete GitHub/Google deployment settings after validation.

`NEXTAUTH_*`, `GITHUB_CLIENT_*`, `ADMIN_GITHUB_ID`, `GOOGLE_SERVICE_ACCOUNT_*`, `GOOGLE_DRIVE_*` and `DRIVE_MAX_UPLOAD_BYTES` are no longer required. Their packages/routes are removed from active use. Operators may remove those old deployment secrets after validation; this task does not revoke external credentials or change repository/GitHub deployment integration. Supabase users must be provisioned afresh and explicitly authorized by UUID, independently of old GitHub sessions.

## 7. Rollback and verification

Do not apply a migration to a live database as part of a test. Export settings, versions, membership and document receipts before rollback. `002_supabase_dropbox.down.sql` removes the new authorization/receipt structures and restores prior scoped-role settings writes, but retains all settings/version values. **Dropping membership/receipt tables loses that metadata/idempotency history unless backed up.** It never deletes remote files, Supabase Auth users or vector data. Stop admin traffic, roll back the application and database together under operator control. The earlier 001 down migration is only for deliberately removing the original admin schema, not routine rollback of this overhaul.

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
node tests/runtime-smoke.mjs --pipecat
# Explicit opt-in only, after migrations in a DISPOSABLE Supabase/local project:
$env:RUN_SUPABASE_RLS_TESTS='yes-disposable'
$env:SUPABASE_RLS_TEST_DATABASE_URL='<private disposable operator connection>'
npm run test:rls
```

The RLS script defaults to SKIP, creates synthetic Auth users/membership inside a transaction and always rolls back. It checks anonymous/non-admin reads/writes, metadata/self-grant denial, explicit admin access and stale-version conflicts using real PostgreSQL roles/policies. Use a verified TLS connection (optional `SUPABASE_RLS_TEST_CA`) and a disposable operator connection; never the production URL. Mock tests alone do not prove SQL policy enforcement.

Manual acceptance:

1. Verify disabled sign-ups at the provider; anonymous and ordinary signed-in users must be denied on `/admin`, root admin host and all settings/document APIs.
2. Provision one verified UUID, sign in/out, test invalid credentials without enumeration, recovery/invite links, expired/reused links, password reset, removed membership and revoked sessions.
3. Check SSR refresh and host-only/Secure/SameSite cookies, no public caching, exact-origin mutation rejection and app/provider rate limits. Test both domains and localhost without wildcard trust.
4. Confirm pre-save defaults and preserved existing settings; save multiline instructions/tone/support contacts; verify the next voice session and refreshed public label. Test two editors for HTTP 409 and database outage for explicit errors. Baseline and tool permissions must remain application-controlled.
5. Upload a small valid file only when authorized; retry the same request/key, simulate timeout/concurrent submission, and confirm exactly one reserved Dropbox file/receipt. Try invalid type, content, oversize body, changed bytes under the same key and unsafe destinations.
6. Verify actual folder contents, original display name/ID/revision, pagination, empty/list failure independently of upload success, and the uploaded-only status.
7. Independently configure/check n8n's same namespace and stable source ID; do not infer ingestion from storage success. Verify no old Drive files/records were moved or relabeled.
8. Inspect browser bundles/responses/logs for permanent credentials. Test keyboard/mobile/status announcements and public voice/mute/interruption/end/restart/search regression behavior.

Live Supabase policy/SMTP/session behavior, Dropbox authorization/files, n8n, Vercel domains and website microphone/audio checks require separate verification. The operator reported the standalone Render browser test working on Wi-Fi/mobile data; that does not verify the website cutover or dashboard handoff. Automated HTTP smoke tests use a local fake Supabase boundary and in-memory SQL substitute, not live services. Do not configure the test preloader in a deployment.

### Recorded verification — October 28, 2026

All 113 mocked tests in eight files passed, including the preserved 33 voice/search regression tests. Type checking, lint and the production build passed. The HTTP smoke test passed for host routing, all anonymous admin operation denials, Supabase SSR cookie behavior, explicit membership, settings persistence/version conflict, cross-origin rejection, logout cookie clearing and revoked-session denial against a local fake provider. Refreshed-cookie propagation and private caching are also covered by unit tests. The browser-bundle scan found no server-credential references. Production dependency audit: zero advisories. The inherited Vitest 3 development toolchain still has its prior audit findings; it is not part of the served runtime.

`npm run test:rls` reported **SKIP** because no explicit disposable database URL/opt-in was configured. Real SQL policy behavior, remote database permissions, recovery email delivery, Dropbox grants/uploads, n8n and live domains/audio were not verified. No live services/data, remote credentials or deployments were changed, and no code was pushed by this task.
