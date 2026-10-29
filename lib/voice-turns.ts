export type ResponseRequest = { kind: 'greeting' | 'initial' | 'tool'; turnId?: string; callId?: string };

// Initial replies are deduplicated by input item; continuations by tool response.
export function createVoiceTurns(sendResponse: (request: ResponseRequest) => void) {
  let itemId: string | undefined;
  let speaking = false;
  let active: { id?: string; request: ResponseRequest } | undefined;
  let pending: ResponseRequest | undefined;
  const started = new Set<string>();
  const completed = new Set<string>();
  const requested = new Set<string>();
  const finished = new Set<string>();
  const responses = new Map<string, ResponseRequest>();
  const tools = new Map<string, { responseId: string; ready: boolean }>();
  function flush() {
    if (!pending || active || speaking) return;
    const request = pending;
    pending = undefined;
    active = { request };
    sendResponse(request);
  }
  function continueTools(responseId: string) {
    const request = responses.get(responseId);
    const group = [...tools.entries()].filter(([, tool]) => tool.responseId === responseId);
    if (!request || !finished.has(responseId) || request.turnId !== itemId
      || !group.length || group.some(([, tool]) => !tool.ready) || requested.has(`tools:${responseId}`)) return;
    requested.add(`tools:${responseId}`);
    pending = { kind: 'tool', turnId: request.turnId, callId: group[0][0] };
    flush();
  }
  return {
    speechStarted(id: string) {
      if (started.has(id)) return;
      started.add(id); itemId = id; speaking = true; pending = undefined;
    },
    speechStopped(id: string) { if (id === itemId) { speaking = false; flush(); } },
    transcript(id: string, text: string) {
      if (completed.has(id) || !text.trim()) return false;
      completed.add(id);
      if (id === itemId) { pending = { kind: 'initial', turnId: id }; flush(); }
      return true;
    },
    greeting() {
      if (requested.has('greeting')) return;
      requested.add('greeting'); pending = { kind: 'greeting' }; flush();
    },
    responseCreated(id: string) {
      if (!active || finished.has(id) || responses.has(id)) return;
      active.id = id; responses.set(id, active.request);
    },
    toolStarted(responseId: string, callId: string) {
      if (!tools.has(callId)) tools.set(callId, { responseId, ready: false });
    },
    toolReturned(responseId: string, callId: string) {
      const tool = tools.get(callId);
      if (!tool || tool.responseId !== responseId || tool.ready) return;
      tool.ready = true; continueTools(responseId);
    },
    responseDone(id: string, status: string, callIds: string[] = []) {
      if (finished.has(id)) return;
      callIds.forEach(callId => { if (!tools.has(callId)) tools.set(callId, { responseId: id, ready: false }); });
      finished.add(id);
      if (active?.id !== id) return;
      active = undefined;
      if (status === 'completed') continueTools(id);
      else responses.delete(id);
      flush();
    },
  };
}
