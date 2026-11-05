import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), query: vi.fn(), configured: vi.fn(), settings: vi.fn() }));
vi.mock('../lib/db', () => ({ databaseConfigured: mocks.configured, query: mocks.query }));
vi.mock('../lib/settings', () => ({ getBusinessSettings: mocks.settings, environmentSettings: vi.fn() }));
vi.mock('../lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: mocks.user }, schema: () => ({ rpc: mocks.membership }) }) }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { POST as session } from '../app/api/admin/voice/session/route';
import { POST as offer } from '../app/api/admin/voice/offer/route';
import { POST as search } from '../app/api/admin/voice/search/route';
import { POST as publicSession } from '../app/api/session/route';
import VoiceTestPage from '../app/admin/voice-test/page';
import Voice from '../app/voice';

function request(path = 'session', optIn = true, origin = 'https://admin.example') {
  return new Request(`https://admin.example/api/admin/voice/${path}`, { method: 'POST', headers: {
    host: 'admin.example', origin, 'Content-Type': 'application/json', ...(optIn ? { 'x-voice-diagnostics': '1' } : {}),
  }, ...(path === 'search' ? { body: JSON.stringify({ query: 'Business question' }) } : {}) });
}
beforeEach(() => {
  vi.stubEnv('VOICE_BACKEND', 'openai_direct');
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VOICE_DIAGNOSTICS_ENABLED', 'true');
  vi.stubEnv('VOICE_APP_ORIGIN', 'https://voice.example'); vi.stubEnv('ADMIN_APP_ORIGIN', 'https://admin.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  vi.stubEnv('OPENAI_API_KEY', 'server-key'); vi.stubEnv('RAG_WRAPPER_URL', 'https://wrapper.example'); vi.stubEnv('RAG_WRAPPER_API_KEY', 'wrapper-key');
  mocks.configured.mockReturnValue(true); mocks.query.mockResolvedValue({ rows: [{ hits: 1 }] });
  mocks.user.mockResolvedValue({ data: { user: { id: 'admin-id' } }, error: null });
  mocks.membership.mockResolvedValue({ data: true, error: null });
  mocks.settings.mockResolvedValue({ settings: { businessName: 'Business', greeting: 'Welcome', tone: 'friendly', instructions: 'Business prompt', supportEmail: '', supportPhone: '', supportUrl: '' } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(['', 'false', '1', 'TRUE'])('denies page and both APIs with feature flag %j', async flag => {
  vi.stubEnv('VOICE_DIAGNOSTICS_ENABLED', flag);
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const [handler, path] of [[session, 'session'], [search, 'search'], [offer, 'offer']] as const) {
    const response = await handler(request(path));
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
  await expect(VoiceTestPage()).rejects.toThrow('NOT_FOUND');
  expect(mocks.user).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});

it('requires explicit opt-in for both APIs even for an admin', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  expect((await session(request('session', false))).status).toBe(400);
  expect((await search(request('search', false))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['anonymous', 'expired', 'revoked', 'non-admin', 'membership-outage', 'forged-metadata'])('denies %s before OpenAI or retrieval', async kind => {
  if (kind === 'non-admin' || kind === 'forged-metadata') {
    mocks.user.mockResolvedValue({ data: { user: { id: 'user', user_metadata: { is_admin: true } } }, error: null });
    mocks.membership.mockResolvedValue({ data: false, error: null });
  } else if (kind === 'membership-outage') mocks.membership.mockResolvedValue({ data: null, error: { message: 'PRIVATE' } });
  else mocks.user.mockResolvedValue({ data: { user: null }, error: { message: kind } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const expected = ['non-admin', 'forged-metadata'].includes(kind) ? 403 : kind === 'membership-outage' ? 503 : 401;
  for (const [handler, path] of [[session, 'session'], [search, 'search'], [offer, 'offer']] as const) {
    const response = await handler(request(path));
    expect(response.status).toBe(expected); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).not.toContain('PRIVATE');
  }
  if (expected === 401) await expect(VoiceTestPage()).rejects.toThrow('REDIRECT:/admin/signin');
  else expect(renderToStaticMarkup(await VoiceTestPage())).not.toContain('I opt in');
  expect(fetcher).not.toHaveBeenCalled(); expect(mocks.settings).not.toHaveBeenCalled();
});

it('fails closed during auth setup failure and rejects cross-origin or unconfigured hosts', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  mocks.configured.mockReturnValue(false);
  expect((await session(request())).status).toBe(503);
  mocks.configured.mockReturnValue(true);
  expect((await session(request('session', true, 'https://voice.example'))).status).toBe(403);
  expect((await search(request('search', true, 'https://evil.example'))).status).toBe(403);
  const wrongHost = request(); wrongHost.headers.set('host', 'evil.example');
  expect((await session(wrongHost)).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});

it('authorizes production session reports on the existing admin origin and filters private fields', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ value: 'ek_temporary', session: {
    model: 'provider-model', max_output_tokens: 800, instructions: 'PRIVATE', client_secret: 'PRIVATE',
  } })); vi.stubGlobal('fetch', fetcher);
  const response = await session(request());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  const data = await response.json();
  expect(data.diagnostics.requested.max_output_tokens).toBe(800);
  expect(data.diagnostics.reported).toMatchObject({ model: 'provider-model', max_output_tokens: 800 });
  expect(JSON.stringify(data)).not.toMatch(/PRIVATE|server-key|wrapper-key|Business prompt/);
  expect(mocks.membership).toHaveBeenCalledWith('is_admin');
  expect(mocks.query).toHaveBeenCalled();
  const config = JSON.parse(fetcher.mock.calls[0][1].body).session;
  expect(config.max_output_tokens).toBe(800);
  expect(config.audio.input.turn_detection).toEqual({ type: 'server_vad', create_response: false, interrupt_response: true, silence_duration_ms: 600 });
});

it('rechecks authorization and opt-in for retrieval with unchanged bounds', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [{ id: 'p', text: 'x'.repeat(2100) }] })); vi.stubGlobal('fetch', fetcher);
  const response = await search(request('search'));
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await response.json()).passages[0].text).toHaveLength(2000);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ query: 'Business question', limit: 5 });
  mocks.membership.mockResolvedValue({ data: false, error: null });
  expect((await search(request('search'))).status).toBe(403);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('keeps the public session ordinary and never returns diagnostics', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ value: 'ek_public', session: { model: 'test', max_output_tokens: 800 } })); vi.stubGlobal('fetch', fetcher);
  const input = new Request('https://voice.example/api/session', { method: 'POST', headers: { host: 'voice.example', origin: 'https://voice.example' } });
  expect(await (await publicSession(input)).json()).toEqual({ value: 'ek_public' });
  expect(mocks.user).not.toHaveBeenCalled();
  input.headers.set('x-voice-diagnostics', '1');
  expect((await publicSession(input)).status).toBe(403);
  expect(fetcher).toHaveBeenCalledOnce();
});

it('renders an opt-in test page only after verification and no diagnostics UI on the public component', async () => {
  const page = renderToStaticMarkup(await VoiceTestPage());
  expect(page).toContain('Authorized voice diagnostics'); expect(page).toContain('I opt in');
  expect(page).toMatch(/disabled=""[^>]*>.*?Start conversation/);
  expect(mocks.user).toHaveBeenCalledOnce(); expect(mocks.membership).toHaveBeenCalledOnce();
  expect(renderToStaticMarkup(<Voice business="Business" />)).not.toContain('voice diagnostics');
});
