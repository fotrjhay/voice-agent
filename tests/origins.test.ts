import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const refreshed = vi.hoisted(() => ({ enabled: false }));
vi.mock('@supabase/ssr', () => ({ createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (values: { name: string; value: string; options: { secure: boolean; sameSite: string; path: string } }[], headers: Record<string, string>) => void } }) => ({ auth: { getClaims: async () => {
  if (refreshed.enabled) options.cookies.setAll([{ name: 'sb-test-auth-token', value: 'refreshed-test-token', options: { secure: true, sameSite: 'lax', path: '/' } }], { Pragma: 'no-cache', 'Cache-Control': 'private, no-store' });
  return { data: null };
} } }) }));
import { proxy } from '../proxy';
import { sameOrigin, requestSite } from '../lib/origins';
beforeEach(() => {
  refreshed.enabled = false;
  vi.stubEnv('VOICE_APP_ORIGIN', 'https://voice.example'); vi.stubEnv('ADMIN_APP_ORIGIN', 'https://admin.example'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
});
afterEach(() => vi.unstubAllEnvs());
function request(host: string, path = '/', origin = `https://${host}`) { return new NextRequest(`https://${host}${path}`, { headers: { host, origin } }); }
it('identifies only the admin root for server rendering without redirect/rewrite loops', async () => {
  const root = await proxy(request('admin.example')); expect(root.headers.has('x-middleware-rewrite')).toBe(false);
  expect(requestSite(request('admin.example'))?.adminRoot).toBe(true);
  expect(requestSite(request('voice.example'))?.adminRoot).toBe(false);
  for (const path of ['/admin', '/admin/signin', '/admin/reset', '/api/auth/confirm']) expect((await proxy(request('admin.example', path))).headers.has('x-middleware-rewrite')).toBe(false);
  expect((await proxy(request('voice.example'))).headers.has('x-middleware-rewrite')).toBe(false);
});
it('rejects unknown hosts and cross-subdomain mutations instead of trusting a wildcard', async () => {
  expect((await proxy(request('evil.example'))).status).toBe(403); expect(requestSite(request('evil.example'))).toBeNull();
  expect(sameOrigin(request('admin.example', '/api/admin/settings', 'https://voice.example'))).toBe(false);
  expect(sameOrigin(request('voice.example', '/api/admin/settings'))).toBe(true);
  expect(sameOrigin(request('admin.example', '/api/session'), 'voice')).toBe(false);
});
it('keeps localhost exact-origin support when no hosted origins are configured', () => {
  for (const key of ['VOICE_APP_ORIGIN', 'ADMIN_APP_ORIGIN', 'APP_ORIGIN', 'VERCEL_ENV']) vi.stubEnv(key, '');
  expect(sameOrigin(new Request('http://localhost:3000/api/auth/login', { headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }))).toBe(true);
});
it('forwards refreshed SSR cookies downstream and back to the browser without public caching or a broad domain', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test'); refreshed.enabled = true;
  const input = request('admin.example', '/admin'); const response = await proxy(input);
  expect(input.cookies.get('sb-test-auth-token')?.value).toBe('refreshed-test-token');
  expect(response.cookies.get('sb-test-auth-token')?.value).toBe('refreshed-test-token');
  expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('set-cookie')).not.toContain('Domain=');
});
