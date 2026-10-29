# Controlled hosted voice diagnostics

## Enable for a test

1. Push the code through the existing Git deployment process.
2. In the hosting environment, set the server-only variable
   `VOICE_DIAGNOSTICS_ENABLED=true`.
3. Apply the environment change through the normal deployment process.
4. Sign in at [the existing admin page](https://voice.jayeola.com/admin)
   with an authorized Supabase admin account.
5. Select **Voice diagnostics**, or open
   [the voice test page](https://voice.jayeola.com/admin/voice-test).
6. Select **I opt in to diagnostics for this voice test**.
7. Start a conversation.
8. End the conversation and select **Download JSON summary**.

The feature is disabled unless the server variable is exactly `true`.
There is no `NEXT_PUBLIC_` diagnostics flag. Do not change Supabase site URLs,
redirect URLs, cookie domains, authentication providers, or the existing
`VOICE_APP_ORIGIN` / `ADMIN_APP_ORIGIN` settings for this feature.
If the configured admin origin is a separate domain, use `/admin/voice-test`
on that existing domain instead. Requests remain on the page's origin.

The public voice page has no diagnostics controls. Its normal session and
retrieval flow is unchanged. Supplying a diagnostics header to the public
session route is rejected; a URL parameter or client-side flag cannot grant
admin diagnostics access.

## Access checks

The server page checks the feature flag and calls the existing `requireAdmin()`.
That function verifies identity through Supabase `getUser()` and current database
membership through `voice_agent_admin.is_admin`. It does not trust user metadata.
Unauthenticated page requests go to the existing sign-in page. Non-admin users
do not receive the voice test component.

The test uses these separate POST routes:

- `/api/admin/voice/session`
- `/api/admin/voice/search`

Every request requires the server flag, explicit `x-voice-diagnostics: 1` opt-in,
verified admin identity and membership, the existing same-origin checks, and the
existing shared `admin-read` rate limit. Origin matching is an additional check,
not authorization. The page's client prop is not an authorization credential.

The session route returns only a temporary Realtime credential and selected,
filtered configuration reports. The recorder starts only after that authorized
response succeeds. Retrieval rechecks authorization independently. A rejected
admin retrieval stops the test instead of switching to the public route.

The existing proxy refreshes Supabase cookies for these `/admin` and `/api/admin`
paths. Its responses use `Cache-Control: private, no-store`. API successes and
errors also use private/no-store responses. The test page is dynamically rendered;
browser requests use `cache: no-store`. No domain, auth, or proxy rules were changed.

## Recorded measurements

Recordings remain in the current page's memory. There is no diagnostic database,
local-storage entry, telemetry upload, or console log. A file is created only by
the explicit JSON download. Starting another test replaces the previous summary.
Reloading removes it. Unchecking opt-in after ending discards it.

The summary includes:

- Session start, connection, and end timestamps; connected duration and end reason.
- Selected requested and provider-reported model, output cap, voice, transcription,
  modality, tool-choice, and VAD fields.
- Input-item/turn, response, event, and tool-call identifiers.
- Response status and provider cancellation/reason codes when available.
- Numeric per-response usage, with audio/text/cache structure preserved and
  deduplication by response ID. Missing usage is `unknown`, not zero.
- Retrieval counts, client/server timings, passage counts, and returned text sizes
  in characters and UTF-8 bytes. Missing measurements remain unknown/null.
- Counts of sent `response.create` events and unique nonempty completed user turns.

Audio, transcripts, prompts, queries, passages, source names, credentials, personal
details, and provider error messages are excluded from diagnostics. The ordinary
voice interface still displays its in-memory conversation captions separately.
Provider usage is not converted into prices or normalized against dashboard CSV
fields. Configuration reports do not, by themselves, prove output-cap enforcement.

The model, prompts, VAD settings, retrieval bounds, and normal turn handling are
unchanged by hosted access control.

## Disable after testing

1. End all active test conversations and close their test pages.
2. Set `VOICE_DIAGNOSTICS_ENABLED=false`, or remove it, in the hosting environment.
3. Apply the environment change through the normal deployment process.
4. Confirm that `/admin/voice-test` is unavailable and both admin voice APIs return
   HTTP 404. Confirm that the public voice page still works.

The flag is checked at page access, session creation, and every retrieval request.
It cannot retroactively revoke a direct browser-to-OpenAI connection or erase
already downloaded files. Close active tests when disabling the feature or
revoking an administrator. No permanent diagnostic data needs database cleanup.

## Verification checklist

1. With the flag off, verify that an admin cannot open the test page or call its APIs.
2. With the flag on, verify that signed-out and non-admin users cannot obtain a
   diagnostic credential. Verify that an admin without explicit opt-in is rejected.
3. As an admin, start an opted-in test. Check configuration reports, one initial
   response per user item, legitimate tool continuations, and cancellation details.
4. Ask a known business question. Check retrieval timings and sizes, then end and
   download JSON. Confirm the absence of spoken text, prompts, passages, and secrets.
5. Check private/no-store response headers and confirm that the public voice page
   does not display diagnostics controls.
6. Disable the server flag after the test.

Authorization and privacy checks use mocked services in the test suite. Live hosted
Supabase sessions, microphone behavior, and provider usage still require the manual
checks above. No hosting environment or Supabase settings were changed by this update.

Validation: all 143 tests passed. Typecheck, lint, and the production build passed.
