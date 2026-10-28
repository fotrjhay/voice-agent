import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ options: vi.fn(), query: vi.fn(), on: vi.fn() }));
vi.mock('pg', () => ({ Pool: class {
  constructor(options: unknown) { mocks.options(options); }
  query(sql: string, values: unknown[]) { return mocks.query(sql, values); }
  on(...args: unknown[]) { mocks.on(...args); }
} }));
import { query } from '../lib/db';
const state = globalThis as typeof globalThis & { voiceAdminPool?: unknown };
beforeEach(() => {
  delete state.voiceAdminPool; vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [] });
  vi.stubEnv('ADMIN_DATABASE_URL', 'postgresql://runtime:fake-password@db.example/test');
  vi.stubEnv('ADMIN_DATABASE_TLS', 'verify'); vi.stubEnv('ADMIN_DATABASE_CA', '');
});
afterEach(() => { delete state.voiceAdminPool; vi.unstubAllEnvs(); });
it('does not initialize a connection pool without explicit configuration', async () => {
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  await expect(query('SELECT 1')).rejects.toMatchObject({ status: 503 }); expect(mocks.options).not.toHaveBeenCalled();
});
it('requires verified TLS remotely even if a URL or operator flag requests otherwise', async () => {
  vi.stubEnv('ADMIN_DATABASE_URL', 'postgresql://runtime:fake-password@db.example/test?sslmode=no-verify');
  vi.stubEnv('ADMIN_DATABASE_TLS', 'disable'); vi.stubEnv('ADMIN_DATABASE_CA', 'certificate\\nline');
  await query('SELECT $1', ['value']);
  const options = mocks.options.mock.calls[0][0];
  expect(options.ssl).toEqual({ rejectUnauthorized: true, ca: 'certificate\nline' });
  expect(options.connectionString).not.toContain('sslmode');
  expect(options.max).toBe(2); expect(options.query_timeout).toBe(5000);
  expect(mocks.query).toHaveBeenCalledWith('SELECT $1', ['value']);
});
it('permits explicit non-TLS loopback development only', async () => {
  vi.stubEnv('ADMIN_DATABASE_URL', 'postgresql://runtime:fake@localhost/test'); vi.stubEnv('ADMIN_DATABASE_TLS', 'disable');
  await query('SELECT 1'); expect(mocks.options.mock.calls[0][0].ssl).toBe(false);
  delete state.voiceAdminPool; vi.stubEnv('NODE_ENV', 'production');
  await query('SELECT 1'); expect(mocks.options.mock.calls[1][0].ssl).toEqual({ rejectUnauthorized: true });
});
it('hides SQL, connection strings and provider failure details', async () => {
  mocks.query.mockRejectedValue(new Error('fake-password postgres internals'));
  await expect(query('SELECT settings FROM voice_agent_admin.business_settings')).rejects.toMatchObject({ status: 503, message: 'The settings database is unavailable. Check connectivity and the admin migration, then retry.' });
});
