# Business voice assistant — implementation reference

## 1. Scope and deployment status

This reference describes the backend-selector implementation reviewed on November 5, 2026. The website source is [fotrjhay/voice-agent](https://github.com/fotrjhay/voice-agent); the independently deployed Python service is [fotrjhay/call_agent](https://github.com/fotrjhay/call_agent).

`VOICE_BACKEND=pipecat` is the source default and was selected locally. `VOICE_BACKEND=openai_direct` retains the original browser agent for rollback. This describes implemented code, not proof of a live cutover. At the last recorded check, the Render token authenticated, but the deployed service did not yet report the settings-handoff version. The companion service and website updates were published for review; production website switching and dashboard handoff still needed deployment and manual verification.

The operator reported the standalone Render browser agent working on Wi-Fi and mobile data, and inbound Twilio working. Those checks do not establish that the existing website has been switched. No deployment, credential change or live voice test is performed by editing these documents.

Use [README.md](README.md) for entry-point setup, [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md) for voice rollout/rollback, [ADMIN_SETUP.md](ADMIN_SETUP.md) for Supabase/Dropbox provisioning, and [HOSTED_DIAGNOSTICS.md](HOSTED_DIAGNOSTICS.md) for protected testing.

## 2. Architecture

The Next.js/React/TypeScript website provides one voice interface and an admin dashboard. The dashboard uses Supabase Auth/Postgres for verified admin membership and saved settings, plus Dropbox App Folder storage for document upload/listing. Uploading is not ingestion or evidence of search availability. The app does not create embeddings, connect to the private knowledge database, or invoke n8n.

| Responsibility | `pipecat` | `openai_direct` |
| --- | --- | --- |
| Audio connection | Browser ↔ TURN ↔ Pipecat on Render ↔ OpenAI Realtime | Browser ↔ OpenAI Realtime |
| Website session route | Proxies authenticated ICE configuration | Mints a temporary OpenAI client credential |
| SDP exchange | Same-origin website `/api/offer` proxies to Pipecat | Browser calls OpenAI's Realtime calls endpoint |
| Greeting and responses | Pipecat greeting; native Realtime turn/tool handling | Browser greeting and transcription-triggered turn controller |
| Retrieval | Python async `search_knowledge` calls rag-wrapper | Browser calls website `/api/search`; Next.js calls rag-wrapper |
| Business settings snapshot | Website compiles and sends it with the offer | Website compiles it into the client-secret request |
| Captions | Assistant only, when available | User and assistant |
| Input transcription | Disabled | `gpt-4o-mini-transcribe`; separate transcription usage can apply |

The browser does not generate responses or execute retrieval in Pipecat mode. The existing direct turn controller is used only in direct mode. Neither mode uses a second answer-writing model. Backend selection affects new browser sessions, not phone provider selection or existing phone configuration.

## 3. Local setup and configuration

Use Node.js 22.14 or later in the Node.js 22 line, npm, and a microphone/WebRTC-capable browser. Hosted microphone access requires HTTPS; localhost works for development.

```powershell
Set-Location C:\Software\voice_agent
npm install
# Only when absent; otherwise edit the existing file.
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

Open http://localhost:3000. Keep secrets out of Git, prompts, screenshots and client bundles. Except the Supabase public project identifiers, the variables below are server-only and must not use `NEXT_PUBLIC_`.

| Website variable | Purpose / behavior |
| --- | --- |
| `VOICE_BACKEND` | `pipecat` by default, or `openai_direct`; other values return an error |
| `PIPECAT_SERVICE_URL` | Required for Pipecat: HTTPS origin with no credentials, path, query or fragment; loopback HTTP permitted only outside production |
| `PIPECAT_SERVICE_TOKEN` | Required for Pipecat: same secret as Render `BROWSER_TOKEN`; never returned to visitors |
| `OPENAI_API_KEY` | Required on the website for direct mode, not Pipecat mode |
| `OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_VOICE` | Website direct-mode model/voice, defaults `gpt-realtime` / `marin` |
| `RAG_WRAPPER_URL` / `RAG_WRAPPER_API_KEY` | Website direct/legacy search configuration; missing values yield unavailable retrieval |
| `VOICE_APP_ORIGIN` / `ADMIN_APP_ORIGIN` | Exact public voice/admin origins; existing `APP_ORIGIN` and Vercel production-domain fallback remain supported |
| `VOICE_DIAGNOSTICS_ENABLED` | Exactly `true` enables the protected, opted-in admin test |
| `BUSINESS_NAME`, `AGENT_GREETING`, `AGENT_TONE`, `AGENT_INSTRUCTIONS`, `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_URL` | Initial settings before the first saved row or when no database is configured |
| `ADMIN_DATABASE_URL`, `ADMIN_DATABASE_TLS`, `ADMIN_DATABASE_CA` | Scoped settings/receipt reader and rate-limit connection; see admin guide |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public Supabase project identifiers for authentication |
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `DROPBOX_UPLOAD_FOLDER`, `DOCUMENT_MAX_UPLOAD_BYTES`, `BUSINESS_ID` | Existing document-storage configuration; see admin guide |

The independent Python service has its own environment. Its `OPENAI_REALTIME_MODEL` defaults to `gpt-realtime-2.1-mini`; its voice variable is `OPENAI_VOICE` (not the website's `OPENAI_REALTIME_VOICE`). It owns its OpenAI/wrapper credentials, result limits, VAD and session limits. Do not copy the website environment file into that service. Account/model availability must be checked separately.

Next.js loads `.env.local` and the other supported environment files; process environment takes precedence. Restart/redeploy after changing the backend, service connection or environment defaults. On Vercel, select the intended environment and create a new deployment; editing a variable does not modify an already deployed version. Preview origins require explicit configuration.

## 4. Dashboard settings and precedence

After the first authorized database save, use `/admin` for business name, greeting, supported tone, instructions and support contacts. Saves require an expected version; stale edits return HTTP 409. Refresh the public page to update its label. A new connection loads the current settings; existing connections retain their snapshot.

No configured database means environment defaults for voice and closed admin access. A configured database with no row uses defaults until the first save. A configured but unavailable/invalid database returns an error instead of silently falling back. Startup does not run SQL migrations or seed data.

`assistantInstructions()` composes business settings followed by `ASSISTANT_BASELINE`. The baseline covers AI disclosure, privacy, supported facts, retrieved-data boundaries and truthful action reports. Prompts cannot grant tools or select a tenant. In Pipecat mode, the authenticated website supplies validated instructions and greeting for that browser connection, overriding only the service's local prompt/greeting for that connection. Phone calls and standalone tests without a snapshot retain service configuration.

Direct clients can inspect/change their Realtime conversation configuration and see tool passages. Pipecat visitors receive captions/activity and temporary relay credentials, not the service token, prompt or raw passages through this integration. Anyone given the service's shared browser token is a trusted service caller. In both modes prompt wording is behavioral guidance, not authorization.

## 5. Production deployment and rollback

Keep the website/dashboard on Vercel and the persistent Python service on Render. Follow [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md) in order:

1. Deploy the companion Pipecat update. `/ready` must report `settings_handoff_version: 1`.
2. Keep the working Render browser relay settings and `BROWSER_TOKEN`. Configure the website's `PIPECAT_SERVICE_URL`, matching `PIPECAT_SERVICE_TOKEN`, and `VOICE_BACKEND=pipecat` on Vercel.
3. Deploy the website update. Verify the protected admin test and public interface on Wi-Fi and mobile data, including a new dashboard greeting.
4. For browser rollback, set `VOICE_BACKEND=openai_direct` and redeploy the website with its OpenAI/retrieval variables present. No database rollback or phone change is required.

Pipecat failures do not automatically create a direct OpenAI session. An old handoff protocol or missing acknowledgement is an error. Render restarts/deployments can interrupt calls. Free-instance cold starts can delay setup. Free Render instances have no Shell: verify the test page, selected relay route and logs instead; a shell probe is optional when the plan supports it.

For public browser audio the service uses short-lived Twilio TURN credentials on both peers, with TCP port 443 first. The website keeps the permanent service token server-side. The standalone test page accepts that shared token only for trusted testing; the public website does not ask visitors for it. Phone media uses its existing WebSocket transport and does not need this browser TURN path.

## 6. Browser controls and lifecycle

| Control | Result |
| --- | --- |
| Start conversation | Prepares the selected backend, requests the microphone and establishes audio |
| Mute / unmute | Disables / enables microphone tracks |
| End conversation | Aborts requests, stops media/metering and closes channel/peer |
| Enable assistant audio | Retries blocked playback |
| Clear transcript | Clears the displayed in-memory captions/transcript |

Both modes request echo cancellation and noise suppression. Setup has a 90-second browser deadline. The connected browser timer ends the session after ten minutes. Pipecat also enforces its configured server duration (default 600 seconds), inactivity (60) and concurrency (4); direct mode's browser timer is not a server-enforced spending limit. Real interruption, playback and device behavior require manual checks.

The page retains up to 60 items with 8,000 characters per item. End does not clear them; clear/reload or a new conversation does. Pipecat shows assistant captions only; it does not transcribe the visitor. No application audio/transcript history is persisted.

## 7. Website API reference

All public POST voice routes require exact same-origin Host/Origin checks and reject conflicting forwarded hosts/cross-site indications. This is not user authentication. Success/error responses use `Cache-Control: private, no-store`. Public session/offer routes reject the diagnostics opt-in header.

### `POST /api/session`

Backend selection comes from the server; request-body fields cannot override it.

Pipecat response:

```json
{"backend":"pipecat","rtcConfig":{"iceServers":[{"urls":"turn:relay.example:443?transport=tcp","username":"temporary","credential":"temporary"}],"iceTransportPolicy":"relay"}}
```

The example credentials are placeholders. The server authenticates to service `/api/ice` and requires handoff version 1. Only temporary ICE configuration is public; safe configuration reports are added only for an authorized diagnostics request. Upstream calls have a 45-second deadline and reject redirects.

Direct response:

```json
{"value":"temporary-client-credential"}
```

The website requests a 60-second client-credential expiry and uses a 15-second upstream deadline. That expiry is not the connected session duration. Direct configuration uses server VAD with 600 ms silence, `create_response: false`, `interrupt_response: true`, and 800 output tokens per response. The browser's direct turn controller requests responses after nonempty current-turn transcriptions.

### `POST /api/offer`

Pipecat only. Send `Content-Type: application/json` and exactly:

```json
{"type":"offer","sdp":"browser SDP"}
```

The request body is limited to 40,000 bytes and SDP to 32,000 characters. Extra settings/backend/tool fields are rejected. The server loads business settings, adds the baseline and greeting, forwards them with SDP, and requires `settings_applied: true`. Visitors receive only `{"type":"answer","sdp":"answer SDP"}`. Direct mode returns HTTP 409 for this route, so clients restart after a backend change.

### `POST /api/search`

This remains the direct/legacy retrieval route, even when Pipecat is selected; the Pipecat browser path never invokes it. Send only `{"query":"A standalone business question"}`. The query is trimmed and limited to 1–1000 characters; the body is limited to 4096 bytes. Extra fields are rejected. Successful HTTP responses contain `status`, `passages` and `retrieval_ms`; `ok`, `empty` and `unavailable` are distinct retrieval outcomes.

### Protected admin equivalents

`/api/admin/voice/session`, `/api/admin/voice/offer` and `/api/admin/voice/search` independently require the server feature flag, explicit diagnostics opt-in, verified Supabase identity/current membership, origin checks and shared admin-read rate limits. Pipecat uses session/offer; direct mode uses session/search. See [HOSTED_DIAGNOSTICS.md](HOSTED_DIAGNOSTICS.md).

### Errors

| Status | Meaning |
| --- | --- |
| 400 | Invalid website offer/search body or missing admin opt-in |
| 401 / 403 / 404 | Admin access, origin or feature checks rejected the request |
| 409 | Offer received after the website selected direct mode; restart |
| 429 | Request limit reached; wait one minute |
| 502 | Direct OpenAI request/credential failure |
| 503 | Missing/invalid backend configuration, unavailable service/settings, incompatible handoff, malformed provider response or capacity issue |

Raw provider errors, permanent credentials and database details are not returned.

## 8. Retrieval contract and limits

The relevant server POSTs `{query, limit}` to `{RAG_WRAPPER_URL}/search` with `X-API-Key`. The wrapper selects its tenant through server configuration. There is no caller-supplied tenant or direct database connection.

```json
{"results":[{"id":"passage-1","text":"Business document text.","source":{"source_id":"document-1","source_name":"Business guide","page_number":2}}]}
```

Each result requires string ID/text. Source can be absent/null; object source fields are optional/null. The Python client additionally accepts a string source reference. No response distance score proves relevance.

| Limit | Pipecat service defaults | Direct/legacy Next.js route |
| --- | --- | --- |
| Results | Configurable, default 3 | 5 |
| Timeout | Configurable, default 8 seconds | 8 seconds |
| Response bytes | 256,000 | 256,000 |
| Individual passage text | Configurable, default 2,000 characters | 2,000 characters |
| Total passage text | Configurable, default 6,000 characters | At most five bounded passages |
| Source strings | At most 200 characters each | Source ID 120 / name 200 characters |
| Browser receives raw passages | No | Yes, for the tool result |

Pipecat uses a reusable async HTTP client, bounds queries/text, cancels obsolete tool work and keeps a bounded session query cache. Neither path retries indefinitely. Upstream authentication, validation, embedding/database/network/timeouts yield safe unavailable outcomes; empty results remain distinct. Configure wrapper reachability on Render for Pipecat and on the website for direct mode. Do not expose the private knowledge database.

## 9. Privacy, diagnostics and operational limits

The app does not record audio or persist transcripts. Provider processing/retention is separate. No conversation tables, TimescaleDB conversation analytics, automatic learning, recording, account actions, bookings, payments, transfers or n8n tools are implemented.

Pipecat operational logs include safe session/transport/model/duration/error metadata, tool latency/count/outcome and provider-reported usage when available. They exclude prompts, audio, transcripts, passages and credentials by default. Website admin diagnostics remain in page memory until explicitly downloaded. Pipecat browser summaries mark unreported response/user-turn counts as null and do not invent usage; direct summaries can contain numeric provider response usage. Neither estimates costs. A deployment/platform logger can have its own retention; the app has no conversation-review database.

Admin login protects admin APIs, not public voice. Origin checks and the hidden service token do not identify customers. Pipecat has per-process concurrency and token-issuance limits, not per-customer quotas or cross-replica coordination. Direct public routes do not provide equivalent server session admission. Additional commercial authentication/quotas are required before treating either as a multi-customer product.

Hosting, OpenAI usage, optional direct-mode input transcription, TURN bandwidth, database/Dropbox resources, phone rental and call minutes are separate costs. Switching browser backends does not stop the other hosted service or release its resources.

## 10. File map

| Path | Responsibility |
| --- | --- |
| `app/page.tsx`, `app/voice.tsx` | Saved page label, shared controls and selected browser transport |
| `lib/voice-backend.ts` | Server-only backend validation/default |
| `lib/voice-session.ts`, `lib/pipecat.ts` | Backend session routing and authenticated Pipecat settings/signaling proxy |
| `lib/pipecat-client.ts` | Bounded activity/caption/tool messages and cancellable ICE gathering |
| `lib/voice-turns.ts` | Direct-mode response controller only |
| `lib/server.ts`, `lib/assistant-instructions.ts` | Direct search/session configuration and business baseline assembly |
| `lib/cleanup.ts`, `lib/voice-diagnostics.ts` | Browser cleanup and privacy-filtered backend-aware diagnostics |
| `app/api/session/`, `app/api/offer/`, `app/api/search/` | Same-origin public endpoints |
| `app/admin/`, `app/api/admin/`, `app/api/auth/` | Protected dashboard, diagnostics and Supabase auth flows |
| `lib/settings*`, `lib/db.ts`, `lib/rate-limit.ts`, `lib/supabase/` | Saved settings, scoped database, rates and identity |
| `lib/storage.ts`, `lib/documents.ts`, `lib/upload-validation.ts` | Dropbox/idempotent document operations |
| `migrations/` | Operator-reviewed admin schema changes; never run on startup |
| `tests/`, `tests/runtime-smoke.mjs`, `tests/smoke-preload.cjs` | Mocked unit/UI and production HTTP checks; preloader is test-only |
| `.env.example`, `PIPECAT_MIGRATION.md`, `ADMIN_SETUP.md`, `HOSTED_DIAGNOSTICS.md` | Configuration and operator procedures |

The separate `call_agent/` checkout has its own repository and tests. It is excluded from the website Git/build-tool discovery and must be deployed separately.

## 11. Verification and troubleshooting

```powershell
npm test
npm run typecheck
npm run lint
npm run build
node tests/runtime-smoke.mjs
node tests/runtime-smoke.mjs --pipecat
# Only against an explicitly configured disposable database:
npm run test:rls
```

The last implementation run passed 167 Vitest tests, type checking, lint, production build and HTTP smoke tests for both modes. The companion release passed 42 Python tests; the copied service with the pre-existing Telnyx extension passed 52. These are recorded mocked checks, not a new test run by this documentation edit. Browser bundles were scanned for configured secrets. No live SQL policy proof or production website cutover follows from those results.

The October 28 admin record remains in [ADMIN_SETUP.md](ADMIN_SETUP.md). The October 29 direct-turn audit remains in [TURN_USAGE_AUDIT.md](TURN_USAGE_AUDIT.md). Those historical counts/configurations are not current Pipecat behavior.

For manual acceptance, start a new conversation on Wi-Fi and mobile data, verify a single greeting, knowledge/follow-up/unsupported/failure answers, interrupt speech and pending retrieval, test mute/end/restart and microphone release, and verify a changed dashboard greeting in a fresh session. Check captions appropriate to the backend. Test denied microphone access and cancellation during permission/setup. Do not post captures containing secrets, direct-mode passages or user speech.

| Problem | Check |
| --- | --- |
| Pipecat startup returns 503 | Website URL/token, Render browser enabled/relay settings, capacity and service availability |
| Token works but website reports integration failure | Deploy handoff version 1; verify service `/ready` and offer acknowledgement |
| No Render Shell | Use the standalone authenticated page and logs; look for a selected relay route and working two-way audio |
| Direct session fails | Explicit `openai_direct`, website OpenAI key/model and network access |
| Wrong/missing business greeting | Saved settings row, database availability and a fresh connection; Pipecat handoff must be deployed |
| Retrieval unavailable | Wrapper credentials/reachability on the server that owns the selected path |
| Origin/auth rejected | Exact existing voice/admin origins, feature opt-in and current verified admin membership |
| No user captions in Pipecat | Expected: input transcription is disabled |
| No Pipecat provider usage in browser download | Expected: inspect safe service logs; missing data is unknown |
| Microphone/audio failure | Browser permissions, connected device, playback control and network/relay access |

Changing voice backend does not require a Supabase migration, auth-provider change, Dropbox reauthorization, new phone webhook, or database/vector/ingestion modification.
