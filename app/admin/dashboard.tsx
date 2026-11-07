'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { tones, type BusinessSettings } from '../../lib/settings-schema';
import Link from 'next/link';

type Document = { id: string; name: string; provider: string; revision?: string; documentId?: string; sourceId?: string; modifiedTime?: string; status?: string };
export default function AdminDashboard({ voiceUrl = '/', diagnosticsAvailable = false }: { voiceUrl?: string; diagnosticsAvailable?: boolean }) {
  const router = useRouter();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [version, setVersion] = useState(0);
  const uploadKey = useRef('');
  const [settingsError, setSettingsError] = useState('');
  const [settingsStatus, setSettingsStatus] = useState('Loading settings…');
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState<Document[]>([]);
  const [nextPage, setNextPage] = useState<string | undefined>();
  const [listing, setListing] = useState(true);
  const [listError, setListError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const savingRef = useRef(false), uploadingRef = useRef(false), listingRef = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const call = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, { ...init, signal: abort.current?.signal, cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error('Your session expired. Sign in again to continue.');
    if (!response.ok) {
      const labels: Record<string, string> = { businessName: 'Business name', greeting: 'Opening greeting', tone: 'Tone', instructions: 'Business instructions', supportEmail: 'Support email', supportPhone: 'Support phone', supportUrl: 'Support website' };
      const details = Array.isArray(data.fields) ? data.fields.map((issue: { field: string; message: string }) => `${labels[issue.field] || 'Settings'}: ${issue.message}`).join(' ') : '';
      throw new Error(`${data.error || 'The request failed. Please retry.'} ${details}`.trim());
    }
    return data;
  }, []);
  const loadSettings = useCallback(async () => {
    setSettingsError(''); setSettingsStatus('Loading settings…');
    try {
      const data = await call('/api/admin/settings');
      setSettings(data.settings); setVersion(data.version);
      setSettingsStatus(data.source === 'environment' ? 'Environment defaults — not saved yet.' : 'Saved configuration loaded.');
    } catch (error) { if (!abort.current?.signal.aborted) { setSettingsStatus(''); setSettingsError(error instanceof Error ? error.message : 'Could not load settings.'); } }
  }, [call]);
  const loadFiles = useCallback(async (page?: string) => {
    if (listingRef.current) return;
    listingRef.current = true; setListing(true); setListError('');
    try {
      const data = await call(`/api/admin/documents${page ? `?pageToken=${encodeURIComponent(page)}` : ''}`);
      setFiles(previous => page ? [...previous, ...data.files] : data.files); setNextPage(data.nextPageToken);
    } catch (error) { if (!abort.current?.signal.aborted) setListError(error instanceof Error ? error.message : 'Could not list files.'); }
    finally { listingRef.current = false; if (!abort.current?.signal.aborted) setListing(false); }
  }, [call]);
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    void call('/api/admin/settings').then(data => {
      if (controller.signal.aborted) return;
      setSettings(data.settings); setVersion(data.version);
      setSettingsStatus(data.source === 'environment' ? 'Environment defaults — not saved yet.' : 'Saved configuration loaded.');
    }).catch(error => {
      if (controller.signal.aborted) return;
      setSettingsStatus(''); setSettingsError(error instanceof Error ? error.message : 'Could not load settings.');
    });
    void call('/api/admin/documents').then(data => {
      if (controller.signal.aborted) return;
      setFiles(data.files); setNextPage(data.nextPageToken); setListing(false);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setListError(error instanceof Error ? error.message : 'Could not list files.'); setListing(false);
    });
    return () => { controller.abort(); };
  }, [call]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current || !settings) return;
    savingRef.current = true; setSaving(true); setSettingsError(''); setSettingsStatus('Saving…');
    try {
      const data = await call('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings, version }) });
      setSettings(data.settings); setVersion(data.version); setSettingsStatus('Saved. New conversations will use these settings. Existing sessions keep their settings.');
    } catch (error) { setSettingsStatus(''); if (!abort.current?.signal.aborted) setSettingsError(error instanceof Error ? error.message : 'Could not save settings.'); }
    finally { savingRef.current = false; if (!abort.current?.signal.aborted) setSaving(false); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!selected || uploadingRef.current) return;
    if (selected.size > 3 * 1024 * 1024) { setUploadError('Choose a file no larger than 3 MiB. The server may enforce a smaller limit.'); return; }
    uploadingRef.current = true; setUploading(true); setUploadError(''); setUploadStatus('Uploading…');
    try {
      const result = await call('/api/admin/documents', { method: 'POST', headers: { 'Content-Type': selected.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(selected.name), 'X-Upload-Key': uploadKey.current }, body: selected });
      setUploadStatus(`Uploaded to Dropbox: ${result.file.name}. File ID: ${result.file.id}. Searchable status requires confirmed ingestion and retrieval evidence.`);
      setSelected(null); uploadKey.current = ''; if (fileInput.current) fileInput.current.value = '';
      await loadFiles();
    } catch (error) { setUploadStatus(''); if (!abort.current?.signal.aborted) setUploadError(error instanceof Error ? error.message : 'Upload failed. Refresh the list before retrying.'); }
    finally { uploadingRef.current = false; if (!abort.current?.signal.aborted) setUploading(false); }
  }
  function field(key: keyof BusinessSettings, value: string) {
    setSettings(previous => previous ? { ...previous, [key]: value } : previous);
    setSettingsStatus('Unsaved changes.');
  }
  return <main className="admin-shell">
    <header><span className="brand">◉ VOICE DESK <span className="admin-label">ADMIN</span></span><nav aria-label="Admin navigation"><a href={voiceUrl} target="_blank" rel="noreferrer">Open voice assistant</a>{diagnosticsAvailable && <Link href="/admin/voice-test" prefetch={false}>Voice diagnostics</Link>}<button disabled={signingOut} onClick={async () => { setSigningOut(true); try { await call('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); router.replace('/admin/signin'); router.refresh(); } catch { setSettingsError('Could not sign out. Retry.'); setSigningOut(false); } }}>{signingOut ? 'Signing out…' : 'Sign out'}</button></nav></header>
    <section className="admin-intro"><p className="eyebrow">ONE BUSINESS. ONE PLACE TO MANAGE IT.</p><h1>Your assistant,<br /><span>kept up to date.</span></h1><p>Configure its conversation and add source documents for your business.</p></section>
    <div className="admin-grid"><section className="admin-card" aria-labelledby="settings-heading"><p className="eyebrow">01 · CONVERSATION</p><h2 id="settings-heading">Assistant settings</h2><button disabled={saving} onClick={loadSettings}>Reload saved settings</button><p>Changes apply to new conversations. Keep credentials and private information out of these fields.</p>
      <p role="status" aria-live="polite">{settingsStatus}</p>{settingsError && <p className="error" role="alert">{settingsError} <a href="/admin/signin">Sign in</a></p>}
      {!settings ? <button onClick={loadSettings}>Retry loading settings</button> : <form onSubmit={save}><fieldset disabled={saving}>
        <label htmlFor="businessName">Business name</label><input id="businessName" value={settings.businessName} maxLength={120} required onChange={e => field('businessName', e.target.value)} />
        <label htmlFor="greeting">Opening greeting</label><textarea id="greeting" rows={3} value={settings.greeting} maxLength={500} required onChange={e => field('greeting', e.target.value)} />
        <label htmlFor="tone">Tone</label><select id="tone" value={settings.tone} onChange={e => field('tone', e.target.value)}>{tones.map(tone => <option key={tone} value={tone}>{tone[0].toUpperCase() + tone.slice(1)}</option>)}</select>
        <label htmlFor="instructions">Business instructions</label><textarea id="instructions" rows={8} value={settings.instructions} maxLength={12000} required onChange={e => field('instructions', e.target.value)} aria-describedby="baseline-note" />
        <p className="field-note" id="baseline-note">Application privacy, tool permissions and truthful action reporting remain controlled by the application baseline.</p>
        <h3>Human support</h3><p className="field-note">Public contact details the assistant may share. This does not enable calls, emails or transfers.</p>
        <label htmlFor="supportEmail">Support email (optional)</label><input id="supportEmail" type="email" value={settings.supportEmail} maxLength={254} onChange={e => field('supportEmail', e.target.value)} />
        <label htmlFor="supportPhone">Support WhatsApp/phone (optional)</label><input id="supportPhone" type="tel" value={settings.supportPhone} maxLength={40} onChange={e => field('supportPhone', e.target.value)} />
        <label htmlFor="supportUrl">Support website (optional, HTTPS)</label><input id="supportUrl" type="url" value={settings.supportUrl} maxLength={500} onChange={e => field('supportUrl', e.target.value)} />
        <button className="primary" type="submit">{saving ? 'Saving…' : 'Save settings'}</button>
      </fieldset></form>}
    </section><section className="admin-card" aria-labelledby="documents-heading"><p className="eyebrow">02 · KNOWLEDGE SOURCES</p><h2 id="documents-heading">Business documents</h2><p>Upload to the configured Dropbox app folder. Searchable status requires confirmed ingestion and retrieval evidence.</p>
      <form onSubmit={upload}><label htmlFor="document">Select a document</label><input ref={fileInput} id="document" type="file" accept=".pdf,.docx,.txt,.md,.text,.csv,.json" disabled={uploading} onChange={e => { setSelected(e.target.files?.[0] || null); uploadKey.current = crypto.randomUUID(); setUploadError(''); setUploadStatus(''); }} /><p className="field-note">PDF, DOCX, TXT, MD, TEXT, CSV or JSON. Maximum 3 MiB; the operator may set a lower limit. Text must use UTF-8.</p><button className="primary" type="submit" disabled={!selected || uploading}>{uploading ? 'Uploading…' : 'Upload to Dropbox'}</button></form>
      <p role="status" aria-live="polite" className="upload-status">{uploadStatus}</p>{uploadError && <p className="error" role="alert">{uploadError}</p>}<p className="field-note">Retries of the same selected file reuse its upload key. Different selections create new documents, even with the same name. No existing file is overwritten.</p>
      <div className="section-title"><h3>Files in the configured folder</h3><button disabled={listing || uploading} onClick={() => loadFiles()}>Refresh list</button></div>
      {listError && <p className="error" role="alert">{listError} <a href="/admin/signin">Sign in</a></p>}<p role="status">{listing ? 'Loading files…' : `${files.length} files shown. Pages contain up to 50 files.`}</p>
      <ul className="document-list">{files.map(file => <li key={file.id}><strong>{file.name}</strong><span>File ID: {file.id}</span><span>Provider: {file.provider} · Revision: {file.revision || 'Not provided'}</span><span>Status: {file.status || 'uploaded'}</span><span>Source ID: {file.sourceId || 'Not registered by this app'}</span><span>Modified: {file.modifiedTime ? new Date(file.modifiedTime).toLocaleString() : 'Not provided'}</span></li>)}</ul>
      {nextPage && <button disabled={listing} onClick={() => loadFiles(nextPage)}>Load next 50 files</button>}
    </section></div>
    <footer><span>Private administration · Sessions managed by Supabase</span><span>Dropbox upload confirms storage only. n8n handles ingestion separately.</span></footer>
  </main>;
}
