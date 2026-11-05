# Browser voice backend selection

`VOICE_BACKEND` is server-only and accepts exactly `pipecat` or `openai_direct`.
The default is `pipecat`. Invalid values fail closed. Restart locally or redeploy
Vercel after changing it. There is no automatic provider fallback.

## Recorded rollout state

At the November 5 implementation check, Pipecat was selected locally and the supplied service token authenticated to Render. The deployed service did not yet advertise the settings-handoff version. The operator reported standalone Render browser audio working on Wi-Fi/mobile data and inbound Twilio working; website switching/dashboard handoff was not yet verified. The source changes were published as [service PR #2](https://github.com/fotrjhay/call_agent/pull/2) and [website PR #1](https://github.com/fotrjhay/voice-agent/pull/1). These are review/deployment references, not evidence that either update is live. This documentation update does not deploy or change environment variables.

## Pipecat mode

Set these on the website server (Vercel Project Settings → Environment Variables):

```dotenv
VOICE_BACKEND=pipecat
PIPECAT_SERVICE_URL=https://call-agent-uxao.onrender.com
PIPECAT_SERVICE_TOKEN=the-same-secret-as-BROWSER_TOKEN-on-Render
```

Keep the token server-only; never prefix it with `NEXT_PUBLIC_`, put it in a URL,
commit it, or enter it into the public website. The website forwards authenticated
signaling requests to Pipecat. Only temporary TURN credentials and SDP reach the
browser. Audio travels between the browser and Pipecat through the configured
relay, not through Vercel functions. No CORS relaxation is required.

The Pipecat service must include the companion settings-handoff update. It reports
`settings_handoff_version: 1` at `/ready` and authenticated `/api/ice`. The website
refuses to connect an older service so that dashboard settings are not silently
ignored. Pipecat mode does not require an OpenAI key in the website environment;
the AI and retrieval keys remain on Render.

For each new SDP offer the website loads the saved business settings and sends a
validated instructions/greeting snapshot to Pipecat over its authenticated API.
The instructions include the existing application baseline, tone and support
contacts. Browser-supplied settings, tools, backend selectors, URLs and credentials
are rejected or ignored; they cannot override the server selection or snapshot.
Existing sessions keep their snapshot. Phone calls retain the service's existing
configuration; this update changes browser sessions only.

Pipecat owns greeting, turns, interruption and retrieval. The browser does not send
`response.create`, execute knowledge tools or run the old transcription-triggered
turn logic in this mode. Assistant captions and activity/tool metadata use the data
channel. User captions are unavailable because input transcription is disabled.
This adds no STT provider. Retrieval time is elapsed tool work measured on Pipecat;
cached results can be faster. Admin diagnostic downloads mark unreported provider
response counts/user turns as unknown, and do not invent usage or costs.

## Which server owns each setting

| Setting | Website / Vercel | Python service / Render |
| --- | --- | --- |
| Browser backend | `VOICE_BACKEND` | Not used; do not put this variable in the service `.env` |
| Service connection | `PIPECAT_SERVICE_URL`, `PIPECAT_SERVICE_TOKEN` | Matching `BROWSER_TOKEN`, browser enabled and relay configuration |
| Saved business settings | Supabase row or validated website defaults; compiled baseline | Per-browser instructions/greeting snapshot; local files/env for phone and standalone sessions without a snapshot |
| Pipecat AI/retrieval | No website AI key required for this mode | `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_VOICE`, wrapper keys and `RETRIEVAL_LIMIT` |
| Direct rollback AI/retrieval | Website OpenAI key, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, wrapper keys | Not used by direct browser sessions |

Pipecat defaults to three retrieved passages and no user transcription. Direct search uses five passages and its existing input transcription. The legacy website `/api/search` endpoint remains available in either mode, even though Pipecat does not use it. Backend selection does not disable that route or authorize public customers.

## Rollback

Set `VOICE_BACKEND=openai_direct` and redeploy Vercel. Keep the website's existing
`OPENAI_API_KEY`, model/voice and retrieval environment variables available if you
want this rollback path. It uses the original browser-to-OpenAI transport and
transcription-triggered turn implementation. Dashboard settings and the UI remain
available in both modes. This does not switch Twilio or other phone calls.

## Deployment order

1. Deploy the Pipecat companion update first. Keep the working Render browser
   settings and service token. Check `/ready` for `settings_handoff_version: 1`.
   No new Render environment variable is needed for the handoff.
2. Add the three website variables above to the intended Vercel environment.
   Set the token to the existing Render `BROWSER_TOKEN`, not an OpenAI/Twilio key.
3. Deploy this website update. Use a preview/protected admin test first when
   available; preview origins must be explicitly configured under existing rules.
   The admin test retains its authentication, feature flag and diagnostics opt-in.
4. On the free Render instance, skip the Shell probe. Open `/ready`, then the standalone service page, enter the existing browser token and verify `connected`, a selected `Audio route: relay ↔ relay`, and two-way audio from Wi-Fi/mobile data. A readiness response alone does not verify credentials or audio. The website itself must not ask visitors for this token.
5. Test greeting, a known knowledge question, a follow-up, unavailable knowledge,
   interruption, mute, end/restart, captions, and microphone release on both Wi-Fi
   and mobile data. Change the greeting in the dashboard and start a fresh session
   to confirm the snapshot. Existing phone behavior should remain unchanged.
6. If necessary, redeploy with `VOICE_BACKEND=openai_direct`. Do not route a failed
   Pipecat connection into a second paid provider session automatically.

The Render global concurrency and token issuance guards still apply to this
public pilot. Origin checks and a hidden service token are not customer identity
authentication or per-customer commercial quotas. The Render service is currently
single-process. Cold starts on a free instance can still delay session setup.
Existing connections can be interrupted by deployment or service restart.

## Failure checks

- Missing `settings_handoff_version: 1` in service `/ready`: deploy the companion service update before the website. Do not bypass the protocol guard.
- Website session/offer 503: check URL/token matching, Render browser/relay configuration, service capacity/availability and handoff acknowledgement. Provider bodies are not returned to visitors.
- Website offer 400: send only JSON `{type: "offer", sdp}`; caller-supplied instructions/backend/tools are rejected. The website adds its own saved snapshot.
- Website offer 409: the server selected direct mode after setup; start a new conversation.
- HTTP 429: wait one minute before another attempt. The service's 30-per-minute issuer guard counts both browser and server ICE requests.
- No user captions or provider usage in Pipecat's browser summary: expected. Assistant captions are best effort; inspect safe service usage logs for provider metrics.
- Free-instance cold start or routing timeout: retry after the service is live and inspect Render logs. No Shell or paid plan upgrade is required to run the browser verification.

Connection setup has a 90-second browser deadline; each website-to-Pipecat request has a 45-second timeout. Session and offer routes declare a 60-second function duration. A connected browser also has a ten-minute timer; Pipecat enforces its own service duration/inactivity limits. These bounds do not guarantee that a free-instance cold start finishes in time.

## Checks

```powershell
npm test
npm run typecheck
npm run lint
npm run build
node tests/runtime-smoke.mjs
node tests/runtime-smoke.mjs --pipecat
```

The HTTP smoke tests use local fake Supabase/SQL and Pipecat services, with no
external calls or charges. UI connection tests mock WebRTC/microphones and verify
both backend paths, including no response/tool generation in Pipecat mode.
Run the separate Python service's tests in its own repository. `call_agent/` is
excluded from the website's Git tracking, TypeScript, lint and Vitest discovery.
