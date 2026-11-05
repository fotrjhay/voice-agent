import { json, sameOriginRequest } from '../../../lib/server';
import { createPipecatOffer } from '../../../lib/pipecat';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: 'Same-origin access required.' }, 403);
  if (request.headers.has('x-voice-diagnostics')) return json({ error: 'Diagnostics require the authorized admin voice test.' }, 403);
  return createPipecatOffer(request);
}
