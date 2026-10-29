import { authorizeVoiceDiagnostics } from '../../../../../lib/diagnostic-access';
import { adminError } from '../../../../../lib/admin-response';
import { json, readQuery, searchKnowledge } from '../../../../../lib/server';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    await authorizeVoiceDiagnostics(request);
    let query: string;
    try { ({ query } = await readQuery(request)); }
    catch { return json({ error: 'Provide only a query of 1–1000 characters.' }, 400); }
    return json(await searchKnowledge(query, request.signal));
  } catch (error) { return adminError(error); }
}
