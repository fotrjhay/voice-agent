import { authorizeAdmin } from '../../../../lib/auth';
import { adminError } from '../../../../lib/admin-response';
import { readAdminSettings, saveBusinessSettings } from '../../../../lib/settings';
import { json, limitedText } from '../../../../lib/server';
import { HttpError } from '../../../../lib/http-error';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const { client } = await authorizeAdmin(request, 'admin-read');
    return json(await readAdminSettings(client));
  } catch (error) { return adminError(error); }
}
export async function PUT(request: Request) {
  try {
    const { client } = await authorizeAdmin(request, 'admin-write');
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON settings.');
    let input: unknown;
    try { input = JSON.parse(await limitedText(request, 65536)); }
    catch { throw new HttpError(400, 'Settings must be valid JSON within 64 KB.'); }
    return json(await saveBusinessSettings(input, client));
  } catch (error) { return adminError(error); }
}
