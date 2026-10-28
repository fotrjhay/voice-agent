import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { supabaseConfig } from './config';
import { requestSite } from '../origins';

export async function createSupabaseServer() {
  const config = supabaseConfig();
  const jar = await cookies();
  const incoming = await headers();
  const site = requestSite(new Request('http://localhost/', { headers: incoming }));
  return createServerClient(config.url, config.key, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: site?.origin.startsWith('https://') ?? process.env.NODE_ENV === 'production' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); }
        catch { /* Server Components cannot write cookies; proxy.ts handles refresh. */ }
      },
    },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) }) },
  });
}
export type SupabaseServer = Awaited<ReturnType<typeof createSupabaseServer>>;
