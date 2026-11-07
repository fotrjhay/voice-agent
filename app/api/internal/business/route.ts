import { timingSafeEqual } from 'node:crypto';
import { assistantInstructions } from '../../../../lib/assistant-instructions';
import { getBusinessSettings } from '../../../../lib/settings';
import { json } from '../../../../lib/server';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  const key = process.env.BUSINESS_CONFIG_KEY;
  const supplied = Buffer.from(request.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${key || ''}`);
  if (!key || key.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ error: 'Unauthorized' }, 401);
  const { settings, version } = await getBusinessSettings();
  return json({ business_id: process.env.BUSINESS_ID || 'primary', version,
    agent_config: { instructions: assistantInstructions(settings, 'pipecat'), greeting: settings.greeting } });
}
