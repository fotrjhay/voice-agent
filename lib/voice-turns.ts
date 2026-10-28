// Serialize replies and discard transcripts from superseded microphone turns.
export function createVoiceTurns(sendResponse: () => void) {
  let itemId: string | undefined;
  let accepted = false;
  let speaking = false;
  let active = false;
  let pending = false;
  function flush() {
    if (!pending || active || speaking) return;
    pending = false;
    active = true;
    sendResponse();
  }
  return {
    speechStarted(id: string) { itemId = id; accepted = false; speaking = true; pending = false; },
    speechStopped() { speaking = false; flush(); },
    transcript(id: string, text: string) {
      if (id !== itemId || accepted || !text.trim()) return false;
      accepted = true;
      pending = true;
      flush();
      return true;
    },
    request() { pending = true; flush(); },
    responseCreated() { active = true; },
    responseDone() { active = false; flush(); },
  };
}
