import 'server-only';
import { HttpError } from './http-error';

export type VoiceBackend = 'pipecat' | 'openai_direct';

export function voiceBackend(): VoiceBackend {
  const backend = process.env.VOICE_BACKEND ?? 'pipecat';
  if (backend !== 'pipecat' && backend !== 'openai_direct') throw new HttpError(503, 'VOICE_BACKEND must be pipecat or openai_direct.');
  return backend;
}
