import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../lib/settings', () => ({ getBusinessSettings: vi.fn().mockResolvedValue({
  settings: { businessName: 'Test business', greeting: 'Hello', tone: 'friendly', instructions: 'Approved instructions', supportEmail: '', supportPhone: '', supportUrl: '' }, version: 7,
}), environmentSettings: vi.fn() }));
import { GET } from '../app/api/internal/business/route';

afterEach(() => vi.unstubAllEnvs());
it('keeps shared settings behind a server credential and returns a business snapshot', async () => {
  vi.stubEnv('BUSINESS_CONFIG_KEY', 'k'.repeat(32)); vi.stubEnv('BUSINESS_ID', 'business-one');
  expect((await GET(new Request('https://website.test/api/internal/business'))).status).toBe(401);
  const response = await GET(new Request('https://website.test/api/internal/business', { headers: { Authorization: `Bearer ${'k'.repeat(32)}` } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.business_id).toBe('business-one'); expect(body.version).toBe(7);
  expect(body.agent_config.instructions).toContain('Approved instructions');
  expect(body.agent_config.greeting).toBe('Hello');
  expect(JSON.stringify(body)).not.toContain('k'.repeat(32));
  expect(response.headers.get('cache-control')).toContain('no-store');
});
