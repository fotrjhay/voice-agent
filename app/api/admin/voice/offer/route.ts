import { authorizeVoiceDiagnostics } from '../../../../../lib/diagnostic-access';
import { adminError } from '../../../../../lib/admin-response';
import { createPipecatOffer } from '../../../../../lib/pipecat';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    await authorizeVoiceDiagnostics(request);
    return createPipecatOffer(request);
  } catch (error) { return adminError(error); }
}
