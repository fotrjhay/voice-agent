'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { releaseResources } from '../lib/cleanup';
import { createVoiceTurns } from '../lib/voice-turns';
import type { ResponseRequest } from '../lib/voice-turns';
import { createVoiceDiagnostics, type VoiceDiagnostics } from '../lib/voice-diagnostics';
import { pipecatEvent, waitForIce } from '../lib/pipecat-client';
import styles from './voice.module.css';
import Link from 'next/link';

function MicIcon({ muted = false }: { muted?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" />{muted && <path d="m3 3 18 18" />}</svg>;
}

type Resources = Parameters<typeof releaseResources>[0];
type Line = { id: string; who: string; text: string };
function preferredTheme() {
  try {
    const saved = localStorage.getItem('fjo-voice-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Theme switching still works when storage is unavailable. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function subscribeTheme(change: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', change);
  window.addEventListener('storage', change);
  return () => { media.removeEventListener('change', change); window.removeEventListener('storage', change); };
}
export default function Voice({ business, diagnosticsAuthorized = false }: { business: string; diagnosticsAuthorized?: boolean }) {
  const preferred = useSyncExternalStore(subscribeTheme, preferredTheme, () => 'light');
  const [themeOverride, setThemeOverride] = useState<string | null>(null);
  const theme = themeOverride || preferred;
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setThemeOverride(next);
    try { localStorage.setItem('fjo-voice-theme', next); } catch { /* Optional persistence. */ }
  }
  const active = useRef<Resources | null>(null);
  const [status, setStatus] = useState('Ready');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [retrievalMs, setRetrievalMs] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [backend, setBackend] = useState<'pipecat' | 'openai_direct' | null>(null);
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false);
  const diagnostics = useRef<VoiceDiagnostics | null>(null);
  const [diagnosticSummary, setDiagnosticSummary] = useState<ReturnType<VoiceDiagnostics['summary']> | null>(null);
  const refreshDiagnostics = () => setDiagnosticSummary(diagnostics.current?.summary() ?? null);

  function downloadDiagnostics() {
    const summary = diagnostics.current?.summary();
    if (!summary) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'voice-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function end(message = 'Ended') {
    const resources = active.current;
    active.current = null;
    diagnostics.current?.end(message);
    refreshDiagnostics();
    if (resources) releaseResources(resources);
    setLevel(0);
    setConnected(false); setBusy(false); setMuted(false); setAudioBlocked(false); setStatus(message);
  }
  useEffect(() => () => {
    const resources = active.current;
    active.current = null;
    diagnostics.current?.end('page_unmounted');
    if (resources) releaseResources(resources);
  }, []);

  async function start() {
    if (active.current) return;
    if (diagnosticsAuthorized && !diagnosticsEnabled) return;
    const requestDiagnostics = diagnosticsAuthorized && diagnosticsEnabled;
    const startedAt = Date.now();
    let diagnostic: VoiceDiagnostics | null = null;
    diagnostics.current = null;
    setDiagnosticSummary(null);
    const resources: Resources = { abort: new AbortController() };
    active.current = resources;
    const current = () => active.current === resources && !resources.abort.signal.aborted;
    const fail = (message: string) => { if (current()) { end('Disconnected'); setError(message); } };
    setBusy(true); setError(''); setLines([]); setRetrievalMs(null); setStatus('Requesting microphone');
    resources.timer = setTimeout(() => fail('Connection timed out. The voice service may be starting; please retry.'), 90000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw new Error('Use a browser with microphone and WebRTC support on localhost.');
      // Resume from the start-button gesture, including on mobile browsers.
      let context: AudioContext | undefined;
      let microphone: AnalyserNode | undefined;
      let assistant: AnalyserNode | undefined;
      let frame = 0;
      const sources: MediaStreamAudioSourceNode[] = [];
      try {
        context = new AudioContext();
        void context.resume().catch(() => {});
      } catch { /* Audio metering is optional; voice can still work. */ }
      const observe = (input: MediaStream) => {
        if (!context || context.state === 'closed') return;
        try {
          const source = context.createMediaStreamSource(input);
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          sources.push(source);
          return analyser;
        } catch { return undefined; }
      };
      resources.stopMeter = () => {
        cancelAnimationFrame(frame);
        sources.forEach(source => source.disconnect());
        microphone?.disconnect(); assistant?.disconnect();
        void context?.close().catch(() => {});
      };
      const samples = new Float32Array(512);
      const volume = (analyser?: AnalyserNode) => {
        if (!analyser) return 0;
        analyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      };
      let smoothed = 0, lastPaint = 0;
      const measure = (time: number) => {
        if (!current()) return;
        if (time - lastPaint >= 50) {
          const input = resources.stream?.getAudioTracks().some(track => track.enabled) ? volume(microphone) : 0;
          const output = resources.audio && !resources.audio.paused ? volume(assistant) : 0;
          const target = Math.min(1, Math.max(0, Math.max(input, output) - 0.008) * 8);
          smoothed += (target - smoothed) * (target > smoothed ? 0.65 : 0.25);
          setLevel(smoothed);
          lastPaint = time;
        }
        frame = requestAnimationFrame(measure);
      };
      const credentialResponse = await fetch(requestDiagnostics ? '/api/admin/voice/session' : '/api/session', {
        method: 'POST', headers: requestDiagnostics ? { 'x-voice-diagnostics': '1' } : {}, signal: resources.abort.signal, cache: 'no-store',
      });
      const credential = await credentialResponse.json();
      if (!credentialResponse.ok) throw new Error(credential.error || 'Could not create session.');
      if (!current()) return;
      const selectedBackend = credential.backend === 'pipecat' ? 'pipecat' : 'openai_direct';
      if (selectedBackend === 'openai_direct' && typeof credential.value !== 'string') throw new Error('Invalid voice session response.');
      if (selectedBackend === 'pipecat' && !credential.rtcConfig) throw new Error('Audio routing configuration was not returned.');
      setBackend(selectedBackend);
      if (requestDiagnostics) {
        if (!credential.diagnostics) throw new Error('Authorized diagnostics configuration was not returned.');
        diagnostic = createVoiceDiagnostics(Date.now, startedAt, selectedBackend);
        diagnostics.current = diagnostic;
        diagnostic.sessionSetup(credential.diagnostics.requested, credential.diagnostics.reported);
        refreshDiagnostics();
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!current()) { stream.getTracks().forEach(t => t.stop()); return; }
      resources.stream = stream;
      microphone = observe(stream);
      frame = requestAnimationFrame(measure);
      stream.getTracks().forEach(t => { t.onended = () => fail('The microphone disconnected. Reconnect it and start again.'); });
      setStatus('Connecting');
      const audio = new Audio();
      audio.autoplay = true;
      resources.audio = audio;
      const peer = new RTCPeerConnection(selectedBackend === 'pipecat' ? credential.rtcConfig : undefined);
      resources.peer = peer;
      peer.ontrack = event => {
        if (!current()) return;
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        assistant?.disconnect();
        assistant = observe(audio.srcObject as MediaStream);
        void audio.play().catch(() => { if (current()) setAudioBlocked(true); });
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) fail('Voice connection lost. Start again to reconnect.');
      };
      stream.getTracks().forEach(t => peer.addTrack(t, stream));
      const channel = peer.createDataChannel(selectedBackend === 'pipecat' ? 'chat' : 'oai-events');
      resources.channel = channel;
      const send = (event: Record<string, unknown>, request?: ResponseRequest) => {
        if (selectedBackend === 'openai_direct' && current() && channel.readyState === 'open') {
          channel.send(JSON.stringify(event));
          diagnostic?.sent(event, request);
        }
      };
      const calls = new Set<string>();
      const turns = selectedBackend === 'openai_direct' ? createVoiceTurns(request => send({ type: 'response.create', event_id: `client_${crypto.randomUUID()}` }, request)) : null;
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
        diagnostic?.connected();
        turns?.greeting();
        refreshDiagnostics();
      };
      channel.onclose = () => fail('Voice channel closed. Start again to reconnect.');
      channel.onerror = () => fail('Voice channel failed. Please try again.');
      channel.onmessage = async message => {
        if (!current()) return;
        if (selectedBackend === 'pipecat') {
          const event = pipecatEvent(message.data);
          if (event?.type === 'caption') append(event.id, 'Assistant', event.text);
          if (event?.type === 'activity') setStatus({ listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }[event.status]);
          if (event?.type === 'tool') {
            setStatus(event.status === 'searching' ? 'Searching knowledge' : 'Thinking');
            if (event.latency_ms !== null) setRetrievalMs(event.latency_ms);
            diagnostic?.pipecatTool(event);
            refreshDiagnostics();
          }
          return;
        }
        if (!turns) return;
        try {
          const event = JSON.parse(message.data);
          diagnostic?.received(event);
          switch (event.type) {
            case 'input_audio_buffer.speech_started': turns.speechStarted(event.item_id); setStatus('Listening'); break;
            case 'input_audio_buffer.speech_stopped': turns.speechStopped(event.item_id); setStatus('Listening'); break;
            case 'response.created': turns.responseCreated(event.response.id); setStatus('Thinking'); break;
            case 'response.output_item.added':
              if (event.item?.type === 'function_call') turns.toolStarted(event.response_id, event.item.call_id);
              break;
            case 'output_audio_buffer.started': setStatus('Speaking'); break;
            case 'output_audio_buffer.stopped':
            case 'output_audio_buffer.cleared': setStatus('Listening'); break;
            case 'response.done':
              turns.responseDone(event.response.id, event.response.status,
                (event.response.output ?? []).filter((item: { type: string }) => item.type === 'function_call').map((item: { call_id: string }) => item.call_id));
              if (event.response?.status === 'failed') fail('The voice service could not answer. Please restart.');
              break;
            case 'conversation.item.input_audio_transcription.completed':
              if (event.transcript.trim()) append(event.item_id, 'You', event.transcript);
              if (turns.transcript(event.item_id, event.transcript)) diagnostic?.completedTurn(event.item_id);
              break;
            case 'conversation.item.input_audio_transcription.failed': setError('Some speech could not be transcribed. Please say that again.'); break;
            case 'response.output_audio_transcript.delta': append(event.item_id, 'Assistant', event.delta, true); break;
            case 'response.output_audio_transcript.done': append(event.item_id, 'Assistant', event.transcript); break;
            case 'error': fail('The voice service reported a session error. Please restart.'); break;
            case 'response.function_call_arguments.done': {
              if (calls.has(event.call_id)) break;
              calls.add(event.call_id);
              turns.toolStarted(event.response_id, event.call_id);
              const retrievalStarted = performance.now();
              setStatus('Searching knowledge');
              let output: unknown = { status: 'unavailable', passages: [] };
              if (event.name === 'search_knowledge') {
                diagnostic?.retrievalStarted(event.call_id, event.response_id);
                try {
                  const args: unknown = JSON.parse(event.arguments);
                  const result = await fetch(requestDiagnostics ? '/api/admin/voice/search' : '/api/search', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...(requestDiagnostics ? { 'x-voice-diagnostics': '1' } : {}) },
                    body: JSON.stringify(args), signal: resources.abort.signal, cache: 'no-store',
                  });
                  if (requestDiagnostics && [400, 401, 403, 404, 503].includes(result.status)) {
                    fail('Admin voice testing is no longer available. Check sign-in and feature access.');
                    return;
                  }
                  if (result.ok) {
                    output = await result.json();
                    if (current() && typeof (output as { retrieval_ms?: unknown }).retrieval_ms === 'number') setRetrievalMs((output as { retrieval_ms: number }).retrieval_ms);
                  }
                } catch { /* Return a safe tool failure; end aborts are discarded below. */ }
              }
              if (!current()) return;
              if (event.name === 'search_knowledge') diagnostic?.retrieval(event.call_id, event.response_id, Math.round(performance.now() - retrievalStarted), output);
              send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: event.call_id, output: JSON.stringify(output) } });
              // Keep the result in context, but do not restart an interrupted turn.
              turns.toolReturned(event.response_id, event.call_id);
              refreshDiagnostics();
              break;
            }
          }
          if (['session.created', 'session.updated', 'response.created', 'response.done', 'conversation.item.input_audio_transcription.completed'].includes(event.type)) refreshDiagnostics();
        } catch { fail('Could not process the voice session. Please restart.'); }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!current()) return;
      if (selectedBackend === 'pipecat') {
        await waitForIce(peer, resources.abort.signal);
        if (!current()) return;
        const response = await fetch(requestDiagnostics ? '/api/admin/voice/offer' : '/api/offer', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(requestDiagnostics ? { 'x-voice-diagnostics': '1' } : {}) },
          body: JSON.stringify({ type: 'offer', sdp: peer.localDescription?.sdp }),
          signal: resources.abort.signal, cache: 'no-store',
        });
        const answer = await response.json();
        if (!response.ok) throw new Error(answer.error || 'Voice connection failed.');
        if (current()) await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
        return;
      }
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
  return <main className={styles.page} data-theme={theme}>
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/" aria-label="FJO voice home">FJO</Link>
      <nav aria-label="Main navigation"><a href="https://jayeola.com">Portfolio</a><Link href="/" aria-current="page">Voice</Link><a href="https://chat.jayeola.com">Chat</a><button className={styles.themeToggle} onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" /></svg>}</button></nav>
    </header>
    <div className={styles.layout}>
      <section className={styles.conversation} aria-label={`Voice conversation with ${business}`}>
        <div className={styles.intro}><p className={styles.eyebrow}>AI assistant · Voice experience</p><h1>Let’s talk.</h1><p>Speak with Zevon</p></div>
        <div className={styles.dial} aria-hidden="true">
          <svg className={styles.ring} viewBox="0 0 320 320">
            {Array.from({ length: 72 }, (_, i) => <line key={i} x1="160" y1={43 - Math.round((Math.sin(i * 0.47) + 1) * 7)} x2="160" y2="78" transform={`rotate(${i * 5} 160 160)`} className={i < Math.round(level * 72) ? styles.limeBar : styles.dimBar} />)}
          </svg>
          <div className={styles.dialCenter}><MicIcon muted={muted} /></div>
        </div>
        <p className={styles.status} role="status" aria-live="polite"><span data-connected={connected && !muted} />{muted ? 'Microphone muted' : status}</p>
        <div className={styles.controls}>
          <button className={styles.start} onClick={start} disabled={busy || connected || (diagnosticsAuthorized && !diagnosticsEnabled)}><MicIcon />{busy ? 'Connecting…' : connected ? 'Conversation started' : 'Start conversation'}</button>
          <div className={styles.secondaryControls}>
            <button onClick={toggleMute} disabled={!connected} aria-pressed={muted}><MicIcon muted={!muted} />{muted ? 'Unmute conversation' : 'Mute conversation'}</button>
            <button className={styles.end} onClick={() => end()} disabled={!busy && !connected}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9c5-4 13-4 18 0 1 .8 1 3 0 4l-1 1-5-2v-2a17 17 0 0 0-6 0v2l-5 2-1-1c-1-1-1-3 0-4Z" /></svg>End conversation</button>
          </div>
        </div>
        <p className={styles.hint}>For the best audio experience, use earphones or a headset.</p>
        {audioBlocked && <button className={styles.audioButton} onClick={async () => { try { await active.current?.audio?.play(); setAudioBlocked(false); } catch { setError('Audio playback is blocked. Enable sound for this site and retry.'); } }}>Enable assistant audio</button>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.conversationFooter}><a className={styles.contact} href="mailto:fortuneolafadehan@gmail.com">Discuss an automation<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></a><span>A conversation with {business} · No audio or transcript saved by this page.</span></div>
      </section>
      <section id="transcript" className={styles.transcript} aria-labelledby="transcript-title">
        <div className={styles.transcriptHeader}><h2 id="transcript-title">Live transcript</h2><button onClick={() => setLines([])} disabled={!lines.length} aria-label="Clear transcript" title="Clear transcript"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg></button></div>
        <div className={styles.transcriptLog} role="log" aria-label="Conversation transcript" aria-relevant="additions text">
          {lines.length ? lines.map(line => <article className={line.who === 'You' ? styles.userLine : styles.assistantLine} key={line.id}><strong>{line.who === 'Assistant' ? 'Zevon' : line.who}</strong><p>{line.text}</p></article>) : <div className={styles.empty}><svg viewBox="0 0 48 56" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true"><path d="M8 2h23l12 13v36a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z" /><path d="M30 2v14h13M14 27h19M14 36h19M14 45h14" /></svg><p>Your conversation<br />appears here.</p></div>}
        </div>
        <p className={styles.transcriptNote}>{backend === 'pipecat' ? 'Assistant captions are shown when available. Your speech is not transcribed. ' : 'Live transcription may be imperfect. '}Text stays in this page’s memory until cleared or reloaded.</p>
      </section>
    </div>
    <footer className={styles.footer}><span>Business answers depend on relevant retrieved evidence.</span><span>{retrievalMs === null ? 'Ready when you are.' : `Last retrieval: ${retrievalMs} ms (server measured)`}</span></footer>
    {diagnosticsAuthorized && <details open>
      <summary>Authorized voice diagnostics</summary>
      <label><input type="checkbox" checked={diagnosticsEnabled} disabled={busy || connected} onChange={event => {
        setDiagnosticsEnabled(event.target.checked);
        if (!event.target.checked) { diagnostics.current = null; setDiagnosticSummary(null); }
      }} /> I opt in to diagnostics for this voice test</label>
      <p>Memory only. Contains identifiers, configuration and usage counts. No audio, transcripts, prompts, passages or credentials. Missing usage is unknown. Download before reloading.</p>
      <button onClick={refreshDiagnostics} disabled={!diagnosticSummary}>Refresh duration</button>
      <button onClick={downloadDiagnostics} disabled={!diagnosticSummary}>Download JSON summary</button>
      {diagnosticSummary && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(diagnosticSummary, null, 2)}</pre>}
    </details>}
  </main>;
}
