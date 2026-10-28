import 'server-only';
import { databaseConfigured } from './db';
import { HttpError } from './http-error';
import { rateLimit } from './rate-limit';
import { sameOrigin } from './origins';
import { supabaseConfig } from './supabase/config';
import { createSupabaseServer, type SupabaseServer } from './supabase/server';

export function authConfigured() {
  try { supabaseConfig(); return databaseConfigured(); } catch { return false; }
}
export async function verifiedAdmin(client: SupabaseServer) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Sign in again to continue.');
  const membership = await client.schema('voice_agent_admin').rpc('is_admin');
  if (membership.error) throw new HttpError(503, 'Admin authorization is unavailable. Check the Supabase migration and schema configuration.');
  if (membership.data !== true) throw new HttpError(403, 'Administrator access is required.');
  return { user: data.user, client };
}
export async function requireAdmin() {
  if (!authConfigured()) throw new HttpError(503, 'Admin access is not configured. Ask the operator to complete setup.');
  return verifiedAdmin(await createSupabaseServer());
}
export async function authorizeAdmin(request: Request, bucket: 'admin-read' | 'admin-write' | 'admin-upload') {
  const admin = await requireAdmin();
  if (request.method !== 'GET' && !sameOrigin(request)) throw new HttpError(403, 'Same-origin access required.');
  await rateLimit(bucket, bucket === 'admin-upload' ? 10 : bucket === 'admin-write' ? 20 : 60);
  return admin;
}
