import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()],
  useEffect: vi.fn(), useSyncExternalStore: () => 'light',
}));
import Voice from '../app/voice';

type Button = ReactElement<{ children?: ReactNode; onClick: () => Promise<void> | void }>;
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return text(node.props.children);
  return typeof node === 'string' ? node : '';
}
function button(node: ReactNode, label: string): Button | undefined {
  if (Array.isArray(node)) return node.map(child => button(child, label)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  if (node.type === 'button' && text(node).includes(label)) return node as Button;
  return button(node.props.children, label);
}

let peers: Peer[];
const send = vi.fn();
const stop = vi.fn();
const stream = { getTracks: () => [{ enabled: true, stop }], getAudioTracks: () => [{ enabled: true, stop }] };
class Peer extends EventTarget {
  connectionState = 'new'; iceGatheringState = 'complete';
  localDescription?: RTCSessionDescriptionInit;
  onconnectionstatechange?: () => void;
  ontrack?: () => void;
  label?: string;
  channel = { readyState: 'connecting', send, close: vi.fn(), onopen: () => {}, onmessage: async (_event: { data: string }) => {}, onclose: () => {}, onerror: () => {} };
  close = vi.fn();
  constructor(public config?: RTCConfiguration) { super(); peers.push(this); }
  addTrack() {}
  createDataChannel(label: string) { this.label = label; return this.channel; }
  async createOffer() { return { type: 'offer' as const, sdp: 'offer' }; }
  async setLocalDescription(offer: RTCSessionDescriptionInit) { this.localDescription = offer; }
  async setRemoteDescription(_answer: RTCSessionDescriptionInit) {
    this.channel.readyState = 'open'; this.channel.onopen();
  }
}

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); peers = [];
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  vi.stubGlobal('window', { RTCPeerConnection: Peer }); vi.stubGlobal('RTCPeerConnection', Peer);
  vi.stubGlobal('Audio', class { play = vi.fn().mockResolvedValue(undefined); pause = vi.fn(); });
  vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('connects Pipecat through the same-origin proxy and never generates responses or runs retrieval in the browser', async () => {
  const rtcConfig = { iceServers: [{ urls: 'turn:relay.example:443?transport=tcp', username: 'temporary', credential: 'ephemeral' }], iceTransportPolicy: 'relay' };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ backend: 'pipecat', rtcConfig }))
    .mockResolvedValueOnce(Response.json({ type: 'answer', sdp: 'answer' }));
  vi.stubGlobal('fetch', fetcher);
  const page = Voice({ business: 'Business' });
  await button(page, 'Start conversation')!.props.onClick();
  expect(peers[0].config).toEqual(rtcConfig); expect(peers[0].label).toBe('chat');
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/session', '/api/offer']);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ type: 'offer', sdp: 'offer' });
  await peers[0].channel.onmessage({ data: JSON.stringify({ type: 'tool', call_id: 'c1', status: 'searching' }) });
  await peers[0].channel.onmessage({ data: JSON.stringify({ type: 'response.function_call_arguments.done', name: 'search_knowledge', arguments: '{"query":"q"}' }) });
  expect(fetcher).toHaveBeenCalledTimes(2); expect(send).not.toHaveBeenCalled();
  await button(page, 'End conversation')!.props.onClick();
  expect(stop).toHaveBeenCalled(); expect(peers[0].close).toHaveBeenCalled();
});

it('retains the direct OpenAI connection and its single opening response for rollback', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ value: 'ephemeral-openai' }))
    .mockResolvedValueOnce(new Response('answer'));
  vi.stubGlobal('fetch', fetcher);
  const page = Voice({ business: 'Business' });
  await button(page, 'Start conversation')!.props.onClick();
  expect(peers[0].config).toBeUndefined(); expect(peers[0].label).toBe('oai-events');
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/session', 'https://api.openai.com/v1/realtime/calls']);
  expect(send).toHaveBeenCalledOnce(); expect(JSON.parse(send.mock.calls[0][0]).type).toBe('response.create');
  await button(page, 'End conversation')!.props.onClick();
});

it('does not open microphone after a failed Pipecat session request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not ready' }, { status: 503 })));
  const page = Voice({ business: 'Business' });
  await button(page, 'Start conversation')!.props.onClick();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled(); expect(peers).toHaveLength(0);
});
