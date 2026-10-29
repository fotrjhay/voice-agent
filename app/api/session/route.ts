import { json, sameOriginRequest } from '../../../lib/server';
import { createVoiceSession } from '../../../lib/voice-session';

export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: 'Same-origin access required. Check the server APP_ORIGIN configuration.' }, 403);
  if (request.headers.has('x-voice-diagnostics')) return json({ error: 'Diagnostics require the authorized admin voice test.' }, 403);
  return createVoiceSession(request);
}
