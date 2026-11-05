import 'server-only';
import { json, sessionConfig } from './server';
import { getBusinessSettings } from './settings';
import { HttpError } from './http-error';
import { relevantConfig } from './voice-diagnostics';
import { voiceBackend } from './voice-backend';
import { createPipecatSession } from './pipecat';

// Callers enforce public-origin checks or verified admin diagnostics access.
export async function createVoiceSession(request: Request, includeDiagnostics = false) {
  try {
    if (voiceBackend() === 'pipecat') return createPipecatSession(request, includeDiagnostics);
    if (!process.env.OPENAI_API_KEY) return json({ error: 'Configure the server OpenAI API key first.' }, 503);
    const { settings } = await getBusinessSettings();
    const config = sessionConfig(settings);
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session: config }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), cache: 'no-store',
    });
    if (!response.ok) { await response.body?.cancel(); return json({ error: 'Could not create voice session. Check server configuration and account access.' }, 502); }
    const data = await response.json();
    if (typeof data.value !== 'string') throw new Error('credential');
    const diagnostics = includeDiagnostics ? { requested: relevantConfig(config), reported: relevantConfig(data.session) } : undefined;
    return json({ value: data.value, ...(diagnostics ? { diagnostics } : {}) });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: 'Voice service unavailable. Please try again.' }, 502);
  }
}
