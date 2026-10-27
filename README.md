# Business voice assistant

A local, single-business Next.js App Router / TypeScript demonstration. Browser audio goes directly to OpenAI Realtime through WebRTC. The server mints a 60-second client credential and privately calls the existing rag-wrapper. It never embeds a question or changes ingestion, vectors, or the database.

## Windows PowerShell setup

Use Node.js 22 LTS (22.14 or newer) and npm. From this directory:

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `OPENAI_API_KEY` locally; never paste secrets into chat. Leave both RAG settings blank for a voice-only smoke test. Set the business name, greeting, instructions, voice and model in `.env.local`, then restart the server. All settings are server-only; none use `NEXT_PUBLIC_`. The business name and agent instructions are visible conversation configuration, so do not put secrets in them. A short-lived credential is intentionally visible to the browser. The permanent key and wrapper key must never appear there.

`OPENAI_REALTIME_MODEL` defaults to `gpt-realtime`, verified against the official GA client-secret reference during implementation on October 27, 2026. Account access must still be tested. `OPENAI_REALTIME_VOICE` defaults to `marin`. Input captions use `gpt-4o-mini-transcribe`; assistant captions come from the audio transcript events. Transcription can be wrong. Voice activity detection automatically responds after speech and interrupts model speech when the user speaks. Browser playback and interruption require real-device testing.

The local development and production scripts bind to `127.0.0.1`. Localhost is a browser secure-context exception for microphone access; a hosted browser deployment requires HTTPS. Hosted demos must configure their exact origin as described below and restrict access at the hosting layer; origin checks alone do not authenticate users.

For retrieval, configure the base `RAG_WRAPPER_URL` (without `/search`) and `RAG_WRAPPER_API_KEY`. The Next server must reach that address. A private Render address generally cannot be reached from a laptop: use an authorized private-network deployment or an explicitly configured protected route. Do not expose the private database. No tenant parameter is accepted or sent.

## Updating the assistant instructions

The server reads these values whenever `POST /api/session` creates a new Realtime client credential; they are not compiled into the browser bundle or accepted from the request body:

| Environment variable | Purpose |
| --- | --- |
| `BUSINESS_NAME` | Business identity, also shown on the server-rendered page |
| `AGENT_GREETING` | Opening greeting (the assistant also identifies itself as AI) |
| `AGENT_INSTRUCTIONS` | Full business assistant prompt: role, tone, language, scope and conversation rules |

Use the quoted, multiline example in `.env.example` as a starting point. `AGENT_INSTRUCTIONS` replaces the default business prompt; it does not replace the application baseline. Missing or empty values fall back to a generic business name, greeting and concise conversational style. Do not put credentials or confidential internal information in any prompt: Realtime instructions can be visible to the connected client. The OpenAI and wrapper API keys remain separate server-only credentials.

Locally, edit `.env.local` with `notepad .env.local`, then stop the Next process with Ctrl+C and run `npm run dev` again. For a local production build, stop and restart `npm start`; prompt-only changes need no `npm run build`. Refresh the page to update its business label, and end/start the conversation to create a session with the new prompt. Existing Realtime sessions keep their original instructions. Next loads environment files at process startup; shell environment variables take precedence over `.env.local`. Quoted multiline values work in `.env.local`; escape a literal dollar sign as `\$` because Next expands `$VARIABLE` references in environment files. See [Next.js environment variable guidance](https://nextjs.org/docs/app/guides/environment-variables).

On Render, open the **voice app service** → **Environment**, and set or edit the same three keys. Enter the instruction text as the value (including real line breaks if needed), without the `.env` surrounding quotes or `AGENT_INSTRUCTIONS=` prefix. Choose **Save and deploy** to redeploy the existing build with the new runtime values; prompt-only changes do not require a rebuild or source commit. **Save, rebuild, and deploy** also works, and is required when deploying code changes such as this initial configuration support. **Save only** defers the change until a later deploy. **Restart service** reuses the running deploy's environment and does not apply newly saved variables. After deployment completes, refresh the page and start a new conversation. These behaviors are documented in [Render environment variables](https://render.com/docs/configure-environment-variables) and [Render service restarts](https://render.com/docs/deploys#restarting-a-service).

For a Render-hosted demo, also set `APP_ORIGIN` to its exact HTTPS origin and configure the service to listen on Render's required interface/port. The local npm scripts remain bound to loopback. Environment instructions alone do not deploy the app.

The separate server-only `ASSISTANT_BASELINE` in `lib/assistant-instructions.ts` is always appended after the business prompt and explicitly takes precedence. It covers privacy, AI disclosure, the read-only `search_knowledge` permission, evidence-backed answers and truthful reporting of completed or unsupported actions. Neither environment configuration nor browser request bodies can remove that baseline or add server tools. There is no prompt editor, database or admin dashboard.

This is an application configuration boundary, not a tamper-proof model policy. The current direct-browser Realtime transport allows a modified client to override session configuration, as noted in the [OpenAI client-secret reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create). Instructions also cannot guarantee model compliance. A truly non-client-editable runtime policy requires a server-controlled session/transport; actual tool permissions and authorization must always be enforced server-side. The existing private search route continues to enforce its fixed URL, key, query schema and read-only operation independently of the prompt.

## How it works and its boundary

`POST /api/session` mints a credential using server configuration. The browser sends its SDP offer to OpenAI `/v1/realtime/calls`. Realtime handles speech-to-speech directly; there is no second answer-writing model. The agent calls `search_knowledge` with a standalone contextual question; the browser forwards its arguments to `POST /api/search`. That route accepts only a trimmed query of 1–1000 characters, enforces a 4 KB body limit, and calls the fixed wrapper with a maximum of five results and an eight-second timeout. Provider responses are capped at 256 KB; each returned passage is capped at 2,000 characters and source labels at 200. Empty matches and unavailable retrieval are distinct structured outcomes. HTTP 401/422/502/503, malformed payloads, network failures and timeouts produce a safe unavailable result without provider details.

Routes require an exact Host/Origin match and reject mismatched forwarded hosts (Next may add the matching forwarded host internally). With no hosted origin configured, only localhost is allowed. `APP_ORIGIN` allows one exact HTTPS origin; on Vercel production, the server falls back to `https://` plus `VERCEL_PROJECT_PRODUCTION_URL` when system environment variables are enabled. Arbitrary hosts and Vercel preview URLs are not automatically allowed. Invalid configuration fails closed. These checks are not authentication. CORS and client-side secrets do not protect an endpoint. Browser tool calls, arguments, results, instructions and the credential can be manipulated; this is not a trusted commercial authorization boundary. The ten-minute browser session limit is also bypassable.

### Fixing hosted “Local same-origin access required” errors

This message from older builds means the localhost-only guard rejected your hosted page; microphone permission is a separate browser step. Deploy the updated code first. On Vercel, production uses the project's production domain automatically via [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables). If those variables are disabled or you use another domain, open **Project Settings → Environment Variables**, set `APP_ORIGIN=https://your-app.vercel.app` for **Production**, then redeploy. Use the exact page origin, with no path or wildcard. [Vercel environment changes require a new deployment](https://vercel.com/docs/environment-variables). Refresh the deployed page and start a new conversation. On Render, set the same key and use **Save and deploy**. Keep `APP_ORIGIN` blank locally to retain localhost-only access. No API key belongs in a browser setting.

For a private hosted demo, use hosting-level access protection (such as Vercel Deployment Protection) to restrict testers. This app still has no application authentication, rate limits or quotas; the origin guard does not provide those controls.

Before public or multi-tenant use, add authentication, rate limiting, origin/CSRF protection where relevant, quotas, enforced server session limits, and session-bound authorization. A server-side sideband WebSocket can attach to the same Realtime call, own tool execution and session controls, and bind the authorized user/business/session to each lookup. Use one owner per tool call to prevent duplicates. Sideband controls alone do not prevent browser tampering; enforce authorization on the server.

No audio or transcripts are persisted by this app. The page retains up to 60 transcript items in memory; clear them or reload to remove them. End stops the microphone, closes the peer and data channel, cancels pending fetches and detaches playback. Delayed permission grants after cancellation are stopped too. Audio and text are transmitted to OpenAI; business passages also enter the Realtime context. Consult provider data controls for retention outside this app. No questions, passages, speech or secrets are logged by application code.

## Verification

```powershell
npm run test
npm run typecheck
npm run lint
npm run build
npm start
```

Tests use mocked services and cover validation, local origin restrictions, private credential forwarding, bounded retrieval, empty/error/timeout mapping, session response filtering and resource cleanup. They do not prove a live speech-to-speech session or browser interruption behavior.

Instruction configuration update: all 24 tests, type checking, lint and the production build passed. New tests verify that each session reads current server configuration, multiline prompts are preserved, client request fields cannot replace the startup prompt or tools, defaults work, and the baseline remains present even with conflicting business instructions. These checks verify configuration assembly, not model compliance. No live OpenAI session or Render deployment was performed for this update.

Implementation verification on October 27, 2026: dependency installation completed; all 22 tests passed; type checking, lint (no warnings) and the production build passed. A running production HTTP smoke test confirmed the page returns 200, unconfigured retrieval returns `unavailable`, extra query fields return 400, cross-origin requests return 403, and unconfigured session creation returns a safe 503. Windows sandbox path/network restrictions required running installation, tests, build and loopback requests outside the sandbox. Live OpenAI audio, browser microphone/autoplay/interruptions, real wrapper connectivity and retrieval quality were not tested: no credentials or live microphone session were configured.

Manual checklist (use headphones to avoid echo):

1. Leave retrieval unset. Start, grant the microphone, exchange greetings and a general follow-up. Confirm AI disclosure, sound and captions. Business questions should report unavailable evidence.
2. Deny permission; retry after allowing it. Test no device, unplugging a device, blocked autoplay and network disconnection. Start repeatedly; cancel while permission is pending, then grant it. Confirm no microphone stays active.
3. Mute/unmute; check the microphone stops transmitting speech while muted. Speak over the assistant and confirm playback stops and the next turn is sensible.
4. With an authorized wrapper configured, ask two questions with known documented answers, then a contextual follow-up (such as “Does that apply on weekends?”). Compare the actual standalone tool query, passages and sources against the expected document; do not record sensitive content in shared logs.
5. Ask for missing information, then take the wrapper offline. Confirm no invented business answer, and that normal conversation continues.
6. End during connection, speech and retrieval. Restart. Navigate away and confirm microphone indicators stop. Test keyboard Tab/Enter/Space and screen-reader status announcements.
7. Inspect browser network responses and built client files for your actual permanent OpenAI and wrapper secrets. They must be absent. Only the short-lived credential belongs in the browser. Do not share captures containing that credential or passages.

The displayed retrieval duration is measured server elapsed time including wrapper work; it does not measure speech latency. Speech-end to first *useful* audible answer is not automatically measured because playback events cannot establish semantic usefulness. For a manual measurement, timestamp the end of the question and first audible supported answer using a stopwatch or an explicitly consented local recording. Exclude fillers such as “let me check.” Repeat a fixed question set and report median/tail timings, network/device and retrieval conditions. Do not present example timings as measurements.

Retrieval correctness needs a labeled set of questions and expected passages/answers, including missing evidence and follow-ups. Inspect provenance and human relevance, not just nearest distance. `/health` proves liveness; `/ready` checks database readiness, neither proves relevance or embedding compatibility. Current ingestion is reported as `text-embedding-3-small`, 1536 dimensions, `embeddings_openai`; older documentation proposed 1024. Database dimensions, deployed ingestion, vector provenance and retrieval quality remain unverified by this app.

Realtime audio/text usage and input transcription incur API charges; wrapper queries may incur embedding and infrastructure charges. No prices are assumed. Check current [OpenAI pricing](https://developers.openai.com/api/docs/pricing), account usage and wrapper hosting charges. End unused sessions and use account spend controls; client timers are not a billing guarantee.

## Official implementation references

- [Realtime guide](https://developers.openai.com/api/docs/guides/realtime)
- [WebRTC browser flow](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Client-secret schema](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
- [Voice agents / Agents SDK guidance](https://developers.openai.com/api/docs/guides/voice-agents)
- [Server-side sideband controls](https://developers.openai.com/api/docs/guides/voice-server-controls)

The official guidance recommends Agents SDK helpers for larger voice apps. This single-tool demonstration uses the documented GA WebRTC protocol directly to keep the dependency surface small and make media cleanup explicit. It does not rely on unverified SDK method shapes.
