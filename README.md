# Business voice assistant

Browser voice now defaults to Pipecat. Select `VOICE_BACKEND=pipecat` or
`VOICE_BACKEND=openai_direct` on the website server. See
[backend setup, deployment order and rollback](PIPECAT_MIGRATION.md).
The direct OpenAI implementation described below remains available for rollback.

For temporary, admin-only hosted voice testing, see
[controlled diagnostics setup and disable instructions](HOSTED_DIAGNOSTICS.md).

Single-business Next.js App Router / TypeScript demo with OpenAI Realtime WebRTC, server-side rag-wrapper search, and a private admin dashboard. The dashboard uses **Supabase Auth email/password + Supabase Postgres** and **Dropbox App Folder** document storage. It does not record conversations, embed questions, change vectors, or run ingestion.

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

Open [http://localhost:3000](http://localhost:3000). Set the server-only `OPENAI_API_KEY` locally. Leave retrieval unset for voice-only smoke testing. The local scripts bind to loopback; localhost permits browser microphone access during development. Hosted access requires HTTPS. Do not paste or commit real secrets.

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

Before the first save, defaults come from `BUSINESS_NAME`, `AGENT_GREETING`, `AGENT_TONE`, `AGENT_INSTRUCTIONS`, `SUPPORT_EMAIL`, `SUPPORT_PHONE` and `SUPPORT_URL`. Environment changes require a local restart or hosted redeploy; they never overwrite existing saved settings. `.env.example` includes multiline examples. Never put credentials in prompts: Realtime startup instructions can be inspected/altered by a modified client.

The immutable application `ASSISTANT_BASELINE` remains appended in `lib/assistant-instructions.ts`, and `search_knowledge` remains the only configured tool. Settings cannot grant tools or select tenants. Prompt wording is behavioral guidance, not a commercial authorization boundary.

## Documents and ingestion boundary

The dashboard uploads PDF, DOCX, TXT, MD, TEXT, CSV and JSON, limited to **3 MiB** or a smaller configured `DOCUMENT_MAX_UPLOAD_BYTES`. It validates normalized names, media types/content and streamed byte counts. The raw upload body stays below Vercel's documented 4.5 MB payload cap; larger uploads require a separate reviewed design, not a local-only increased limit. Type checks are not antivirus scanning or a guarantee of ingestion compatibility.

PostgreSQL reserves a stable server document UUID and fixed Dropbox path for each verified user's upload key. Retried/concurrent requests reuse that path and verify Dropbox content hash. Add mode/no autorename/conflict handling prevents silent overwrites. Different selections can create distinct documents with the same display name. List pagination reads actual Dropbox folder contents and restores stored original names/IDs/revisions where registered. Status is **Uploaded to Dropbox**; **search availability is not yet tracked**. Listing failures do not turn a successful upload into a false upload failure.

No Google Drive files are moved/deleted, and no ingestion API or n8n webhook is called. No persisted Drive receipts existed in this inspected implementation. Operators must independently verify n8n sees the **same Dropbox account and App Folder namespace**; another App Folder app on the same account has a different namespace. See the stable `source_id`/revision handoff contract in [ADMIN_SETUP.md](ADMIN_SETUP.md).

## Domains and access boundaries

`APP_ORIGIN` remains a compatible voice-origin fallback. `VOICE_APP_ORIGIN` and `ADMIN_APP_ORIGIN` configure exact HTTPS origins; localhost works when hosted origins are blank. With different hosts, the admin host root server-renders the protected `/admin` component, without rewrite loops. Each host calls same-origin APIs and has host-only cookies; cross-subdomain mutation origins and unknown application hosts are rejected. Use the actual DNS targets supplied by Vercel's Domains screen.

Supabase SSR refreshes cookies in the Next.js proxy and marks auth responses private/no-store. Every sensitive page/API verifies `getUser()` and current admin membership; user metadata and `getSession()` alone never authorize access. Cookies retain Supabase SSR-compatible JavaScript-readable behavior, SameSite=Lax and Secure on HTTPS. PostgreSQL rate limits work across function instances; Supabase Auth and hosting abuse controls still need operator configuration.

**Admin login does not protect public voice/session/search usage.** Those routes still need commercial authentication, quotas, rate limits and enforced session authorization. CORS, origin checks, prompt text and browser timers do not provide those controls.

## Retrieval and voice behavior

The server mints a 60-second Realtime client credential using server-held keys; browser audio goes directly to OpenAI. The configurable model defaults to `gpt-realtime`, voice to `marin`. VAD detects turns and interruptions, but automatic replies are disabled: after the opening greeting, replies require a non-empty transcription of the latest user turn. Tool results may continue that reply unless interrupted. Empty or failed transcriptions do not trigger replies. Microphone capture requests echo cancellation and noise suppression. No second answer-writing model is used.

`search_knowledge` forwards only a standalone query (1–1000 trimmed characters) to the fixed server wrapper. The request body is bounded to 4 KiB; wrapper search uses five results, eight seconds and a bounded response/passages. No tenant, URL or key is accepted from the browser. Empty evidence and unavailable retrieval are distinct safe results, without raw provider/database errors. A local laptop/Vercel service needs an authorized network path to a private wrapper; do not expose the private database.

Audio/transcripts are not persisted by this app. The UI retains up to 60 transcript items temporarily and labels transcription as imperfect. End/failure/unmount stops microphone tracks, closes WebRTC and aborts pending requests. Speaking over the agent uses the existing documented interruption configuration; real-device behavior remains a manual check.

Displayed retrieval time is measured server elapsed time, not speech latency or relevance. Manually measure speech-end to first useful audible answer, exclude filler, and report repeated measurements under comparable conditions. `/health` proves wrapper liveness and `/ready` database readiness, not vector provenance/relevance. Reported ingestion is `text-embedding-3-small`, 1536 dimensions and `embeddings_openai`; older 1024-dimension documentation, deployed code, database compatibility and retrieval quality remain unverified here.

## Verification

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:smoke
# Explicit disposable Supabase test only; see ADMIN_SETUP.md for opt-in variables:
npm run test:rls
```

The unit tests preserve voice/search regressions and mock authentication, settings, Dropbox, idempotency and routing. The HTTP smoke test exercises actual Next.js/Supabase SSR cookies against a local fake Supabase/SQL boundary; it makes no live provider calls. `test:rls` defaults to SKIP and is required to verify real policies in a disposable migrated Supabase/local project. Do not interpret mocks or a skipped integration test as live RLS proof. Full setup, rollback and manual acceptance are in [ADMIN_SETUP.md](ADMIN_SETUP.md), with the longer project reference in [va_documentation.md](va_documentation.md).

API audio/transcription, hosting/database, Dropbox capacity and networking can incur charges or limits. Check current provider plans/usage; no prices are assumed. End unused voice sessions and use account usage controls.

Official references: [Realtime browser flow](https://developers.openai.com/api/docs/guides/realtime-webrtc), [Realtime server controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Dropbox OAuth](https://developers.dropbox.com/oauth-guide), [Vercel function limits](https://vercel.com/docs/functions/limitations).
