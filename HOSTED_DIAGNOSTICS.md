# Controlled hosted voice diagnostics

## Enable a test

1. Deploy the selected backend and, for Pipecat, the settings-handoff service update described in [PIPECAT_MIGRATION.md](PIPECAT_MIGRATION.md).
2. Set server-only `VOICE_DIAGNOSTICS_ENABLED=true` on the website and redeploy. The flag must be exactly `true`; there is no `NEXT_PUBLIC_` diagnostics flag.
3. Sign in through the existing admin origin with a verified Supabase admin account and open `/admin/voice-test` on that same origin.
4. Select **I opt in to diagnostics for this voice test**, then start the conversation.
5. End the conversation and select **Download JSON summary** before closing/reloading the page.

The test uses the server-selected `VOICE_BACKEND`; it is not a client-selectable provider override. Do not change Supabase providers, redirect URLs, cookie domains or the existing voice/admin origins to enable this feature. The public page has no diagnostic controls. A diagnostics header on public session/offer routes is rejected.

## Access checks and routes

The page checks the feature flag and `requireAdmin()`. Supabase `getUser()` verifies identity; current `voice_agent_admin.is_admin` membership controls access. User metadata and the page's client prop are not authorization credentials. Signed-out users are redirected to sign-in; non-admin users do not receive the test component.

Each of these POST routes independently checks the flag, `x-voice-diagnostics: 1`, verified identity/current membership, same origin and the shared PostgreSQL `admin-read` rate limit:

| Route | Usage |
| --- | --- |
| `/api/admin/voice/session` | Selected backend session/ICE setup |
| `/api/admin/voice/offer` | Pipecat SDP and server-loaded settings snapshot |
| `/api/admin/voice/search` | Direct-mode knowledge tool requests |

Pipecat retrieval executes in Python; it does not call the admin search route per tool. Its authorization occurs when the trusted browser session is established. Direct retrieval rechecks admin authorization on every website search request. Rejections do not switch to public routes. Supabase cookie refresh and existing host/origin rules remain in place. Page/API/browser requests use dynamic/private/no-store handling.

## Measurements by backend

The recorder starts only after authorized session setup succeeds. Summaries remain in page memory: no diagnostic database, local-storage entry, telemetry upload or automatic console log. Download is explicit; starting another test replaces the summary, reload clears it, and unchecking opt-in after ending discards it.

Both modes report backend selection, start/connect/end timestamps, browser connected duration and end reason. Safe configuration fields can include model, voice, output cap and VAD, when supplied. Configuration reports are observations, not proof of provider enforcement.

| Measurement | `pipecat` | `openai_direct` |
| --- | --- | --- |
| Configuration | Filtered service configuration from ICE setup; requested configuration may be empty | Filtered client-secret request/report and channel session updates |
| Response/user-turn counts | Null: not reported to this browser | Browser response requests and accepted nonempty completed transcription IDs |
| Response IDs/status/cancellation | Not reported by this integration | Provider-reported channel events when available |
| Provider token usage | Not reported to browser; inspect safe service usage logs | Numeric per-response provider usage, deduplicated by response ID; missing usage is unknown |
| Retrieval | Call ID, status, passage count and server tool latency when sent | Client/server timings, passage count, returned character/byte sizes and response/call IDs |
| Retrieved text sizes | Null; passages are not sent to browser | Measured sizes without retaining passage text in the summary |
| Conversation captions | Assistant only, outside diagnostics | User/assistant captions, outside diagnostics |

Pipecat uses native semantic server VAD and tool continuation. Its browser does not send `response.create`, execute tools or drive turns from captions. Direct mode retains the transcription-triggered controller audited in [TURN_USAGE_AUDIT.md](TURN_USAGE_AUDIT.md). Empty fields or arrays in Pipecat summaries must not be interpreted as zero provider usage or no responses. Neither mode invents prices or costs.

Audio, transcripts, prompts, search queries, passages, source names, credentials and raw provider error messages are excluded from downloaded diagnostics. The ordinary conversation caption display is separate in-memory page state. Do not add private content to identifiers or share unredacted provider/network captures.

## Disable after testing

1. End active test conversations and close their pages.
2. Set `VOICE_DIAGNOSTICS_ENABLED=false` or remove it on the website, then redeploy.
3. Confirm the test page and all three admin voice APIs return 404 while public voice still works.

The flag is checked at page/session/offer access and direct-mode retrieval. Disabling it or revoking membership does not retroactively terminate an established audio connection, revoke previously issued relay credentials or erase downloaded files. Close active tests explicitly. No diagnostic database cleanup is needed.

## Verification checklist

1. Flag off: admin test page and all three APIs unavailable.
2. Flag on: signed-out/non-admin users, missing opt-in and cross-origin requests denied before contacting providers.
3. Pipecat: verify backend/version/configuration, one greeting, saved dashboard settings and successful knowledge/follow-up; check tool status/latency and acknowledge that response/usage fields are unavailable here.
4. Direct rollback: verify a single greeting, one initial reply per accepted current-turn transcription, tool continuation/interruption handling and available provider usage reports.
5. Both: interrupt speech/pending retrieval, mute, end/restart, download the summary and inspect for private text/secrets. Confirm the public page has no diagnostics controls.
6. Disable diagnostics after testing.

At the last implementation check, the complete website suite had 167 passing mocked tests, plus passing type checking, lint, build and production HTTP smoke checks for both modes. Earlier 143-test diagnostics results predate the selector. Live hosted Supabase authorization, actual website audio, provider enforcement and production cutover need separate verification; standalone Render browser success does not prove those integration checks. This documentation update does not change hosting or Supabase settings.
