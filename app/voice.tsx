'use client';
import { useEffect, useRef, useState } from 'react';
import { releaseResources } from '../lib/cleanup';
import styles from './voice.module.css';
import Link from 'next/link';

function MicIcon({ muted = false }: { muted?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" />{muted && <path d="m3 3 18 18" />}</svg>;
}

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
  const [level, setLevel] = useState(0);

  function end(message = 'Ended') {
    const resources = active.current;
    active.current = null;
    if (resources) releaseResources(resources);
    setLevel(0);
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current()) { stream.getTracks().forEach(t => t.stop()); return; }
      resources.stream = stream;
      microphone = observe(stream);
      frame = requestAnimationFrame(measure);
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
        assistant?.disconnect();
        assistant = observe(audio.srcObject as MediaStream);
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
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className={styles.wordmark} href="/" aria-label="FJO voice home">FJO</Link>
      <nav aria-label="Main navigation"><a href="https://jayeola.com">Portfolio</a><Link href="/" aria-current="page">Voice</Link><a href="https://chat.jayeola.com">Chat</a></nav>
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
          <button className={styles.start} onClick={start} disabled={busy || connected}><MicIcon />{busy ? 'Connecting…' : connected ? 'Conversation started' : 'Start conversation'}</button>
          <div className={styles.secondaryControls}>
            <button onClick={toggleMute} disabled={!connected} aria-pressed={muted}><MicIcon muted={!muted} />{muted ? 'Unmute conversation' : 'Mute conversation'}</button>
            <button className={styles.end} onClick={() => end()} disabled={!busy && !connected}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9c5-4 13-4 18 0 1 .8 1 3 0 4l-1 1-5-2v-2a17 17 0 0 0-6 0v2l-5 2-1-1c-1-1-1-3 0-4Z" /></svg>End conversation</button>
          </div>
        </div>
        <p className={styles.hint}>{connected ? 'Talk naturally. You can interrupt whenever you need to.' : 'Microphone access requested when you start.'}</p>
        {audioBlocked && <button className={styles.audioButton} onClick={async () => { try { await active.current?.audio?.play(); setAudioBlocked(false); } catch { setError('Audio playback is blocked. Enable sound for this site and retry.'); } }}>Enable assistant audio</button>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.conversationFooter}><a className={styles.contact} href="mailto:fortuneolafadehan@gmail.com">Discuss an automation<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg></a><span>A conversation with {business} · No audio or transcript saved by this page.</span></div>
      </section>
      <section id="transcript" className={styles.transcript} aria-labelledby="transcript-title">
        <div className={styles.transcriptHeader}><h2 id="transcript-title">Live transcript</h2><button onClick={() => setLines([])} disabled={!lines.length} aria-label="Clear transcript" title="Clear transcript"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></svg></button></div>
        <div className={styles.transcriptLog} role="log" aria-label="Conversation transcript" aria-relevant="additions text">
          {lines.length ? lines.map(line => <article className={line.who === 'You' ? styles.userLine : styles.assistantLine} key={line.id}><strong>{line.who === 'Assistant' ? 'Zevon' : line.who}</strong><p>{line.text}</p></article>) : <div className={styles.empty}><svg viewBox="0 0 48 56" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true"><path d="M8 2h23l12 13v36a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3Z" /><path d="M30 2v14h13M14 27h19M14 36h19M14 45h14" /></svg><p>Your conversation<br />appears here.</p></div>}
        </div>
        <p className={styles.transcriptNote}>Live transcription may be imperfect. Text stays in this page’s memory until cleared or reloaded.</p>
      </section>
    </div>
    <footer className={styles.footer}><span>Business answers depend on relevant retrieved evidence.</span><span>{retrievalMs === null ? 'Ready when you are.' : `Last retrieval: ${retrievalMs} ms (server measured)`}</span></footer>
  </main>;
}
