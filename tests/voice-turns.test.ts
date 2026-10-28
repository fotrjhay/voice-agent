import { expect, it, vi } from 'vitest';
import { createVoiceTurns } from '../lib/voice-turns';
import { sessionConfig } from '../lib/server';

it('disables automatic VAD replies so empty audio cannot bypass the transcript gate', () => {
  expect(sessionConfig().audio.input.turn_detection).toMatchObject({ create_response: false, interrupt_response: true });
});

it('stays silent for empty turns and responds once to a valid turn', () => {
  const send = vi.fn();
  const turns = createVoiceTurns(send);
  turns.speechStarted('noise');
  turns.speechStopped();
  expect(turns.transcript('noise', ' \n ')).toBe(false);
  expect(send).not.toHaveBeenCalled();
  turns.speechStarted('question');
  turns.speechStopped();
  expect(turns.transcript('question', 'What services do you offer?')).toBe(true);
  turns.transcript('question', 'What services do you offer?');
  turns.responseDone();
  expect(send).toHaveBeenCalledOnce();
});

it('allows the greeting and a tool continuation, serializing against active responses', () => {
  const send = vi.fn();
  const turns = createVoiceTurns(send);
  turns.request();
  turns.responseCreated();
  turns.request();
  expect(send).toHaveBeenCalledOnce();
  turns.responseDone();
  expect(send).toHaveBeenCalledTimes(2);
  turns.responseDone();
  expect(send).toHaveBeenCalledTimes(2);
});

it('discards late transcripts and queued tool continuations after an interruption', () => {
  const send = vi.fn();
  const turns = createVoiceTurns(send);
  turns.speechStarted('old');
  turns.speechStopped();
  turns.transcript('old', 'Old question');
  turns.request();
  turns.speechStarted('new');
  expect(turns.transcript('old', 'Late old question')).toBe(false);
  turns.responseDone();
  expect(send).toHaveBeenCalledOnce();
  turns.transcript('new', 'New question');
  expect(send).toHaveBeenCalledOnce();
  turns.speechStopped();
  expect(send).toHaveBeenCalledTimes(2);
});

it('queues a valid transcript until an interrupted response finishes cancelling', () => {
  const send = vi.fn();
  const turns = createVoiceTurns(send);
  turns.request();
  turns.speechStarted('question');
  turns.speechStopped();
  turns.transcript('question', 'Hello');
  expect(send).toHaveBeenCalledOnce();
  turns.responseDone();
  turns.responseDone();
  expect(send).toHaveBeenCalledTimes(2);
});
