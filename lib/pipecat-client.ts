type PipecatEvent = { type: 'caption'; id: string; text: string }
  | { type: 'activity'; status: 'listening' | 'thinking' | 'speaking' }
  | { type: 'tool'; name: 'search_knowledge' | 'business_assistant'; status: string; call_id: string; count: number | null; latency_ms: number | null };

export function pipecatEvent(message: string): PipecatEvent | null {
  try {
    const value = JSON.parse(message);
    if (!value || typeof value !== 'object') return null;
    const identifier = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,160}$/.test(id);
    if (value.type === 'caption' && identifier(value.id) && typeof value.text === 'string') return { type: 'caption', id: value.id, text: value.text.slice(0, 8000) };
    if (value.type === 'activity' && ['listening', 'thinking', 'speaking'].includes(value.status)) return { type: 'activity', status: value.status };
    const name = value.name ?? 'search_knowledge';
    if (value.type === 'tool' && ['search_knowledge', 'business_assistant'].includes(name) && identifier(value.call_id) && ['searching', 'running', 'interrupted', 'ok', 'empty', 'unavailable', 'invalid_query', 'answered', 'completed', 'failed', 'partial', 'unknown', 'needs_information'].includes(value.status)) {
      return { type: 'tool', name, call_id: value.call_id, status: value.status,
        count: Number.isInteger(value.count) && value.count >= 0 && value.count <= 50 ? value.count : null,
        latency_ms: Number.isFinite(value.latency_ms) && value.latency_ms >= 0 ? value.latency_ms : null };
    }
  } catch { /* Ignore unrelated signalling and malformed messages. */ }
  return null;
}

export function waitForIce(peer: RTCPeerConnection, signal: AbortSignal, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const aborted = () => finish(new DOMException('Connection cancelled', 'AbortError'));
    peer.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(new Error('Audio routing timed out. Please retry the connection.')), timeoutMs);
    if (signal.aborted) aborted(); else changed();
  });
}

export function pipecatToolStatus(event: Extract<PipecatEvent, { type: 'tool' }>): string {
  const progress = event.status === 'searching' || event.status === 'running';
  if (event.name === 'business_assistant') {
    if (progress) return 'Checking your request';
    if (event.status === 'partial') return 'Follow-up saved; notification unconfirmed';
    if (['unknown', 'interrupted'].includes(event.status)) return 'Request outcome unconfirmed';
    if (event.status === 'needs_information') return 'Details or confirmation needed';
    return 'Listening';
  }
  return progress ? 'Searching knowledge' : 'Thinking';
}
