import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ configured: vi.fn(), query: vi.fn() }));
vi.mock('../lib/db', () => ({ databaseConfigured: db.configured, query: db.query }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: 'localhost:3000' }) }));
vi.mock('../app/admin/page', () => ({ default: () => null }));
import { environmentSettings, getBusinessSettings, saveBusinessSettings } from '../lib/settings';
import { settingsSchema } from '../lib/settings-schema';
import { POST as createSession } from '../app/api/session/route';
import { ASSISTANT_BASELINE } from '../lib/assistant-instructions';
import Page from '../app/page';
import { HttpError } from '../lib/http-error';
import type { SupabaseServer } from '../lib/supabase/server';

beforeEach(() => {
  vi.stubEnv('VOICE_BACKEND', 'openai_direct');
  vi.clearAllMocks(); db.configured.mockReturnValue(false);
  for (const key of ['BUSINESS_NAME', 'AGENT_GREETING', 'AGENT_INSTRUCTIONS', 'AGENT_TONE', 'SUPPORT_EMAIL', 'SUPPORT_PHONE', 'SUPPORT_URL', 'APP_ORIGIN', 'VOICE_APP_ORIGIN', 'ADMIN_APP_ORIGIN', 'VERCEL_ENV']) vi.stubEnv(key, '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const saved = { businessName: 'Saved business', greeting: 'Welcome to our desk.', tone: 'professional', instructions: 'Help with services.\nAsk one clarification.', supportEmail: 'help@example.com', supportPhone: '+234 12345 67890', supportUrl: 'https://example.com/help' };
const date = new Date('2026-10-27T12:00:00Z');
describe('business settings', () => {
  it('retains no-database voice mode without making a query', async () => {
    vi.stubEnv('BUSINESS_NAME', 'Environment business');
    const result = await getBusinessSettings();
    expect(result).toMatchObject({ source: 'environment', settings: { businessName: 'Environment business' } });
    expect(db.query).not.toHaveBeenCalled();
  });
  it('uses defaults before the first save, without inserting or overwriting data', async () => {
    db.configured.mockReturnValue(true); db.query.mockResolvedValue({ rows: [] });
    expect((await getBusinessSettings()).source).toBe('environment');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/^SELECT /);
  });
  it('reads saved settings on every call rather than caching or replacing with environment data', async () => {
    db.configured.mockReturnValue(true);
    db.query.mockResolvedValueOnce({ rows: [{ settings: saved, updated_at: date, version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ settings: { ...saved, businessName: 'New name' }, updated_at: date, version: 1 }] });
    expect((await getBusinessSettings()).settings.businessName).toBe('Saved business');
    expect((await getBusinessSettings()).settings.businessName).toBe('New name');
  });
  it('does not silently fall back when a configured database fails or contains invalid settings', async () => {
    db.configured.mockReturnValue(true); db.query.mockRejectedValueOnce(new HttpError(503, 'Database unavailable'));
    await expect(getBusinessSettings()).rejects.toMatchObject({ status: 503 });
    db.query.mockResolvedValue({ rows: [{ settings: {}, updated_at: date, version: 1 }] });
    await expect(getBusinessSettings()).rejects.toMatchObject({ status: 503 });
  });
  it('writes through the authorized user RPC with an expected version and preserves multiline values', async () => {
    const single = vi.fn().mockResolvedValue({ data: { settings: saved, version: 2, updated_at: date.toISOString() }, error: null });
    const rpc = vi.fn().mockReturnValue({ single });
    const client = { schema: vi.fn().mockReturnValue({ rpc }) } as unknown as SupabaseServer;
    expect(await saveBusinessSettings({ settings: saved, version: 1 }, client)).toMatchObject({ settings: saved, version: 2 });
    expect(rpc).toHaveBeenCalledWith('save_settings', { new_settings: saved, expected_version: 1 });
    expect(db.query).not.toHaveBeenCalled();
    single.mockResolvedValue({ data: null, error: { code: 'P0001' } });
    await expect(saveBusinessSettings({ settings: saved, version: 1 }, client)).rejects.toMatchObject({ status: 409 });
  });
  it.each([
    { businessName: '' }, { businessName: 'x'.repeat(121) }, { greeting: 'x'.repeat(501) },
    { instructions: 'x'.repeat(12001) }, { tone: 'invented' }, { supportEmail: 'invalid' },
    { supportPhone: '+----' }, { supportPhone: '<script>' }, { supportUrl: 'javascript:alert(1)' },
    { supportUrl: 'http://example.com' }, { instructions: 'bad\0text' }, { credentials: 'not-allowed' },
  ])('rejects invalid configuration %j', patch => {
    expect(settingsSchema.safeParse({ ...saved, ...patch }).success).toBe(false);
  });
  it('rejects invalid environment defaults instead of failing open', () => {
    vi.stubEnv('AGENT_TONE', 'unsupported'); expect(environmentSettings).toThrow(HttpError);
  });
  it('applies saved settings and baseline to a new Realtime session and public label', async () => {
    db.configured.mockReturnValue(true); db.query.mockResolvedValue({ rows: [{ settings: saved, updated_at: date, version: 1 }] });
    vi.stubEnv('OPENAI_API_KEY', 'test-server-key');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ value: 'ek_test' })); vi.stubGlobal('fetch', fetcher);
    const response = await createSession(new Request('http://localhost:3000/api/session', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }));
    expect(response.status).toBe(200);
    const config = JSON.parse(fetcher.mock.calls[0][1].body).session;
    expect(config.instructions).toContain(saved.businessName);
    expect(config.instructions).toContain(saved.instructions);
    expect(config.instructions).toContain(saved.supportEmail);
    expect(config.instructions).toContain('professional');
    expect(config.instructions.endsWith(ASSISTANT_BASELINE)).toBe(true);
    expect(config.tools.map((tool: { name: string }) => tool.name)).toEqual(['search_knowledge']);
    expect((await Page()).props.business).toBe(saved.businessName);
  });
  it('returns a clear settings failure before contacting OpenAI', async () => {
    db.configured.mockReturnValue(true); db.query.mockRejectedValue(new HttpError(503, 'The settings database is unavailable.'));
    vi.stubEnv('OPENAI_API_KEY', 'test-server-key'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await createSession(new Request('http://localhost:3000/api/session', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }));
    expect(response.status).toBe(503); expect(await response.text()).toContain('settings database');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
