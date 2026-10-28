import { z } from 'zod';
import { authConfigured, verifiedAdmin, requireAdmin } from '../../../../lib/auth';
import { createSupabaseServer } from '../../../../lib/supabase/server';
import { rateLimit } from '../../../../lib/rate-limit';
import { sameOrigin, requestSite, appOrigins } from '../../../../lib/origins';
import { json, limitedText } from '../../../../lib/server';
import { HttpError } from '../../../../lib/http-error';
import { adminError } from '../../../../lib/admin-response';

export const runtime = 'nodejs';
const email = z.email().max(254);
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    if (!authConfigured()) throw new HttpError(503, 'Sign-in is not configured.');
    if (!sameOrigin(request)) throw new HttpError(403, 'Same-origin access required.');
    const { action } = await context.params;
    if (!['login', 'logout', 'recover', 'confirm', 'reset'].includes(action)) throw new HttpError(404, 'Not found.');
    if (action !== 'logout') await rateLimit('auth', 30);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
    let input: unknown;
    try { input = JSON.parse(await limitedText(request, 8192)); } catch { throw new HttpError(400, 'Invalid request.'); }
    const client = await createSupabaseServer();
    if (action === 'logout') {
      const { error } = await client.auth.signOut({ scope: 'global' });
      if (error && error.status !== 401 && error.status !== 403) throw new HttpError(503, 'Could not sign out. Retry.');
      return json({ redirect: '/admin/signin' });
    }
    if (action === 'login') {
      const credentials = z.object({ email, password: z.string().min(1).max(128) }).strict().parse(input);
      const { error } = await client.auth.signInWithPassword(credentials);
      if (error) throw new HttpError(401, 'Sign-in failed. Check your credentials or contact the operator.');
      try { await verifiedAdmin(client); }
      catch { await client.auth.signOut({ scope: 'local' }); throw new HttpError(401, 'Sign-in failed. Check your credentials or contact the operator.'); }
      return json({ redirect: '/admin' });
    }
    if (action === 'recover') {
      const { email: address } = z.object({ email }).strict().parse(input);
      const origin = appOrigins().admin?.origin || requestSite(request)!.origin;
      await client.auth.resetPasswordForEmail(address, { redirectTo: `${origin}/admin/reset` });
      return json({ message: 'If this address is eligible, a recovery email will arrive shortly.' });
    }
    if (action === 'confirm') {
      const token = z.object({ token_hash: z.string().min(20).max(2048), type: z.enum(['recovery', 'invite']) }).strict().parse(input);
      const { error } = await client.auth.verifyOtp(token);
      if (error) throw new HttpError(400, 'The recovery link is invalid or expired. Request a new link.');
      try { await verifiedAdmin(client); }
      catch { await client.auth.signOut({ scope: 'local' }); throw new HttpError(400, 'The recovery link is invalid or expired. Request a new link.'); }
      return json({ verified: true });
    }
    const { password } = z.object({ password: z.string().min(12).max(128) }).strict().parse(input);
    await requireAdmin();
    const { error } = await client.auth.updateUser({ password });
    if (error) throw new HttpError(400, 'The password could not be changed. Use a new strong password or request a new recovery link.');
    await client.auth.signOut({ scope: 'global' });
    return json({ redirect: '/admin/signin' });
  } catch (error) { return adminError(error); }
}
