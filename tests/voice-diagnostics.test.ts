import { expect, it } from 'vitest';
import { createVoiceDiagnostics } from '../lib/voice-diagnostics';

it('preserves raw numeric usage and deduplicates by response ID', () => {
  const d = createVoiceDiagnostics();
  const usage = { total_tokens: 50, input_tokens: 40, output_tokens: 10,
    input_token_details: { audio_tokens: 30, text_tokens: 10, cached_tokens: 20, cached_tokens_details: { audio_tokens: 15, text_tokens: 5 } },
    output_token_details: { audio_tokens: 8, text_tokens: 2 } };
  d.sent({ type: 'response.create', event_id: 'client_1' }, { kind: 'initial', turnId: 'item_1' });
  d.received({ type: 'response.created', response: { id: 'r1', max_output_tokens: 800 } });
  const done = { type: 'response.done', response: { id: 'r1', status: 'completed', usage } };
  d.received(done); d.received(done);
  d.received({ type: 'response.created', response: { id: 'r1', usage: null } });
  expect(d.summary().responses).toHaveLength(1);
  expect(d.summary().responses[0]).toMatchObject({ usage, turnId: 'item_1', status: 'completed' });
  expect(d.summary().responses[0].effectiveConfig).toMatchObject({ max_output_tokens: 800 });
  usage.total_tokens = 999;
  expect((d.summary().responses[0].usage as { total_tokens: number }).total_tokens).toBe(50);
});

it('counts unfinished retrievals without fabricating result sizes or usage', () => {
  const d = createVoiceDiagnostics();
  d.retrievalStarted('c', 'r'); d.retrievalStarted('c', 'r'); d.end('Ended');
  expect(d.summary().counts.retrievals).toBe(1);
  expect(d.summary().retrievals[0]).toMatchObject({ status: 'unknown', serverMs: null, returnedTextCharacters: null });
});

it('marks missing usage unknown and records cancellation without error messages', () => {
  const d = createVoiceDiagnostics();
  d.received({ type: 'response.done', response: { id: 'r', status: 'cancelled', status_details: { reason: 'turn_detected', error: { message: 'private' } } } });
  expect(d.summary().responses[0]).toMatchObject({ usage: 'unknown', cancellationReason: 'turn_detected' });
  expect(JSON.stringify(d.summary())).not.toContain('private');
});

it('records safe effective config changes, counters and retrieval sizes only', () => {
  let time = 1000;
  const d = createVoiceDiagnostics(() => time);
  d.connected();
  d.received({ type: 'session.created', session: { model: 'test-model', max_output_tokens: 800, instructions: 'PRIVATE', client_secret: 'PRIVATE', audio: { input: { turn_detection: { type: 'server_vad', create_response: false } } } } });
  d.received({ type: 'session.updated', session: { max_output_tokens: 1000 } });
  d.received({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item_1', transcript: 'PRIVATE' });
  d.completedTurn('item_1'); d.completedTurn('item_1');
  d.sent({ type: 'response.create', response: { max_output_tokens: 200, instructions: 'PRIVATE' } }, { kind: 'initial', turnId: 'item_1' });
  d.sent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call_1', output: 'PRIVATE' } });
  d.retrieval('call_1', 'r1', 42, { status: 'ok', retrieval_ms: 30, passages: [{ text: 'PRIVATE', source: 'PRIVATE' }] });
  d.retrieval('call_1', 'r1', 42, {});
  time = 3500; d.end('Ended'); time = 9000; d.end('Disconnected');
  const summary = d.summary();
  expect(summary.connectedDurationMs).toBe(2500);
  expect(summary.counts).toEqual({ responseCreates: 1, completedUserTurns: 1, retrievals: 1 });
  expect(summary.retrievals[0]).toMatchObject({ returnedTextCharacters: 7, returnedTextBytes: 7, serverMs: 30 });
  expect(summary.configurations).toHaveLength(2);
  expect(summary.responseCreates[0].overrides).toMatchObject({ max_output_tokens: 200 });
  expect(JSON.stringify(summary)).not.toContain('PRIVATE');
});
