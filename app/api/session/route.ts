import { json, sameOriginRequest, sessionConfig } from '../../../lib/server';
import { getBusinessSettings } from '../../../lib/settings';
import { HttpError } from '../../../lib/http-error';
export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: 'Same-origin access required. Check the server APP_ORIGIN configuration.' }, 403);
  if (!process.env.OPENAI_API_KEY) return json({ error: 'Configure the server OpenAI API key first.' }, 503);
  try {
    const { settings } = await getBusinessSettings();
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { anchor: 'created_at', seconds: 60 }, session: sessionConfig(settings) }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]), cache: 'no-store',
    });
    if (!response.ok) { await response.body?.cancel(); return json({ error: 'Could not create voice session. Check server configuration and account access.' }, 502); }
    const data = await response.json();
    if (typeof data.value !== 'string') throw new Error('credential');
    return json({ value: data.value });
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    return json({ error: 'Voice service unavailable. Please try again.' }, 502);
  }
}
