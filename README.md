> Cleanup release: apply additive migrations 003 and 004 after 002; see [CLEANUP_RELEASE.md](CLEANUP_RELEASE.md) for shared configuration, processing status and rollback.

# Business voice assistant

Browser voice now defaults to Pipecat. Select `VOICE_BACKEND=pipecat` or
`VOICE_BACKEND=openai_direct` on the website server. See
[backend setup, deployment order and rollback](PIPECAT_MIGRATION.md).
Both backends use the existing interface and dashboard. **There is no backend dropdown in `/admin`.** Choose the backend through the website server's `VOICE_BACKEND` environment variable, not a Render setting. Backend changes require a restart/redeploy; saved business settings apply to new sessions without a redeploy. The implemented default does not prove that a production cutover has occurred.

For temporary, admin-only hosted voice testing, see
[controlled diagnostics setup and disable instructions](HOSTED_DIAGNOSTICS.md).

Single-business Next.js App Router / TypeScript demo with selectable Pipecat or direct OpenAI Realtime browser voice, rag-wrapper retrieval, and a private admin dashboard. The dashboard uses **Supabase Auth email/password + Supabase Postgres** and **Dropbox App Folder** document storage. It does not record conversations, embed questions, change vectors, or run ingestion.

## Run locally

Use Node.js 22.14 or later in the Node.js 22 line and PowerShell:

```powershell
Set-Location C:\Software\voice_agent
npm install
# Only if .env.local does not exist; otherwise edit the existing file.
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). For the default Pipecat mode, set `PIPECAT_SERVICE_URL` and `PIPECAT_SERVICE_TOKEN` (matching the service’s `BROWSER_TOKEN`) on this server. Deploy the service’s settings-handoff update first. For rollback mode, explicitly set `VOICE_BACKEND=openai_direct`, configure this server’s `OPENAI_API_KEY`, and optionally configure its wrapper settings. Only direct mode supports leaving the wrapper unset for a voice-only smoke test; the Python service requires its own wrapper configuration. The local scripts bind to loopback; localhost permits browser microphone access during development. Hosted access requires HTTPS. Do not paste or commit real secrets.

Without `ADMIN_DATABASE_URL`, voice uses environment business defaults and admin access fails closed. A configured but unavailable database produces explicit errors; it does not silently fall back. A private Render TimescaleDB hostname is not generally reachable from Vercel. Keep retrieval on its existing private architecture and use a securely reachable Supabase database for dashboard settings.

## Admin setup

Follow [ADMIN_SETUP.md](ADMIN_SETUP.md) before using `/admin`:

1. Review/apply 001 only if absent, then the non-destructive settings upgrade [002 migration](migrations/002_supabase_dropbox.up.sql). No migration runs automatically.
2. Configure the scoped PostgreSQL reader/receipt role, Data API schema, grants and RLS. Existing saved settings survive.
3. Disable Supabase public sign-ups. Create/invite the intended user and explicitly grant admin membership by its verified Auth UUID in an operator-only SQL step.
4. Configure email/password auth, recovery/invite templates, delivery and exact admin redirect URLs. No email-matching transfer of old GitHub privileges occurs.
5. Create/authorize a Scoped Access Dropbox **App Folder** app using the operator-only `npm run setup:dropbox` helper. Keep its app secret/refresh token server-only.
6. Configure exact voice/admin origins, deploy only after separate authorization, validate, then retire obsolete login/storage deployment secrets.

The dashboard edits business name, greeting, supported tone, multiline instructions and public support contacts. It uses the signed-in user's RLS-scoped client for writes, with optimistic versions; stale saves return HTTP 409. New voice sessions use saved configuration immediately, with no code edit/redeploy. Existing sessions retain initial settings. Refresh the public page to see a changed label.

Before the first save, defaults come from `BUSINESS_NAME`, `AGENT_GREETING`, `AGENT_TONE`, `AGENT_INSTRUCTIONS`, `SUPPORT_EMAIL`, `SUPPORT_PHONE` and `SUPPORT_URL`. Environment changes require a local restart or hosted redeploy; they never overwrite existing saved settings. `.env.example` includes multiline examples. Never put credentials in prompts. Direct-mode clients can inspect/alter Realtime instructions and tool results. Pipecat receives the website-composed instructions through the authenticated server connection; visitors cannot override that snapshot through the website API. Model instructions remain behavioral guidance in either mode.

The immutable application `ASSISTANT_BASELINE` remains appended in `lib/assistant-instructions.ts`, and `search_knowledge` remains the only configured tool. Settings cannot grant tools or select tenants. Prompt wording is behavioral guidance, not a commercial authorization boundary.

## Documents and ingestion boundary

The dashboard uploads PDF, DOCX, TXT, MD, TEXT, CSV and JSON, limited to **3 MiB** or a smaller configured `DOCUMENT_MAX_UPLOAD_BYTES`. It validates normalized names, media types/content and streamed byte counts. The raw upload body stays below Vercel's documented 4.5 MB payload cap; larger uploads require a separate reviewed design, not a local-only increased limit. Type checks are not antivirus scanning or a guarantee of ingestion compatibility.

PostgreSQL reserves a stable server document UUID and fixed Dropbox path for each verified user's upload key. Retried/concurrent requests reuse that path and verify Dropbox content hash. Add mode/no autorename/conflict handling prevents silent overwrites. Different selections can create distinct documents with the same display name. List pagination reads actual Dropbox folder contents and restores stored original names/IDs/revisions where registered. Status is **Uploaded to Dropbox**; **search availability is not yet tracked**. Listing failures do not turn a successful upload into a false upload failure.

No Google Drive files are moved/deleted. With INGESTION_SERVICE_URL and INGESTION_API_KEY configured, new uploads dispatch ingestion once; without them the receipt confirms upload only. No persisted Drive receipts existed in this inspected implementation. Operators must independently verify n8n sees the **same Dropbox account and App Folder namespace**; another App Folder app on the same account has a different namespace. See the stable `source_id`/revision handoff contract in [ADMIN_SETUP.md](ADMIN_SETUP.md).

## Domains and access boundaries

`APP_ORIGIN` remains a compatible voice-origin fallback. `VOICE_APP_ORIGIN` and `ADMIN_APP_ORIGIN` configure exact HTTPS origins; localhost works when hosted origins are blank. With different hosts, the admin host root server-renders the protected `/admin` component, without rewrite loops. Each host calls same-origin APIs and has host-only cookies; cross-subdomain mutation origins and unknown application hosts are rejected. Use the actual DNS targets supplied by Vercel's Domains screen.

Supabase SSR refreshes cookies in the Next.js proxy and marks auth responses private/no-store. Every sensitive page/API verifies `getUser()` and current admin membership; user metadata and `getSession()` alone never authorize access. Cookies retain Supabase SSR-compatible JavaScript-readable behavior, SameSite=Lax and Secure on HTTPS. PostgreSQL rate limits work across function instances; Supabase Auth and hosting abuse controls still need operator configuration.

**Admin login does not protect public voice/session/search usage.** Those routes still need commercial authentication, quotas, rate limits and enforced session authorization. CORS, origin checks, prompt text and browser timers do not provide those controls.

## Retrieval and voice behavior

| Behavior | `pipecat` (default) | `openai_direct` (rollback) |
| --- | --- | --- |
| Audio path | Browser ↔ TURN relay ↔ Python service ↔ OpenAI | Browser ↔ OpenAI |
| Response/turn owner | Pipecat integration and OpenAI semantic server VAD | Browser turn controller; automatic VAD replies disabled |
| Knowledge search | Python tool calls rag-wrapper | Browser tool calls Next.js `/api/search`, which calls rag-wrapper |
| Model and voice | Render `OPENAI_REALTIME_MODEL` / `OPENAI_VOICE` | Website `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` |
| Wrapper result limit | Service `RETRIEVAL_LIMIT`, default 3 | Next.js limit 5 |
| Captions | Assistant captions when available; no input transcription | User and assistant transcript events |

In Pipecat mode, `/api/session` returns temporary ICE configuration; `/api/offer` forwards only the browser’s SDP plus a server-loaded business settings snapshot and application baseline. The permanent service token stays on the website server. The service must report `settings_handoff_version: 1` and acknowledge `settings_applied: true`. A missing protocol or failed service produces an error, not a silent provider fallback. The browser never generates responses or runs retrieval tools in this mode.

Direct mode mints a Realtime client credential with a 60-second expiry. After the opening greeting, its browser controller requests a response only for a nonempty transcription of the latest user turn. Tool results may continue that reply unless interrupted. Input transcription uses an additional model and can have separate usage charges. Pipecat input transcription is disabled; it uses native speech-to-speech with no separate STT/TTS provider.

Both retrieval paths use only a standalone query, fixed server credentials, bounded responses and safe empty/unavailable outcomes. No tenant, upstream URL or key is selected by a visitor. Each server making a wrapper request needs an authorized network path to rag-wrapper; neither connects directly to the knowledge database. The legacy `/api/search` route remains available even when Pipecat is selected; switching the voice backend does not disable it.

The UI retains up to 60 caption/transcript items in memory. End/failure/unmount stops microphone tracks, closes WebRTC and aborts pending requests. Connection setup has a 90-second browser deadline and connected sessions have a ten-minute browser timer. Pipecat additionally enforces service duration/inactivity/concurrency limits. Direct mode’s browser timer is not server-enforced admission control.

Displayed retrieval time is elapsed server tool/search work, not speech latency or relevance. Pipecat also emits structured operational events and provider-reported usage when available; its browser diagnostics cannot report provider response/user-turn counts or usage and do not invent them. The Pipecat `/health` and `/ready` endpoints check the process/local configuration, not credentials, relay reachability, retrieval or database health. They are distinct from any similarly named rag-wrapper endpoints.

See [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md) for server variables, deployment order, free-Render browser verification, settings precedence and rollback. Browser backend selection does not switch phone calls or change ingestion, embeddings, Supabase auth or Dropbox uploads.

## Verification

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
node tests/runtime-smoke.mjs --pipecat
# Explicit disposable Supabase test only; see ADMIN_SETUP.md for opt-in variables:
npm run test:rls
```

The unit tests preserve voice/search regressions and mock authentication, settings, Dropbox, idempotency and routing. The HTTP smoke tests exercise actual Next.js/Supabase SSR cookies against a local fake Supabase/SQL boundary and, in Pipecat mode, a fake authenticated service; it makes no live provider calls. `test:rls` defaults to SKIP and is required to verify real policies in a disposable migrated Supabase/local project. Do not interpret mocks or a skipped integration test as live RLS proof. Full setup, rollback and manual acceptance are in [ADMIN_SETUP.md](ADMIN_SETUP.md), with the longer project reference in [va_documentation.md](va_documentation.md).

OpenAI usage, optional direct-mode input transcription, TURN relay bandwidth, hosting/database, Dropbox capacity, phone number rental and call minutes can incur separate charges or limits. Check current provider plans/usage; no prices are assumed. End unused voice sessions and use account usage controls.

Official references: [Realtime browser flow](https://developers.openai.com/api/docs/guides/realtime-webrtc), [Realtime server controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Dropbox OAuth](https://developers.dropbox.com/oauth-guide), [Vercel function limits](https://vercel.com/docs/functions/limitations).
