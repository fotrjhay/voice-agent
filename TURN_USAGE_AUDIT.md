# Voice turn and usage audit

Review date: October 29, 2026.

## Scope

The model, business prompt, application baseline, retrieval limits, VAD settings,
and requested output limit are unchanged. No environment files were edited.
The unrelated untracked `test_instruction,NovaCart.txt` file was left untouched.

## Event trace

| Operation | Location and behavior |
| --- | --- |
| Session configuration | `lib/server.ts`, `sessionConfig`: requests `max_output_tokens: 800`; VAD has `create_response: false`, `interrupt_response: true`, and 600 ms silence detection. |
| Session creation | `lib/voice-session.ts`: sends the configuration to `/v1/realtime/client_secrets`. The public route returns no diagnostics. The protected `/api/admin/voice/session` route can return selected requested and provider-reported fields after flag, opt-in, and admin checks. No prompt or credential is included in that diagnostics object. |
| Later session updates | No `session.update` sender exists. Provider `session.created` and `session.updated` events are observed by diagnostics. |
| Response creation | `app/voice.tsx`: one sending callback creates all `response.create` events, with generated client event IDs. It sends no response configuration overrides. |
| Opening greeting | The data channel open handler calls `turns.greeting()`. This request is deduplicated separately from user turns. |
| Audio commit | No `input_audio_buffer.commit` sender exists. WebRTC supplies audio; server VAD commits it. Diagnostics observe `input_audio_buffer.committed` item/event IDs without recording audio. |
| Completed transcription | The message handler displays captions separately, then calls `turns.transcript(item_id, transcript)`. The controller uses text only to reject whitespace; diagnostics retain only accepted item IDs. |
| Initial response | `lib/voice-turns.ts`: a nonempty completed transcript for the current input item queues one initial response. A session-lifetime item ID set rejects repeated completions. Superseded transcripts are counted once but do not queue stale replies. |
| Tool execution | `response.function_call_arguments.done` is deduplicated by call ID. Only `search_knowledge` calls `/api/search`. |
| Tool results | The browser sends `conversation.item.create` with `function_call_output`, including after an interrupted turn if the session remains open. The controller receives only response/call IDs. |
| Tool continuation | Function-call items register pending tools. `response.done.output` also supplies the complete call list. One continuation waits for a completed parent response and every tool result. Each subsequent tool response can continue again. |
| Cancellation | No `response.cancel` sender exists. Server VAD performs interruption. Terminal `response.done` events are matched and deduplicated by response ID. Cancelled/failed parents cannot restart through delayed tool results. |
| Local end | `end()` and unmount close the channel/peer and stop media through `releaseResources`. They do not claim provider cancellation or invent terminal usage. |

## Confirmed problems and fixes

1. The previous `speechStarted` reset the accepted-transcript flag for every event.
   Replaying a start and completed transcript for the same item could send another
   initial reply. Starts and completed transcripts now use stable item ID sets.
2. The previous `responseDone()` had no response ID. A repeated terminal event
   could release the active lock of a newer response. Terminal events now match
   the active response ID and are processed once.
3. The previous generic continuation request could queue a reply after a cancelled
   response. It also lacked a complete parallel-tool result barrier. Continuations
   now belong to their parent response and wait for all its returned tool results.
4. No usage/configuration diagnostics existed. The opt-in development recorder now
   separates client requests from provider reports and retains one usage record
   per response ID.

These failures are reproduced with synthetic event sequences in unit tests.
Their occurrence or frequency in real conversations has not been measured.

## Output limit investigation

The exact field is `session.max_output_tokens`, sent as `800` inside the
client-secret request. The official reference defines this as the limit for one
assistant response, including tool calls. It is not a whole-turn or session budget.
A turn can contain an initial response and additional tool-continuation responses.
Each is a separate response.

The application does not send later session updates or response-level overrides.
The diagnostics export records:

- `client_secret.requested`: selected configuration sent by this server.
- `client_secret.reported`: selected configuration returned by OpenAI.
- `session.created` and `session.updated`: configuration reported on the channel.
- `responses[].effectiveConfig`: fields reported for each response.
- `responseCreates[].overrides`: selected per-response fields actually sent.
  The current sender supplies none.

An absent reported field is unknown; it does not establish inheritance or
successful enforcement. An observed value of 800 confirms the reported setting,
not a measured guarantee about all generations. Inspect response usage and
terminal status/reason together. Do not infer enforcement from source alone.

No live OpenAI session was started for this audit. Effective provider values and
live cap enforcement remain unverified until an opted-in conversation supplies
these events. Mocked provider values in tests are not live observations.

Official references:

- [Client-secret configuration](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
- [Client events and response overrides](https://developers.openai.com/api/reference/resources/realtime/client-events)
- [Server events and response usage](https://developers.openai.com/api/reference/resources/realtime/server-events)

## Diagnostics operation and privacy

The later hosted-access update replaces development-only access with a server flag,
verified Supabase admin authorization, and explicit opt-in. Recording is off by
default. Use the protected `/admin/voice-test` page in development or production.
The public voice page no longer offers diagnostics. See
[HOSTED_DIAGNOSTICS.md](HOSTED_DIAGNOSTICS.md) for setup and disable instructions.

The panel and JSON download contain session timestamps, connected duration,
configuration reports, turn/event/response/call IDs, response status and provider
reason codes, raw numeric per-response usage, retrieval timings and text sizes.
The start timestamp includes connection setup; connected duration starts when the
data channel opens. Refresh duration updates an active session's displayed time.
Ending freezes its duration. Starting again replaces the previous recording.
Disabling diagnostics after ending discards it. Reloading removes it from memory.

Completed-user-turn counts use unique, nonempty completed transcription item IDs.
Greeting and tool continuations contribute to `responseCreates` separately.
The event list can contain repeated provider observations; counts and usage records
are deduplicated independently. Retrieval count includes started lookups; a lookup
interrupted by local end can have unknown duration/result sizes.

No audio, transcript text, prompts, retrieval queries/passages, source names,
credentials, support contacts, or error messages enter the recorder. Only selected
configuration fields and identifier/reason codes are retained. Usage must be a
numeric/null object tree; unsupported payloads remain unknown. Valid provider
usage trees are cloned without flattening or renaming their audio/text/cache keys.
Missing usage is `unknown`, never zero. Missing retrieval measurements are null.
No database, browser storage, analytics request, or console logging is added.
Only the explicit download creates a file.

Do not add cached-token counters to input totals or equate their meanings with
columns from a dashboard CSV. This recorder performs no billing conversion or
cross-source usage aggregation.

## Hypotheses and remaining limits

- Repeated provider events could have contributed to duplicate replies. The code
  vulnerability is confirmed; its role in any production incident is unverified.
- Long conversations or tool continuations could explain a high aggregate token
  count despite a per-response cap. This requires real usage evidence.
- A modified browser or external integration could change session settings. This
  app's ordinary response sender does not; this audit adds no authorization layer.
- Microphone noise, echo, transcription accuracy, browser interruption ordering,
  provider cancellation behavior, and actual output-limit enforcement require a
  live device session. No audio or production deployment was tested here.

## Manual verification

Automated verification: all 126 tests passed; typecheck, lint, and the production
build passed. The first sandboxed build failed because Windows denied a dependency
junction. The same build passed with the required filesystem permission. No code
or build configuration workaround was needed.

1. Enable the server flag, sign in as an admin, open the voice test page, opt in,
   and start a conversation. Confirm one
   greeting create event. Compare requested/reported model and token limit.
2. Ask one question. Confirm one `initial` create for its item ID. For a knowledge
   question, confirm tool IDs, one returned result per call, and a later `tool`
   create. A continuation must not count as another completed user turn.
3. Interrupt a reply and then ask another question. Confirm the old terminal status
   and reason when provided, with no delayed tool restart for the old turn.
4. Request a long answer. Inspect the provider-reported limit, raw output usage,
   and terminal reason. Do not treat a short answer as proof of enforcement.
5. End and download JSON. Confirm frozen duration and one response record per ID.
   Confirm that no spoken text, prompt, passages, keys, or contacts are present.
6. Disable the server flag. Confirm that the test page and its APIs are unavailable.
   The public page and ordinary credential responses must contain no diagnostics.
