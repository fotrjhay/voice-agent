'use client';
import { useEffect, useRef, useState } from 'react';
import { releaseResources } from '../lib/cleanup';

type Resources = Parameters<typeof releaseResources>[0];
type Line = { id: string; who: string; text: string };
export default function Voice({ business }: { business: string }) {
  const active = useRef<Resources | null>(null);
  const [status, setStatus] = useState('Ready');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [retrievalMs, setRetrievalMs] = useState<number | null>(null);

  function end(message = 'Ended') {
    const resources = active.current;
    active.current = null;
    if (resources) releaseResources(resources);
    setConnected(false); setBusy(false); setMuted(false); setAudioBlocked(false); setStatus(message);
  }
  useEffect(() => () => {
    const resources = active.current;
    active.current = null;
    if (resources) releaseResources(resources);
  }, []);

  async function start() {
    if (active.current) return;
    const resources: Resources = { abort: new AbortController() };
    active.current = resources;
    const current = () => active.current === resources && !resources.abort.signal.aborted;
    const fail = (message: string) => { if (current()) { end('Disconnected'); setError(message); } };
    setBusy(true); setError(''); setLines([]); setRetrievalMs(null); setStatus('Requesting microphone');
    resources.timer = setTimeout(() => fail('Connection timed out. Check your network and try again.'), 35000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Use a browser with microphone and WebRTC support on localhost.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current()) { stream.getTracks().forEach(t => t.stop()); return; }
      resources.stream = stream;
      stream.getTracks().forEach(t => { t.onended = () => fail('The microphone disconnected. Reconnect it and start again.'); });
      setStatus('Connecting');
      const audio = new Audio();
      audio.autoplay = true;
      resources.audio = audio;
      const peer = new RTCPeerConnection();
      resources.peer = peer;
      peer.ontrack = event => {
        if (!current()) return;
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void audio.play().catch(() => { if (current()) setAudioBlocked(true); });
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) fail('Voice connection lost. Start again to reconnect.');
      };
      stream.getTracks().forEach(t => peer.addTrack(t, stream));
      const channel = peer.createDataChannel('oai-events');
      resources.channel = channel;
      const send = (event: unknown) => { if (current() && channel.readyState === 'open') channel.send(JSON.stringify(event)); };
      const calls = new Set<string>();
      let turn = 0;
      let responseActive = false;
      let continueAfterTool = false;
      const continueResponse = () => {
        if (continueAfterTool && !responseActive) { continueAfterTool = false; send({ type: 'response.create' }); }
      };
      const append = (id: string, who: string, text: string, delta = false) => {
        setLines(previous => {
          const existing = previous.find(line => line.id === id);
          if (existing) return previous.map(line => line.id === id ? { ...line, text: (delta ? line.text + text : text).slice(0, 8000) } : line);
          return [...previous, { id, who, text: text.slice(0, 8000) }].slice(-60);
        });
      };
      channel.onopen = () => {
        if (!current()) return;
        clearTimeout(resources.timer);
        // Bound local demo sessions even if the browser is left open.
        resources.timer = setTimeout(() => { if (current()) end('Session ended after 10 minutes'); }, 600000);
        setConnected(true); setBusy(false); setStatus('Listening');
        send({ type: 'response.create' });
      };
      channel.onclose = () => fail('Voice channel closed. Start again to reconnect.');
      channel.onerror = () => fail('Voice channel failed. Please try again.');
      channel.onmessage = async message => {
        if (!current()) return;
        try {
          const event = JSON.parse(message.data);
          switch (event.type) {
            case 'input_audio_buffer.speech_started': turn++; continueAfterTool = false; setStatus('Listening'); break;
            case 'input_audio_buffer.speech_stopped': setStatus('Thinking'); break;
            case 'response.created': responseActive = true; break;
            case 'output_audio_buffer.started': setStatus('Speaking'); break;
            case 'output_audio_buffer.stopped':
            case 'output_audio_buffer.cleared': setStatus('Listening'); break;
            case 'response.done':
              responseActive = false;
              if (event.response?.status === 'failed') fail('The voice service could not answer. Please restart.');
              else continueResponse();
              break;
            case 'conversation.item.input_audio_transcription.completed': append(event.item_id, 'You', event.transcript); break;
            case 'conversation.item.input_audio_transcription.failed': setError('Some speech could not be transcribed. Audio conversation may continue.'); break;
            case 'response.output_audio_transcript.delta': append(event.item_id, 'Assistant', event.delta, true); break;
            case 'response.output_audio_transcript.done': append(event.item_id, 'Assistant', event.transcript); break;
            case 'error': fail('The voice service reported a session error. Please restart.'); break;
            case 'response.function_call_arguments.done': {
              if (calls.has(event.call_id)) break;
              calls.add(event.call_id);
              const toolTurn = turn;
              setStatus('Searching knowledge');
              let output: unknown = { status: 'unavailable', passages: [] };
              if (event.name === 'search_knowledge') {
                try {
                  const args: unknown = JSON.parse(event.arguments);
                  const result = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: resources.abort.signal });
                  if (result.ok) {
                    output = await result.json();
                    if (current() && typeof (output as { retrieval_ms?: unknown }).retrieval_ms === 'number') setRetrievalMs((output as { retrieval_ms: number }).retrieval_ms);
                  }
                } catch { /* Return a safe tool failure; end aborts are discarded below. */ }
              }
              if (!current()) return;
              send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(output) } });
              // Keep the result in context, but do not restart an interrupted turn.
              continueAfterTool = toolTurn === turn;
              continueResponse();
              break;
            }
          }
        } catch { fail('Could not process the voice session. Please restart.'); }
      };
      const credentialResponse = await fetch('/api/session', { method: 'POST', signal: resources.abort.signal });
      const credential = await credentialResponse.json();
      if (!credentialResponse.ok) throw new Error(credential.error || 'Could not create session.');
      if (!current()) return;
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!current()) return;
      const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${credential.value}`, 'Content-Type': 'application/sdp' }, signal: resources.abort.signal,
      });
      if (!answer.ok) throw new Error('Voice connection failed. Check model access and network connectivity.');
      const sdp = await answer.text();
      if (current()) await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      fail(name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser, then start again.'
        : name === 'NotFoundError' ? 'No microphone found. Connect a microphone and try again.'
        : name === 'NotReadableError' ? 'Microphone unavailable. Close other apps using it and try again.'
        : cause instanceof Error && !(cause instanceof DOMException) ? cause.message : 'Could not start the voice conversation. Please try again.');
    }
  }
  function toggleMute() {
    const stream = active.current?.stream;
    if (!stream) return;
    stream.getAudioTracks().forEach(track => { track.enabled = muted; });
    setMuted(!muted);
  }
  return <main>
    <header><span className="brand">◉ VOICE DESK</span><span className="badge">LOCAL DEMO</span></header>
    <section className="intro"><p className="eyebrow">A CONVERSATION WITH {business}</p><h1>Just ask.<br /><span>We’re listening.</span></h1><p>Talk naturally with an AI assistant. Ask a question, explore a follow-up, or interrupt whenever you need to.</p></section>
    <section className="console" aria-label="Voice conversation">
      <div className={`orb ${connected ? 'live' : ''}`} aria-hidden="true">{connected ? '≋' : '◉'}</div>
      <p className="status" role="status" aria-live="polite">{muted ? `${status} · Microphone muted` : status}</p>
      <p className="hint">{connected ? 'Your voice sets the pace. Speak when you’re ready.' : 'Your microphone turns on only when you start.'}</p>
      <div className="controls"><button className="primary" onClick={start} disabled={busy || connected}>Start conversation</button><button onClick={toggleMute} disabled={!connected} aria-pressed={muted}>{muted ? 'Unmute microphone' : 'Mute microphone'}</button><button onClick={() => end()} disabled={!busy && !connected}>End conversation</button></div>
      {audioBlocked && <button onClick={async () => { try { await active.current?.audio?.play(); setAudioBlocked(false); } catch { setError('Audio playback is blocked. Enable sound for this site and retry.'); } }}>Enable assistant audio</button>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="facts"><span>↔ Speak over the assistant to interrupt</span><span>⌁ No local audio or transcript storage</span></div>
    </section>
    <section className="transcript"><div className="section-title"><h2>Conversation</h2><button onClick={() => setLines([])} disabled={!lines.length}>Clear transcript</button></div><p>Live transcription may be imperfect. Text stays in this page’s memory until cleared or reloaded.</p><div role="log" aria-label="Conversation transcript">{lines.length ? lines.map(line => <article key={line.id}><strong>{line.who}</strong><p>{line.text}</p></article>) : <p className="empty">Your conversation will appear here.</p>}</div></section>
    <footer><span>Business answers depend on relevant retrieved evidence.</span><span>{retrievalMs === null ? 'Retrieval timing: no measurement yet' : `Last retrieval: ${retrievalMs} ms (server measured)`}</span></footer>
  </main>;
}
