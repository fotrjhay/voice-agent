import { expect, it, vi } from 'vitest';
import { createVoiceTurns } from '../lib/voice-turns';
import { sessionConfig } from '../lib/server';

it('keeps the output cap and VAD configuration unchanged', () => {
  expect(sessionConfig().max_output_tokens).toBe(800);
  expect(sessionConfig().audio.input.turn_detection).toEqual({ type: 'server_vad', create_response: false, interrupt_response: true, silence_duration_ms: 600 });
});

it('deduplicates completed transcripts even after repeated speech starts', () => {
  const send = vi.fn(), turns = createVoiceTurns(send);
  turns.speechStarted('noise'); turns.speechStopped('noise');
  expect(turns.transcript('noise', ' \n ')).toBe(false);
  turns.speechStarted('question'); turns.speechStopped('question');
  expect(turns.transcript('question', 'Question')).toBe(true);
  turns.responseCreated('r1'); turns.responseDone('r1', 'completed');
  turns.speechStarted('question'); turns.speechStopped('question');
  expect(turns.transcript('question', 'Question')).toBe(false);
  expect(send).toHaveBeenCalledExactlyOnceWith({ kind: 'initial', turnId: 'question' });
});

it('deduplicates the greeting and permits repeated tool continuation rounds', () => {
  const send = vi.fn(), turns = createVoiceTurns(send);
  turns.greeting(); turns.greeting(); turns.responseCreated('g'); turns.responseDone('g', 'completed');
  turns.speechStarted('q'); turns.speechStopped('q'); turns.transcript('q', 'Question');
  turns.responseCreated('r1'); turns.toolStarted('r1', 'c1');
  turns.toolReturned('r1', 'c1'); turns.toolReturned('r1', 'c1');
  expect(send).toHaveBeenCalledTimes(2);
  turns.responseDone('r1', 'completed', ['c1']);
  expect(send).toHaveBeenCalledTimes(3);
  turns.responseCreated('r2'); turns.toolStarted('r2', 'c2');
  turns.responseDone('r2', 'completed', ['c2']); turns.toolReturned('r2', 'c2');
  expect(send).toHaveBeenCalledTimes(4);
  expect(send.mock.calls[3][0]).toEqual({ kind: 'tool', turnId: 'q', callId: 'c2' });
});

it('waits for all parallel tool results before one continuation', () => {
  const send = vi.fn(), turns = createVoiceTurns(send);
  turns.speechStarted('q'); turns.speechStopped('q'); turns.transcript('q', 'Question'); turns.responseCreated('r');
  turns.toolStarted('r', 'a'); turns.toolReturned('r', 'a');
  turns.responseDone('r', 'completed', ['a', 'b']);
  expect(send).toHaveBeenCalledOnce();
  turns.toolReturned('r', 'b'); turns.toolReturned('r', 'b');
  expect(send).toHaveBeenCalledTimes(2);
});

it('does not revive cancelled responses when delayed tools finish', () => {
  const send = vi.fn(), turns = createVoiceTurns(send);
  turns.speechStarted('q'); turns.speechStopped('q'); turns.transcript('q', 'Question'); turns.responseCreated('r');
  turns.toolStarted('r', 'c'); turns.responseDone('r', 'cancelled', ['c']); turns.toolReturned('r', 'c');
  expect(send).toHaveBeenCalledOnce();
});

it('ignores stale done events while the next response is active', () => {
  const send = vi.fn(), turns = createVoiceTurns(send);
  turns.greeting(); turns.responseCreated('g');
  turns.speechStarted('q'); turns.speechStopped('q'); turns.transcript('q', 'Question');
  turns.responseDone('g', 'cancelled'); turns.responseCreated('r');
  turns.responseDone('g', 'cancelled');
  turns.toolStarted('r', 'c'); turns.toolReturned('r', 'c');
  expect(send).toHaveBeenCalledTimes(2);
  turns.responseDone('r', 'completed', ['c']);
  expect(send).toHaveBeenCalledTimes(3);
});

it('discards superseded transcripts and tool continuations after interruption', () => {
  const send = vi.fn(), turns = createVoiceTurns(send);
  turns.speechStarted('old'); turns.speechStopped('old'); turns.transcript('old', 'Old'); turns.responseCreated('r');
  turns.toolStarted('r', 'c'); turns.speechStarted('new');
  turns.responseDone('r', 'completed', ['c']); turns.toolReturned('r', 'c');
  expect(turns.transcript('old', 'Old')).toBe(false);
  turns.transcript('new', 'New'); turns.speechStopped('old');
  expect(send).toHaveBeenCalledOnce();
  turns.speechStopped('new');
  expect(send).toHaveBeenCalledTimes(2);
});
