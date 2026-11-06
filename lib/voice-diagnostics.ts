import type { ResponseRequest } from './voice-turns';

type Fields = Record<string, unknown>;
const object = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const id = (value: unknown) => typeof value === 'string' && /^[\w-]{1,160}$/.test(value) ? value : undefined;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
function pick(value: unknown, keys: string[]) {
  const source = object(value);
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
}
// Only numeric usage trees are accepted. Never retain arbitrary event payloads.
function numericTree(value: unknown): boolean {
  if (value === null || typeof value === 'number' && Number.isFinite(value)) return true;
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, child]) => /^[a-z][a-z0-9_]*$/.test(key) && numericTree(child));
}
export function relevantConfig(value: unknown) {
  const source = object(value);
  const audio = object(source.audio), input = object(audio.input), output = object(audio.output);
  const safe = (value: unknown, keys: string[]) => Object.fromEntries(Object.entries(pick(value, keys))
    .filter(([, v]) => typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string' && /^[\w./-]{1,100}$/.test(v)));
  return {
    ...safe(source, ['model', 'max_output_tokens', 'max_response_output_tokens', 'tool_choice']),
    output_modalities: Array.isArray(source.output_modalities) ? source.output_modalities.filter(v => v === 'audio' || v === 'text') : undefined,
    audio: { input: {
      transcription: safe(input.transcription, ['model']),
      turn_detection: safe(input.turn_detection, ['type', 'create_response', 'interrupt_response', 'silence_duration_ms', 'prefix_padding_ms', 'threshold', 'eagerness']),
    }, output: safe(output, ['voice']) },
  };
}

export function createVoiceDiagnostics(now: () => number = Date.now, started = now(), backend: 'openai_direct' | 'pipecat' = 'openai_direct') {
  let connected: number | null = null, ended: number | null = null;
  let endReason: string | null = null;
  const turns = new Set<string>();
  const configurations: Fields[] = [];
  const creates: Fields[] = [];
  const events: Fields[] = [];
  const responses = new Map<string, Fields>();
  const retrievals = new Map<string, Fields>();
  const bindings = new Map<string, ResponseRequest>();
  const waiting: ResponseRequest[] = [];
  const stamp = () => new Date(now()).toISOString();
  return {
    connected() { connected ??= now(); },
    end(reason: string) { if (ended === null) { ended = now(); endReason = reason; } },
    completedTurn(itemId: string) { turns.add(itemId); },
    sessionSetup(requested: unknown, reported: unknown) {
      configurations.push({ at: stamp(), type: 'client_secret.requested', config: relevantConfig(requested) });
      configurations.push({ at: stamp(), type: 'client_secret.reported', config: relevantConfig(reported) });
    },
    sent(event: Fields, request?: ResponseRequest) {
      if (event.type === 'response.create') {
        creates.push({ at: stamp(), eventId: id(event.event_id), ...request, overrides: relevantConfig(event.response) });
        if (request) waiting.push(request);
      }
      if (event.type === 'response.cancel' || event.type === 'input_audio_buffer.commit') events.push({ at: stamp(), type: event.type, eventId: id(event.event_id), responseId: id(event.response_id) });
      const item = object(event.item);
      if (event.type === 'conversation.item.create' && item.type === 'function_call_output') events.push({ at: stamp(), type: 'tool_result_sent', callId: id(item.call_id) });
    },
    received(value: unknown) {
      const event = object(value), response = object(event.response);
      if (event.type === 'session.created' || event.type === 'session.updated') configurations.push({ at: stamp(), type: event.type, config: relevantConfig(event.session) });
      if (['input_audio_buffer.committed', 'input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'conversation.item.input_audio_transcription.completed', 'response.function_call_arguments.done'].includes(String(event.type))) {
        events.push({ at: stamp(), type: event.type, eventId: id(event.event_id), itemId: id(event.item_id), responseId: id(event.response_id), callId: id(event.call_id) });
      }
      const responseId = id(response.id);
      if (!responseId || !['response.created', 'response.done'].includes(String(event.type))) return;
      if (!bindings.has(responseId) && event.type === 'response.created') {
        const request = waiting.shift();
        if (request) bindings.set(responseId, request);
      }
      const previous = responses.get(responseId);
      // A duplicate created event must not replace a terminal response or its usage.
      if (event.type === 'response.created' && previous) return;
      const details = object(response.status_details);
      const reason = id(details.reason);
      const usage = response.usage != null && numericTree(response.usage) ? structuredClone(response.usage) : previous?.usage ?? 'unknown';
      responses.set(responseId, { ...previous, id: responseId, ...bindings.get(responseId),
        at: stamp(), status: id(response.status) ?? 'unknown', statusType: id(details.type) ?? previous?.statusType ?? 'unknown', cancellationReason: reason ?? previous?.cancellationReason ?? 'unknown',
        effectiveConfig: { ...object(previous?.effectiveConfig), ...Object.fromEntries(Object.entries(relevantConfig(response)).filter(([key, value]) => key !== 'audio' && value !== undefined)),
          audio: response.audio === undefined ? object(previous?.effectiveConfig).audio ?? relevantConfig(response).audio : relevantConfig(response).audio }, usage });
    },
    retrievalStarted(callId: string, responseId: string) {
      if (!retrievals.has(callId)) retrievals.set(callId, { callId, responseId, at: stamp(), status: 'unknown', elapsedMs: null, serverMs: null,
        passageCount: null, returnedTextCharacters: null, returnedTextBytes: null });
    },
    retrieval(callId: string, responseId: string, elapsedMs: number, value: unknown) {
      if (retrievals.get(callId)?.elapsedMs != null) return;
      const output = object(value);
      const passages = Array.isArray(output.passages) ? output.passages.map(object) : [];
      retrievals.set(callId, { callId, responseId, at: stamp(), elapsedMs, serverMs: number(output.retrieval_ms),
        status: ['ok', 'empty', 'unavailable'].includes(String(output.status)) ? output.status : 'unknown',
        passageCount: passages.length, returnedTextCharacters: passages.reduce((sum, p) => sum + (typeof p.text === 'string' ? p.text.length : 0), 0),
        returnedTextBytes: passages.reduce((sum, p) => sum + (typeof p.text === 'string' ? new TextEncoder().encode(p.text).length : 0), 0) });
    },
    pipecatTool(value: { name?: string; call_id: string; status: string; count: number | null; latency_ms: number | null }) {
      if (value.name && value.name !== 'search_knowledge') return;
      retrievals.set(value.call_id, { callId: value.call_id, at: stamp(), status: value.status,
        serverMs: value.latency_ms, passageCount: value.count,
        returnedTextCharacters: null, returnedTextBytes: null });
    },
    summary() {
      return structuredClone({ schemaVersion: 1, backend, startedAt: new Date(started).toISOString(), connectedAt: connected === null ? null : new Date(connected).toISOString(),
        endedAt: ended === null ? null : new Date(ended).toISOString(), endReason,
        connectedDurationMs: connected === null ? 0 : (ended ?? now()) - connected,
        counts: { responseCreates: backend === 'pipecat' ? null : creates.length, completedUserTurns: backend === 'pipecat' ? null : turns.size, retrievals: retrievals.size },
        ...(backend === 'pipecat' ? { limitations: 'Provider responses, user turns and usage are not reported to this browser. See Pipecat operational logs.' } : {}),
        completedTurnIds: [...turns], configurations, responseCreates: creates, responses: [...responses.values()], retrievals: [...retrievals.values()], events });
    },
  };
}
export type VoiceDiagnostics = ReturnType<typeof createVoiceDiagnostics>;
