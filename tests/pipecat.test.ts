import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ settings: vi.fn() }));
vi.mock('../lib/settings', () => ({ getBusinessSettings: mocks.settings, environmentSettings: vi.fn() }));
import { POST as session } from '../app/api/session/route';
import { POST as offer } from '../app/api/offer/route';
import { ASSISTANT_BASELINE } from '../lib/assistant-instructions';
import { voiceBackend } from '../lib/voice-backend';
import { pipecatEvent, waitForIce } from '../lib/pipecat-client';

const business = { businessName: 'Saved business', greeting: 'Saved greeting', tone: 'professional', instructions: 'Use saved knowledge.', supportEmail: '', supportPhone: '', supportUrl: '' };
const config = { settings_handoff_version: 1, iceServers: [{ urls: 'turn:relay.example:443?transport=tcp', username: 'temporary', credential: 'ephemeral' }], iceTransportPolicy: 'relay', voice_config: { model: 'configured-model', instructions: 'PRIVATE' } };
function input(path = 'session', data?: unknown, origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/${path}`, { method: 'POST', headers: {
    host: 'localhost:3000', origin, 'Content-Type': 'application/json',
  }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
beforeEach(() => {
  vi.stubEnv('VOICE_BACKEND', 'pipecat'); vi.stubEnv('PIPECAT_SERVICE_URL', 'https://pipe.example'); vi.stubEnv('PIPECAT_SERVICE_TOKEN', 'permanent-service-token');
  vi.stubEnv('VOICE_APP_ORIGIN', ''); vi.stubEnv('ADMIN_APP_ORIGIN', ''); vi.stubEnv('APP_ORIGIN', ''); vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('OPENAI_API_KEY', ''); mocks.settings.mockResolvedValue({ settings: business });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('server-selected voice routing', () => {
  it('defaults to Pipecat and rejects invalid selectors', () => {
    vi.stubEnv('VOICE_BACKEND', undefined); expect(voiceBackend()).toBe('pipecat');
    vi.stubEnv('VOICE_BACKEND', 'openai_direct'); expect(voiceBackend()).toBe('openai_direct');
    vi.stubEnv('VOICE_BACKEND', 'client-choice'); expect(() => voiceBackend()).toThrow();
  });
  it('returns temporary ICE credentials without the permanent secret or a direct OpenAI call', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(config)); vi.stubGlobal('fetch', fetcher);
    const response = await session(input('session', { backend: 'openai_direct' }));
    const data = await response.json();
    expect(data).toEqual({ backend: 'pipecat', rtcConfig: { iceServers: config.iceServers, iceTransportPolicy: 'relay' } });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(String(fetcher.mock.calls[0][0])).toBe('https://pipe.example/api/ice');
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer permanent-service-token');
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(JSON.stringify(data)).not.toMatch(/permanent-service-token|PRIVATE|configured-model/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('hands off only server-loaded settings and baseline, and requires an acknowledgement', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ type: 'answer', sdp: 'answer', settings_applied: true, secret: 'PRIVATE' })); vi.stubGlobal('fetch', fetcher);
    const response = await offer(input('offer', { type: 'offer', sdp: 'browser-offer' }));
    expect(await response.json()).toEqual({ type: 'answer', sdp: 'answer' });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.agent_config.greeting).toBe(business.greeting);
    expect(body.agent_config.instructions).toContain(business.instructions);
    expect(body.agent_config.instructions.endsWith(ASSISTANT_BASELINE)).toBe(true);
    mocks.settings.mockResolvedValueOnce({ settings: { ...business, greeting: 'New greeting' } });
    await offer(input('offer', { type: 'offer', sdp: 'another-offer' }));
    expect(JSON.parse(fetcher.mock.calls[1][1].body).agent_config.greeting).toBe('New greeting');
    fetcher.mockResolvedValueOnce(Response.json({ type: 'answer', sdp: 'answer' }));
    expect((await offer(input('offer', { type: 'offer', sdp: 'offer' }))).status).toBe(503);
  });
  it.each([{ type: 'offer', sdp: 'offer', agent_config: { instructions: 'untrusted' } }, { type: 'answer', sdp: 'bad' }, { type: 'offer', sdp: 'x'.repeat(40001) }])('rejects invalid or caller-overridden offers', async body => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await offer(input('offer', body))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies cross-origin access and public diagnostics before contacting Pipecat', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await offer(input('offer', {}, 'https://evil.example'))).status).toBe(403);
    const request = input('offer', {}); request.headers.set('x-voice-diagnostics', '1');
    expect((await offer(request)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not accept Pipecat offers when rollback is selected', async () => {
    vi.stubEnv('VOICE_BACKEND', 'openai_direct');
    expect((await offer(input('offer', { type: 'offer', sdp: 'offer' }))).status).toBe(409);
  });
  it.each(['http://remote.example', 'https://user:pass@pipe.example', 'https://pipe.example/path', 'https://pipe.example?x=1'])('rejects invalid upstream URL %s', async url => {
    vi.stubEnv('PIPECAT_SERVICE_URL', url); vi.stubEnv('NODE_ENV', 'production');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await session(input())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires the settings handoff protocol and never falls back to OpenAI', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ iceServers: [], iceTransportPolicy: 'all' })); vi.stubGlobal('fetch', fetcher);
    expect((await session(input())).status).toBe(503); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429, 500])('hides upstream error %i', async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response('PRIVATE-provider-details', { status })); vi.stubGlobal('fetch', fetcher);
    const response = await session(input());
    expect(response.status).toBe(status === 429 ? 429 : 503);
    expect(await response.text()).not.toContain('PRIVATE'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('fails closed without credentials, on network failure, or during settings failure', async () => {
    vi.stubEnv('PIPECAT_SERVICE_TOKEN', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await session(input())).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('PIPECAT_SERVICE_TOKEN', 'secret'); fetcher.mockRejectedValue(new Error('PRIVATE'));
    expect((await session(input())).status).toBe(503);
    mocks.settings.mockRejectedValueOnce(new Error('PRIVATE'));
    expect((await offer(input('offer', { type: 'offer', sdp: 'offer' }))).status).toBe(503);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it('filters captions and metadata while ignoring raw provider commands', () => {
  expect(pipecatEvent('{')).toBeNull();
  expect(pipecatEvent(JSON.stringify({ type: 'response.create' }))).toBeNull();
  expect(pipecatEvent(JSON.stringify({ type: 'caption', id: 'item_1', text: 'Hello', secret: 'PRIVATE' }))).toEqual({ type: 'caption', id: 'item_1', text: 'Hello' });
  expect(pipecatEvent(JSON.stringify({ type: 'tool', call_id: 'call_1', status: 'ok', count: 3, latency_ms: 20 }))).toMatchObject({ status: 'ok', count: 3, latency_ms: 20 });
});

it('waits for complete ICE and releases listeners on cancellation or timeout', async () => {
  const peer = new EventTarget() as RTCPeerConnection;
  Object.defineProperty(peer, 'iceGatheringState', { value: 'gathering', writable: true });
  const controller = new AbortController();
  const pending = waitForIce(peer, controller.signal);
  Object.defineProperty(peer, 'iceGatheringState', { value: 'complete' });
  peer.dispatchEvent(new Event('icegatheringstatechange')); await pending;
  Object.defineProperty(peer, 'iceGatheringState', { value: 'gathering' });
  const cancelled = waitForIce(peer, controller.signal); controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  await expect(waitForIce(peer, new AbortController().signal, 1)).rejects.toThrow('timed out');
});
