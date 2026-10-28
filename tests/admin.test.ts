import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), query: vi.fn(), configured: vi.fn(), read: vi.fn(), save: vi.fn(), list: vi.fn(), upload: vi.fn(), login: vi.fn(), logout: vi.fn(), recover: vi.fn(), confirm: vi.fn(), reset: vi.fn() }));
vi.mock('../lib/db', () => ({ databaseConfigured: mocks.configured, query: mocks.query }));
vi.mock('../lib/settings', () => ({ readAdminSettings: mocks.read, saveBusinessSettings: mocks.save }));
vi.mock('../lib/documents', () => ({ listDocuments: mocks.list, uploadDocument: mocks.upload }));
vi.mock('../lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: mocks.user, signInWithPassword: mocks.login, signOut: mocks.logout, resetPasswordForEmail: mocks.recover, verifyOtp: mocks.confirm, updateUser: mocks.reset }, schema: () => ({ rpc: mocks.membership }) }) }));
import { requireAdmin, authConfigured } from '../lib/auth';
import { GET as getSettings, PUT as putSettings } from '../app/api/admin/settings/route';
import { GET as listFiles, POST as uploadFile } from '../app/api/admin/documents/route';
import { POST as authPost } from '../app/api/auth/[action]/route';
import { HttpError } from '../lib/http-error';
const id = '6f9e4709-8a18-46ee-8a98-f9b8d5ea4520';
function request(path: string, method = 'GET', body?: unknown, origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000${path}`, { method, headers: { host: 'localhost:3000', origin, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
function action(name: string, body: unknown, origin?: string) { return authPost(request(`/api/auth/${name}`, 'POST', body, origin), { params: Promise.resolve({ action: name }) }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.configured.mockReturnValue(true); mocks.query.mockResolvedValue({ rows: [{ hits: 1 }] });
  mocks.user.mockResolvedValue({ data: { user: { id } }, error: null }); mocks.membership.mockResolvedValue({ data: true, error: null });
  for (const mock of [mocks.login, mocks.logout, mocks.recover, mocks.confirm, mocks.reset]) mock.mockResolvedValue({ error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  for (const key of ['APP_ORIGIN', 'VOICE_APP_ORIGIN', 'ADMIN_APP_ORIGIN', 'VERCEL_ENV']) vi.stubEnv(key, '');
  vi.stubEnv('DOCUMENT_MAX_UPLOAD_BYTES', '3145728');
});
afterEach(() => { vi.unstubAllEnvs(); });
describe('Supabase admin access', () => {
  it('fails closed without required configuration', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ''); expect(authConfigured()).toBe(false);
    expect((await getSettings(request('/api/admin/settings'))).status).toBe(503); expect(mocks.user).not.toHaveBeenCalled();
  });
  it.each(['anonymous', 'expired', 'revoked', 'non-admin'])('denies all operations for %s', async kind => {
    if (kind === 'non-admin') mocks.membership.mockResolvedValue({ data: false, error: null });
    else mocks.user.mockResolvedValue({ data: { user: null }, error: { message: kind } });
    const expected = kind === 'non-admin' ? 403 : 401;
    for (const response of [await getSettings(request('/api/admin/settings')), await putSettings(request('/api/admin/settings', 'PUT', {})), await listFiles(request('/api/admin/documents')), await uploadFile(request('/api/admin/documents', 'POST', 'file'))]) expect(response.status).toBe(expected);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('checks server-verified identity and membership, never user metadata', async () => {
    mocks.user.mockResolvedValue({ data: { user: { id, user_metadata: { is_admin: true } } }, error: null });
    mocks.membership.mockResolvedValue({ data: false, error: null });
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    expect(mocks.user).toHaveBeenCalledOnce(); expect(mocks.membership).toHaveBeenCalledWith('is_admin');
  });
  it('returns an authorization outage instead of granting access', async () => {
    mocks.membership.mockResolvedValue({ data: null, error: { message: 'private database details' } });
    expect((await getSettings(request('/api/admin/settings'))).status).toBe(503); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('rejects CSRF and applies shared limits', async () => {
    expect((await putSettings(request('/api/admin/settings', 'PUT', {}, 'https://evil.example'))).status).toBe(403);
    mocks.query.mockResolvedValue({ rows: [{ hits: 21 }] });
    const limited = await putSettings(request('/api/admin/settings', 'PUT', {})); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('60');
  });
});
describe('password sign-in, recovery and sign-out', () => {
  it('signs in only a verified member and returns a fixed safe destination', async () => {
    expect(await (await action('login', { email: 'admin@example.com', password: 'correct-password' })).json()).toEqual({ redirect: '/admin' });
    expect(mocks.login).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'correct-password' });
    expect((await action('login', { email: 'admin@example.com', password: 'password', next: 'https://evil.example' })).status).toBe(400);
  });
  it('uses the same login error for wrong credentials and non-admin users', async () => {
    mocks.login.mockResolvedValueOnce({ error: { message: 'Email not found' } });
    const wrong = await action('login', { email: 'person@example.com', password: 'password' });
    mocks.membership.mockResolvedValue({ data: false, error: null });
    const nonAdmin = await action('login', { email: 'person@example.com', password: 'password' });
    expect(wrong.status).toBe(401); expect(await wrong.text()).toBe(await nonAdmin.text()); expect(mocks.logout).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('uses a non-enumerating recovery response and exact admin reset URL', async () => {
    vi.stubEnv('ADMIN_APP_ORIGIN', 'https://admin.example');
    const req = new Request('https://admin.example/api/auth/recover', { method: 'POST', headers: { host: 'admin.example', origin: 'https://admin.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.com' }) });
    mocks.recover.mockResolvedValue({ error: { message: 'not registered' } });
    const response = await authPost(req, { params: Promise.resolve({ action: 'recover' }) });
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('not registered');
    expect(mocks.recover).toHaveBeenCalledWith('admin@example.com', { redirectTo: 'https://admin.example/admin/reset' });
  });
  it('validates one-time recovery/invite links and membership before allowing a reset', async () => {
    const body = { token_hash: 'test-token-hash-at-least-20-characters', type: 'recovery' };
    expect((await action('confirm', body)).status).toBe(200); expect(mocks.confirm).toHaveBeenCalledWith(body);
    mocks.confirm.mockResolvedValue({ error: { message: 'expired' } });
    expect((await action('confirm', body)).status).toBe(400);
    expect((await action('confirm', { ...body, type: 'signup' })).status).toBe(400);
    expect((await action('reset', { password: 'new-strong-password' })).status).toBe(200); expect(mocks.reset).toHaveBeenCalledWith({ password: 'new-strong-password' });
    expect(mocks.logout).toHaveBeenCalledWith({ scope: 'global' });
  });
  it('denies unauthorized password changes', async () => {
    mocks.membership.mockResolvedValue({ data: false, error: null });
    expect((await action('reset', { password: 'new-strong-password' })).status).toBe(403); expect(mocks.reset).not.toHaveBeenCalled();
  });
  it('signs out even during a rate-limit database outage while retaining origin protection', async () => {
    mocks.query.mockRejectedValue(new Error('offline'));
    expect((await action('logout', {})).status).toBe(200); expect(mocks.query).not.toHaveBeenCalled();
    expect((await action('logout', {}, 'https://evil.example')).status).toBe(403);
  });
});
describe('admin operations', () => {
  it('reads and saves through the authorized user client, including concurrency conflicts', async () => {
    mocks.read.mockResolvedValue({ settings: {}, version: 1 }); expect((await getSettings(request('/api/admin/settings'))).status).toBe(200);
    mocks.save.mockRejectedValue(new HttpError(409, 'Reload settings.'));
    expect((await putSettings(request('/api/admin/settings', 'PUT', { settings: {}, version: 1 }))).status).toBe(409);
    expect((await putSettings(request('/api/admin/settings', 'PUT', 'x'.repeat(65537)))).status).toBe(400);
  });
  it('lists with pagination and refuses client destination selection', async () => {
    mocks.list.mockResolvedValue({ files: [], nextPageToken: 'next' });
    expect((await listFiles(request('/api/admin/documents?pageToken=next'))).status).toBe(200); expect(mocks.list).toHaveBeenCalledWith('next');
    expect((await listFiles(request('/api/admin/documents?folder=other'))).status).toBe(400);
  });
  it('returns uploaded-only Dropbox status and forwards a stable retry key with the verified UUID', async () => {
    mocks.upload.mockResolvedValue({ id: 'id:dropbox-id', provider: 'dropbox', sourceId: 'primary:document' });
    const input = request('/api/admin/documents', 'POST', 'business text'); input.headers.set('x-file-name', 'guide.txt'); input.headers.set('Content-Type', 'text/plain'); input.headers.set('x-upload-key', id);
    const response = await uploadFile(input); expect(response.status).toBe(201); expect(await response.text()).toContain('Uploaded to Dropbox. Search availability is not yet tracked.');
    expect(mocks.upload.mock.calls[0].slice(1)).toEqual([id, id]);
  });
  it('bounds actual body bytes and rejects wrong content and client-selected paths', async () => {
    vi.stubEnv('DOCUMENT_MAX_UPLOAD_BYTES', '5');
    expect((await uploadFile(request('/api/admin/documents', 'POST', '123456'))).status).toBe(413);
    const input = request('/api/admin/documents', 'POST', 'fake'); input.headers.set('x-file-name', 'guide.pdf'); input.headers.set('Content-Type', 'application/pdf');
    expect((await uploadFile(input)).status).toBe(400);
    expect((await uploadFile(request('/api/admin/documents?folder=other', 'POST', 'test'))).status).toBe(400); expect(mocks.upload).not.toHaveBeenCalled();
  });
});
