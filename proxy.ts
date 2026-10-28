import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { requestSite } from './lib/origins';
import { supabaseConfig } from './lib/supabase/config';

export async function proxy(request: NextRequest) {
  const site = requestSite(request);
  if (!site) return NextResponse.json({ error: 'Host is not configured.' }, { status: 403 });
  // The root server page renders the protected admin component on the admin host.
  // This avoids internal/external rewrite ambiguity when Next normalizes local URLs.
  const respond = () => NextResponse.next({ request });
  let response = respond();
  const path = site.adminRoot && request.nextUrl.pathname === '/' ? '/admin' : request.nextUrl.pathname;
  if (!(path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/') || path.startsWith('/api/auth/'))) return response;
  response.headers.set('Cache-Control', 'private, no-store');
  let config;
  try { config = supabaseConfig(); } catch { return response; }
  const client = createServerClient(config.url, config.key, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: site.origin.startsWith('https://') },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, cacheHeaders) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        const previous = response.cookies.getAll();
        response = respond();
        previous.forEach(cookie => response.cookies.set(cookie));
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(cacheHeaders || {}).forEach(([name, value]) => response.headers.set(name, value));
        response.headers.set('Cache-Control', 'private, no-store');
      },
    },
    global: { fetch: (url, init) => fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) }) },
  });
  try { await client.auth.getClaims(); }
  catch { return NextResponse.json({ error: 'Sign-in service unavailable. Retry shortly.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } }); }
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
