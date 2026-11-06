import 'server-only';
import { z } from 'zod';
import { assistantInstructions } from './assistant-instructions';
import { HttpError } from './http-error';
import { json, limitedText } from './server';
import { getBusinessSettings } from './settings';
import { relevantConfig } from './voice-diagnostics';
import { voiceBackend } from './voice-backend';

const iceServer = z.object({
  urls: z.union([z.string().max(1000), z.array(z.string().max(1000)).min(1).max(8)])
    .refine(value => (Array.isArray(value) ? value : [value]).every(url => /^(stun|turn|turns):[^\s]+$/.test(url))),
  username: z.string().max(1000).optional(), credential: z.string().max(1000).optional(),
});
const iceResponse = z.object({
  iceServers: z.array(iceServer).max(16), iceTransportPolicy: z.enum(['all', 'relay']),
  settings_handoff_version: z.literal(1), voice_config: z.unknown().optional(),
});
const offerSchema = z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(32000) }).strict();
const answerSchema = z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(64000), settings_applied: z.literal(true) });

async function upstream(request: Request, path: 'ice' | 'offer', body?: unknown) {
  const configured = process.env.PIPECAT_SERVICE_URL;
  const token = process.env.PIPECAT_SERVICE_TOKEN;
  if (!configured || !token) throw new HttpError(503, 'Configure PIPECAT_SERVICE_URL and PIPECAT_SERVICE_TOKEN on the website server.');
  let base: URL;
  try {
    base = new URL(configured);
    const local = process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(local && base.protocol === 'http:') || base.username || base.password || base.search || base.hash || !['', '/'].includes(base.pathname)) throw new Error('url');
  } catch { throw new HttpError(503, 'PIPECAT_SERVICE_URL must be an HTTPS origin.'); }
  const response = await fetch(new URL(`/api/${path}`, base), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)]), cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status === 429 ? 429 : 503, response.status === 429
      ? 'Too many voice connection attempts. Wait one minute and retry.'
      : 'Pipecat is unavailable or busy. Check the service configuration and retry.');
  }
  return JSON.parse(await limitedText(response, path === 'offer' ? 96000 : 24000));
}

function failure(error: unknown) {
  return error instanceof HttpError ? json({ error: error.message }, error.status)
    : json({ error: 'Pipecat could not prepare the connection. Check that the website integration update is deployed and retry.' }, 503);
}

export async function createPipecatSession(request: Request, includeDiagnostics = false) {
  try {
    const data = iceResponse.parse(await upstream(request, 'ice'));
    return json({ backend: 'pipecat', rtcConfig: { iceServers: data.iceServers, iceTransportPolicy: data.iceTransportPolicy },
      ...(includeDiagnostics ? { diagnostics: { requested: {}, reported: relevantConfig(data.voice_config) } } : {}) });
  } catch (error) { return failure(error); }
}

export async function createPipecatOffer(request: Request) {
  try {
    if (voiceBackend() !== 'pipecat') throw new HttpError(409, 'The voice backend changed. Restart the conversation.');
    let offer: z.infer<typeof offerSchema>;
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('type');
      offer = offerSchema.parse(JSON.parse(await limitedText(request, 40000)));
    } catch { throw new HttpError(400, 'Provide only a valid browser SDP offer.'); }
    const { settings } = await getBusinessSettings();
    const answer = answerSchema.parse(await upstream(request, 'offer', {
      ...offer, agent_config: { instructions: assistantInstructions(settings, 'pipecat'), greeting: settings.greeting },
    }));
    return json({ type: answer.type, sdp: answer.sdp });
  } catch (error) { return failure(error); }
}
