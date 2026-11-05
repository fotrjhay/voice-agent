import { authorizeVoiceDiagnostics } from '../../../../../lib/diagnostic-access';
import { createVoiceSession } from '../../../../../lib/voice-session';
import { adminError } from '../../../../../lib/admin-response';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    await authorizeVoiceDiagnostics(request);
    return createVoiceSession(request, true);
  } catch (error) { return adminError(error); }
}
