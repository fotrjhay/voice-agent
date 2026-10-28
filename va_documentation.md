# Business voice assistant

## 1. Document scope

This document describes project version `0.1.0`.
It is for developers, operators, and testers.
The source review date is October 28, 2026.
The reviewed implementation includes commit `ea61da2`, which added hosted origin support.
This revision describes the local Supabase Auth/Postgres and Dropbox dashboard overhaul.
The admin implementation has not been deployed as part of this task.
The source repository is [fotrjhay/voice-agent](https://github.com/fotrjhay/voice-agent).
The hosted demonstration is [voice-agent-six-delta.vercel.app](https://voice-agent-six-delta.vercel.app/).

This document uses ASD-STE100 writing principles.
These include short sentences, active voice, and consistent technical terms.
Formal compliance with the full standard and its dictionary has not been verified.
See the [official ASD-STE100 website](https://asd-ste100.org/) for the standard.

Code names, file names, commands, and interface labels retain their exact spelling.

## 2. Purpose

The application lets a visitor speak with an AI assistant for one business.
The assistant can search business documents through a separate service.
The application is a demonstration.
It has one administrator, a settings dashboard, and Dropbox document upload/listing.
It has no public registration or document ingestion function.
See [ADMIN_SETUP.md](ADMIN_SETUP.md) for the complete provisioning and migration procedure.

The application uses Next.js, React, TypeScript, and OpenAI Realtime.
The browser sends audio directly to OpenAI through WebRTC.
The Next.js server keeps permanent API keys on the server.

### 2.1 Terms

| Term | Meaning in this document |
| --- | --- |
| Session | One voice connection between the browser and OpenAI. |
| Client credential | A temporary credential that lets the browser connect to OpenAI. |
| Knowledge search | A request for passages from business documents. |
| Wrapper | The separate service that receives knowledge search requests. |
| Passage | Text returned by the wrapper. |
| Origin | The protocol, host, and port of a web address. |
| Transcript | Text that represents speech in the conversation. |

## 3. System operation

1. The visitor selects **Start conversation**.
2. The browser requests microphone permission.
3. The browser sends a request to `POST /api/session`.
4. The server requests a client credential from OpenAI.
5. The browser uses the credential to establish a WebRTC connection.
6. OpenAI processes speech and returns assistant audio.
7. The browser shows transcript events from OpenAI.

For business questions, the assistant can call `search_knowledge`.
The browser sends the tool arguments to `POST /api/search`.
The server sends the query to the configured wrapper.
The browser returns the passages to the same Realtime session.
The assistant uses those passages to answer the question.

The application does not create embeddings or change retrieval/vector data.
Admin settings and rate-limit counters use a separate PostgreSQL schema.
It does not use a second model to write the answer.

## 4. Requirements

- Node.js 22.14 or a later Node.js 22 release, as specified in `README.md`.
- npm.
- A browser with microphone and WebRTC support.
- A microphone and an audio output device.
- An OpenAI API key with access to the configured Realtime model.
- Network access to OpenAI.
- Optional network access to an authorized wrapper.

Use headphones during voice tests to reduce echo.
Use localhost for local tests.
Use HTTPS for a hosted application that needs microphone access.

## 5. Install and start the application

Run these commands in PowerShell.

1. Open the project directory.

   ```powershell
   Set-Location C:\Software\voice_agent
   ```

2. Install the dependencies.

   ```powershell
   npm install
   ```

3. Create the local configuration file.

   ```powershell
   Copy-Item .env.example .env.local
   ```

   If `.env.local` already exists, edit that file instead.

4. Open the configuration file.

   ```powershell
   notepad .env.local
   ```

5. Set `OPENAI_API_KEY` to your permanent OpenAI API key.
6. Save the file.
7. Start the development server.

   ```powershell
   npm run dev
   ```

8. Open [http://localhost:3000](http://localhost:3000).

Leave both wrapper settings empty for a voice test without knowledge search.
Business answers then have no retrieved evidence.

**CAUTION:** Keep permanent API keys out of source control, prompts, screenshots, and browser code.

## 6. Configure the application

All listed settings are server environment variables.
Do not add the `NEXT_PUBLIC_` prefix.

| Variable | Function | Default or empty behavior |
| --- | --- | --- |
| `OPENAI_API_KEY` | Authenticates the server with OpenAI. | Session creation returns HTTP 503 if empty. |
| `APP_ORIGIN` | Permits one exact hosted HTTPS origin. | Uses the Vercel production origin when available; otherwise permits only local origins. |
| `OPENAI_REALTIME_MODEL` | Selects the Realtime model. | `gpt-realtime` |
| `OPENAI_REALTIME_VOICE` | Selects the assistant voice. | `marin` |
| `BUSINESS_NAME` | Sets the business identity and page label. | `Your business` |
| `AGENT_GREETING` | Sets the opening greeting. | `Hello! How can I help you today?` |
| `AGENT_INSTRUCTIONS` | Sets the business prompt. | A brief instruction for friendly, concise answers. |
| `RAG_WRAPPER_URL` | Sets the wrapper base URL. | Knowledge search returns `unavailable` if either wrapper setting is empty. |
| `RAG_WRAPPER_API_KEY` | Authenticates wrapper requests. | Required for knowledge search. |

### 6.1 Change the business prompt

After the first saved database configuration, use `/admin` to change the business name, greeting, tone, instructions, and public support contacts.
An authorized Save takes effect for new voice sessions without a restart or redeploy. Saves include an expected version; stale edits return HTTP 409.
Refresh the public page to update its business label.
Existing sessions retain their settings.

The following environment procedure sets defaults before the first save, or when no database is configured.
It does not overwrite an existing saved configuration.

1. Open `.env.local`.
2. Change `BUSINESS_NAME`, `AGENT_GREETING`, or `AGENT_INSTRUCTIONS`.
3. Save the file.
4. Stop the server with Ctrl+C.
5. Start the server again.
6. Refresh the page.
7. Start a new conversation.

Use quoted values for multiline instructions in `.env.local`.
Escape a literal dollar sign as `\$`.
Shell environment variables take precedence over values in `.env.local`.
Existing sessions keep their original instructions.
The server reads the business configuration for each new session credential request.
Prompt-only changes do not require source edits or a new local production build.
For local production use, restart `npm start` after changing the environment file.

The server appends `ASSISTANT_BASELINE` after the business prompt.
The baseline requires AI disclosure, privacy, supported answers, and truthful action reports.
The business prompt cannot add server tools.
Instructions can be visible to the connected client.
Do not put confidential information in them.

The optional database settings are `ADMIN_DATABASE_URL`, `ADMIN_DATABASE_TLS`, and `ADMIN_DATABASE_CA`.
Authentication uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, SSR cookies, verified user identity and database RLS membership. No Supabase privileged server key is required.
Admin membership is an explicit Supabase Auth UUID inserted by the operator; authenticated users are not automatically admins.
Tone defaults use `AGENT_TONE`; public support defaults use `SUPPORT_EMAIL`, `SUPPORT_PHONE`, and `SUPPORT_URL`.
All are server-side variables with examples in `.env.example`.

No database URL keeps environment-only voice mode and disables admin access.
A configured database with no saved row uses validated defaults until the first authenticated Save.
A configured but unavailable database returns explicit errors and does not silently fall back.
The app never runs migrations or seeds at startup.

### 6.2 Connect the wrapper

1. Set `RAG_WRAPPER_URL` to the wrapper base URL.
2. Omit the `/search` suffix.
3. Set `RAG_WRAPPER_API_KEY`.
4. Restart the server.
5. Start a new conversation.
6. Ask a question with a known answer in the business documents.
7. Compare the answer with the source document.

The Next.js server must be able to reach the wrapper.
A private hosting address can require access through the same private network.
The application does not accept or send a tenant parameter.

### 6.3 Configure a hosted application

Set `APP_ORIGIN` to the exact public HTTPS origin, such as `https://voice.example.com`.
Do not include a path, query, fragment, or wildcard.
On Vercel production, the code can use `VERCEL_PROJECT_PRODUCTION_URL` when `APP_ORIGIN` is empty.
This fallback requires `VERCEL_ENV=production`.
Preview origins are not permitted automatically.

Apply environment changes through the hosting service's deployment process.
Then refresh the page and start a new conversation.

The `dev` and `start` scripts listen on `127.0.0.1`.
A hosting service can require a different interface and port.
Configure these before deployment.
Use hosting access protection to restrict a private demonstration.

#### 6.3.1 Update configuration on Vercel

1. Open the voice app project in the Vercel dashboard.
2. Open **Settings → Environment Variables**.
3. Set the required server variables for the **Production** environment.
4. For this demonstration, the explicit origin value is `APP_ORIGIN=https://voice-agent-six-delta.vercel.app`.
5. If system environment variables are enabled, the production domain fallback can supply this origin instead.
6. Set `BUSINESS_NAME`, `AGENT_GREETING`, and `AGENT_INSTRUCTIONS` as needed.
7. Enter prompt values without surrounding `.env` quotes or the variable name prefix.
8. Keep `OPENAI_API_KEY` and `RAG_WRAPPER_API_KEY` in server environment settings.
9. Save the settings and create a new production deployment.
10. Wait for deployment to finish, refresh the page, and start a new conversation.

Environment changes do not update an existing Vercel deployment.
The first deployment of a code change must include the updated source.
Do not assume that a Git push deployed successfully; check the deployment status.
See [Vercel environment variables](https://vercel.com/docs/environment-variables) and [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

#### 6.3.2 Update configuration on Render

1. Open the voice app service in the Render dashboard.
2. Open **Environment**.
3. Set the same server variables and the exact Render HTTPS origin in `APP_ORIGIN`.
4. Enter prompt text without surrounding `.env` quotes or the variable name prefix.
5. Select **Save and deploy** for environment-only changes to an existing compatible build.
6. Select **Save, rebuild, and deploy** when the update also requires new source code or a build.
7. Wait for deployment to finish, refresh the page, and start a new conversation.

**Save only** stores the settings for a later deployment.
**Restart service** reuses the running deployment's configuration.
It does not apply newly saved environment values that have not been deployed.
See [Render environment variables](https://render.com/docs/configure-environment-variables) and [service restarts](https://render.com/docs/deploys#restarting-a-service).

## 7. Use the voice controls

1. Select **Start conversation**.
2. Permit microphone access when the browser asks.
3. Wait for the **Listening** status.
4. Speak your question.

The assistant is configured to respond after a pause in speech.
Speak while the assistant talks to interrupt its response.
Verify interruption on the target browser and device.

| Control | Result |
| --- | --- |
| **Mute microphone** | Disables the microphone audio tracks. |
| **Unmute microphone** | Enables the microphone audio tracks. |
| **End conversation** | Stops microphone tracks and closes the voice connection. |
| **Enable assistant audio** | Retries playback after the browser blocks audio. |
| **Clear transcript** | Removes the transcript from the displayed page state. |

The browser ends a connected session after ten minutes.
This timer is not a server access control or a billing limit.
Connection setup has a 35-second browser timeout.

## 8. API reference

Both public voice routes require matching Host and Origin headers.
They reject a mismatched `x-forwarded-host` header and a cross-site fetch indication.
Invalid origin configuration prevents access.
Responses include `Cache-Control: no-store`.

### 8.1 `POST /api/session`

The route uses server configuration.
It does not use request body fields to configure the session.

Successful response:

```json
{"value":"temporary-client-credential"}
```

The server requests a credential with a 60-second expiry from creation.
This expiry is separate from the connected session duration.
The server request has a 15-second timeout.

| HTTP status | Meaning |
| --- | --- |
| 200 | The route returned a client credential. |
| 403 | The origin check failed. |
| 502 | The provider request failed or returned an invalid credential response. |
| 503 | The permanent OpenAI API key is missing. |

The configured session uses audio output and `gpt-4o-mini-transcribe` input transcription.
Voice activity detection uses a 600-millisecond silence duration.
Automatic responses and speech interruption are enabled.
The maximum output token setting is 800.
The only configured tool is `search_knowledge`.

### 8.2 `POST /api/search`

Send `Content-Type: application/json`.
Send only the `query` field:

```json
{"query":"What are the business opening hours?"}
```

The route trims the query.
The query must contain 1 to 1,000 characters after trimming.
The maximum request body size is 4,096 bytes.
Extra fields cause HTTP 400.
An origin check failure causes HTTP 403.

A valid request returns HTTP 200 with a structured search result:

```json
{"status":"empty","passages":[],"retrieval_ms":12}
```

The timing in this example is illustrative.

| Search status | Meaning |
| --- | --- |
| `ok` | The wrapper returned at least one passage. |
| `empty` | The wrapper returned no passages. |
| `unavailable` | Configuration is missing, or the wrapper request failed. |

The `retrieval_ms` value measures server time for knowledge search.
It does not measure speech response time or answer quality.

### 8.3 Wrapper contract

The server appends `/search` to the configured base URL.
It sends a POST request with these fields:

```json
{"query":"What are the business opening hours?","limit":5}
```

The request includes the wrapper key in the `X-API-Key` header.
The wrapper must return a `results` array:

```json
{
  "results": [
    {
      "id": "passage-1",
      "text": "Business document text.",
      "source": {
        "source_id": "document-1",
        "source_name": "Business guide",
        "page_number": 2
      }
    }
  ]
}
```

Each result requires string values for `id` and `text`.
The `source` object and its fields can be absent or null.
Source identifiers and names must be strings when present.
Page numbers must be numbers when present.

| Limit | Value |
| --- | --- |
| Wrapper request timeout | 8 seconds |
| Wrapper response size | 256,000 bytes |
| Returned passages | 5 |
| Passage text length | 2,000 characters |
| Passage identifier length | 120 characters |
| Source identifier length | 120 characters |
| Source name length | 200 characters |

Provider errors, invalid responses, and network failures produce `unavailable`.
The route does not return raw provider error details.
Returned passages do not prove that an answer is relevant or correct.

## 9. Data and access limits

The application does not persist audio or transcripts.
The page keeps up to 60 transcript items in memory.
Each item has a maximum of 8,000 characters.
Clearing the transcript or reloading the page removes the displayed text.
Ending a conversation does not clear its displayed transcript.
Starting a new conversation clears the previous displayed transcript.

Audio and text go to OpenAI.
Retrieved passages also enter the Realtime conversation.
Local storage behavior does not establish provider retention behavior.
Application code does not log questions, passages, audio, or credentials.

### 9.1 Current logging and review features

Next.js and the hosting platform provide request and runtime logs.
These can help diagnose HTTP failures and server errors.
Their availability and retention depend on the local process or hosting configuration.
The application has no dedicated structured event logger or logging dashboard.
It does not save session events or tool-call history for later review.

The page displays the latest server-measured retrieval duration.
It does not persist that measurement or measure speech-end to the first useful spoken answer.
For manual latency tests, exclude filler speech and compare repeated questions under similar conditions.

There is no stored conversation history, business insights report, or automated improvement process.
The displayed transcript is temporary page state only.

### 9.2 Conversation storage discussed for future work

Conversation recording and TimescaleDB-specific analytics have been discussed but are not implemented.
The app now supports PostgreSQL for business settings and admin rate limits only.
There are no conversation tables or conversation-storage endpoints.
The operator may choose a separate schema in an existing PostgreSQL/TimescaleDB instance or a dedicated reachable database.
The supplied migration does not alter retrieval/vector tables or ingestion data.

A possible design uses regular PostgreSQL tables within TimescaleDB for conversations, messages, business identifiers, and reviewer feedback.
Timestamped tool events and latency measurements could use hypertables when the data volume justifies them.
Keep conversation records in a separate schema with separate permissions from retrieval documents and vectors.
If audio storage is added, object storage can hold the files and the database can hold their references.
These are design options, not active features or a verified database deployment.

Before implementation, define customer notice, consent requirements, personal-data handling, access permissions, and retention and deletion rules.
Insights require reports, queries, or a separate analysis step.
Reviewed findings can inform knowledge documents, prompts, and evaluation tests.
Saving conversations does not automatically train or update the assistant.

### 9.3 Access and model limits

The browser can inspect the client credential, instructions, tool arguments, and passages.
A modified browser client can change Realtime session configuration.
The application baseline is an instruction to the model, not an enforceable authorization system.

The origin check does not authenticate users.
Admin operations require a server-verified Supabase user, explicit UUID membership/RLS and distributed PostgreSQL rate limits.
Admin mutations also require a matching origin.
Public voice routes have no application authentication, quotas, rate limits, or server-enforced session duration.
The admin login does not protect those public routes.
Add those controls before commercial or multi-business use.
The assistant has no implemented tool for bookings, payments, messages, or record changes.

## 10. Project files

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Reads the business name and renders the voice interface. |
| `app/voice.tsx` | Controls microphone access, WebRTC, tool calls, and transcripts. |
| `app/layout.tsx` | Defines the page layout and metadata. |
| `app/globals.css` | Defines the interface styles. |
| `app/api/session/route.ts` | Creates client credentials. |
| `app/api/search/route.ts` | Validates and forwards knowledge queries. |
| `lib/server.ts` | Defines origin checks, input limits, search, and session settings. |
| `lib/assistant-instructions.ts` | Combines the business prompt with the application baseline. |
| `lib/cleanup.ts` | Stops media tracks, closes connections, and cancels requests. |
| `tests/server.test.ts` | Tests server behavior and resource cleanup with mocks. |
| `.env.example` | Provides example environment settings. |
| `README.md` | Provides setup notes and previous verification records. |
| `ADMIN_SETUP.md` | Provides Supabase provisioning, Dropbox setup, migration/rollback, limits and manual checks. |
| `app/admin/` | Provides sign-in and the authenticated settings/document dashboard. |
| `app/api/admin/` | Provides independently authorized settings and document endpoints. |
| `app/api/auth/[action]/route.ts` | Runs Supabase password login, sign-out, recovery, confirmation and reset endpoints. |
| `lib/auth.ts`, `lib/supabase/` | Verify Supabase identity, current membership and SSR cookies. |
| `lib/settings.ts`, `lib/settings-schema.ts` | Read, validate and save business settings. |
| `lib/db.ts`, `lib/rate-limit.ts` | Use a verified-TLS scoped database connection and distributed limits. |
| `lib/storage.ts`, `lib/documents.ts`, `lib/upload-validation.ts` | Validate documents and manage Dropbox refresh, listing, durable IDs and idempotent uploads. |
| `migrations/001_admin.up.sql`, `migrations/001_admin.down.sql` | Supply reviewed schema changes and rollback; never run automatically. |
| `tests/runtime-smoke.mjs` | Tests Supabase SSR HTTP/cookie behavior against local fake Auth/SQL services. |

## 11. Verify the application

Run these checks from the project directory:

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
```

For a local production check, run:

```powershell
npm start
```

The tests use mocked services.
They cover origin checks, query validation, search limits, error handling, prompt assembly, and cleanup.
They do not establish live audio quality or wrapper relevance.
This document does not report a new live service test.

### 11.1 Recorded hosted-origin verification (before admin)

The following checks passed on October 27, 2026, for the hosted origin fix in commit `ea61da2`:

| Check | Recorded result |
| --- | --- |
| `npm run test` | All 33 mocked tests passed. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed without warnings. |
| `npm run build` | Passed. |
| Local production origin check | A request with the Vercel production Host and Origin reached query validation and returned HTTP 400 for an empty JSON object. An unrelated Origin returned HTTP 403. |
| Hosted origin check | The live Vercel `POST /api/search` route returned HTTP 400 for an empty JSON object sent with the matching Origin. |

The hosted HTTP 400 result confirms that the request passed the origin guard and reached input validation.
The invalid query did not call OpenAI or the wrapper.
It does not prove that a voice session or retrieval request succeeded.
Live microphone behavior, speech playback, interruption, and real retrieval quality remain unverified by these checks.
Database vector dimensions, ingestion provenance, and embedding compatibility also remain unverified.
This documentation update did not rerun the application tests or perform a new deployment check.

The preceding records refer to the hosted origin fix before the admin implementation.
The admin verification record is in [ADMIN_SETUP.md](ADMIN_SETUP.md).
The earlier implementation used NextAuth; the current HTTP smoke test uses Supabase SSR cookies and local fake services.
It makes no external provider calls or live database changes.

### 11.2 Admin verification

The current overhaul passed all 113 mocked tests, type checking, lint, and the production build.
The additional `npm run test:smoke` check passed with real Next.js/Supabase SSR HTTP handling and local fake Auth/SQL services.
It verified protected routes, saved settings reads/writes, optimistic concurrency, host/origin checks, SSR cookies, sign-out cookie clearing, and revoked-session denial.
The browser-bundle scan found no permanent credential references.
The opt-in real RLS test reported SKIP because no disposable Supabase test database was configured.
No live authorization, PostgreSQL migration, Dropbox upload, n8n change, or Vercel deployment was performed.
See [ADMIN_SETUP.md](ADMIN_SETUP.md) for the recorded checks and remaining manual setup.

### 11.3 Manual checks

1. Start a conversation without wrapper configuration.
2. Confirm that audio and captions work.
3. Confirm that the assistant identifies itself as AI.
4. Ask a business question and check that the assistant reports missing evidence.
5. Mute the microphone and check that speech is not transmitted.
6. Unmute the microphone.
7. Interrupt an assistant response with speech.
8. End the conversation and check that the microphone indicator stops.
9. Deny microphone permission and check the error message.
10. Cancel connection setup while microphone permission is pending.
11. Grant the pending permission and check that microphone tracks stop.
12. Configure an authorized wrapper and ask a question with a known answer.
13. Compare the returned answer with the source document.
14. Ask a follow-up question and check that the search includes its context.
15. Disconnect the wrapper and check that the assistant does not invent an answer.
16. Check the controls with the keyboard and a screen reader.

Inspect browser responses for accidental permanent key exposure.
Do not share captures that contain client credentials or business passages.

## 12. Troubleshooting

| Problem | Action |
| --- | --- |
| Microphone permission was denied. | Permit microphone access in the browser, then start again. |
| No microphone was found. | Connect a microphone, then start again. |
| The microphone is unavailable. | Close other applications that use the microphone, then retry. |
| Assistant audio is blocked. | Select **Enable assistant audio**. |
| The origin check fails. | Compare the page origin with `APP_ORIGIN` and the request Host header. |
| The page shows “Local same-origin access required.” | This message is from the older localhost-only guard. Deploy commit `ea61da2` or later. Set the exact hosted origin or enable the Vercel production-domain fallback, then refresh the page. |
| Session creation returns HTTP 503. | Set `OPENAI_API_KEY` on the server and restart it. |
| Session creation returns HTTP 502. | Check model access, server configuration, and network access. |
| Search returns `unavailable`. | Check both wrapper settings and server access to the wrapper. |
| Search returns `empty`. | Check that the business documents contain relevant information. |
| The business prompt did not change. | Restart or redeploy the server, then start a new conversation. |
| The voice connection closes. | Check the network, then start a new conversation. |
| Conversation history or structured events are missing. | These features are not implemented. The visible transcript is temporary, and platform logs do not provide a saved conversation review system. |

End unused conversations.
API use and wrapper operation can incur charges.
Use provider account controls to manage spending.

## 13. Current admin dashboard: Supabase and Dropbox

The active dashboard has two functions: assistant settings and Dropbox document upload/listing.
GitHub OAuth and Google Drive dependencies/routes are removed from active use.
Repository/GitHub deployment integration remains unchanged.
Old Drive files are not moved, deleted or relabeled as Dropbox files.
No conversation recording, analytics, billing or ingestion pipeline was added.

Supabase email/password sign-in uses maintained JS/SSR packages.
The operator must disable public sign-ups in the project, provision an Auth user, and explicitly insert its verified UUID into admin_members.
Matching an old GitHub account email does not transfer privileges.
Every sensitive route checks server-verified getUser() identity and current membership.
Ordinary users cannot grant themselves membership; settings use user-scoped RLS writes.
Recovery/invite links are verified server-side for expiry/one-time use and membership.
Tokens arrive in browser fragments and are POSTed to confirmation, not placed in server URL queries.
See ADMIN_SETUP.md for the required email templates and safe redirect allowlists.

Cookies remain compatible with Supabase SSR: host-only, SameSite=Lax and Secure on HTTPS.
This flow does not claim HTTP-only cookies.
The Next.js proxy refreshes validated sessions and marks auth responses private/no-store.
The current app no longer imposes the old NextAuth one-hour hard expiry; configure Supabase session/JWT and recovery policy.
Sign-out clears SSR cookies and requests provider global sign-out.

The existing fixed single-business settings record is reused.
Migration 002 adds a version, explicit membership, RLS and document receipts without overwriting saved settings.
A stale settings save returns HTTP 409; reload and review before retrying.
The public reader uses only a scoped server SQL connection, not an anonymous settings policy or browser service-role key.
New sessions read saved settings immediately, while existing sessions keep their initial configuration.
The application baseline, tools, model/voice and VAD behavior are preserved.

Dropbox uses one operator-authorized Scoped Access App Folder account.
Secrets are DROPBOX_APP_KEY, DROPBOX_APP_SECRET and an offline DROPBOX_REFRESH_TOKEN.
DROPBOX_UPLOAD_FOLDER is relative to that app namespace, for example /documents.
Access tokens are refreshed in process memory; no environment/file rewrite occurs at runtime.
The operator-only loopback authorization helper validates OAuth state and stores its result in an ignored local file.
No public token/setup endpoint or per-admin Dropbox connection exists.

The hard upload ceiling remains 3 MiB, below Vercel's request cap.
DOCUMENT_MAX_UPLOAD_BYTES may lower it.
The server validates normalized names, type/content and actual streamed bytes.
A durable reservation maps the verified user's upload key to a server document UUID and fixed path.
Retries verify Dropbox content hashes; add/no-autorename/conflict handling avoids duplicates and silent overwrites.
Different selected files may share a display name without being deduplicated by name.
Receipts preserve provider label, original display name, Dropbox file ID/revision and stable source/business IDs.
Pagination shows actual files in the configured folder and separates listing errors from upload success.
The success label is Uploaded to Dropbox; search availability is not yet tracked.

n8n is unchanged and no webhook is active.
It must access the same Dropbox App Folder namespace, not merely the same account through another folder app.
Retain source_id = BUSINESS_ID:document_id across revisions; a revision is not a new logical source.
The proposed handoff contract and read-scope setup are documented in ADMIN_SETUP.md.

VOICE_APP_ORIGIN and ADMIN_APP_ORIGIN are exact server-configured origins.
The admin host root renders the same protected admin component without external rewrites or prefix loops.
/admin still works locally and on the current domain.
Each host calls same-origin backend routes; cookies are not shared across subdomains.
Unknown application hosts and cross-origin mutations are rejected.
Use actual DNS targets from Vercel's project Domains screen.

Admin limits are shared PostgreSQL buckets: auth 30/minute, reads 60, writes 20 and uploads 10.
Sign-out is exempt from the database limiter but still checks origin.
Supabase provider rate limits and hosting abuse controls are separate operator requirements.
Public voice routes are not protected by admin login and still need commercial authentication/quotas.

Review 001 (if absent) and 002 migrations explicitly; startup/build never applies them.
The 002 rollback preserves saved settings but removes new membership/receipt metadata, so export it first.
No live migration, OAuth grant, Dropbox upload, n8n change or deployment was performed during implementation.
Use npm run test:rls only with the explicit disposable-Supabase opt-in to verify real policy behavior.
Mock tests and local fake-service HTTP tests do not prove live policies, email delivery, Dropbox, domains or microphone behavior.
See [ADMIN_SETUP.md](ADMIN_SETUP.md) for ordered setup, permissions, rollback and manual acceptance.
