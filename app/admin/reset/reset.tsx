'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';

export default function ResetPassword({ initialAuthorized }: { initialAuthorized: boolean }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(initialAuthorized);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const values = new URLSearchParams(window.location.hash.slice(1));
    // Tokens stay out of server URL/query logs and are removed from browser history immediately.
    window.history.replaceState(null, '', '/admin/reset');
    const token_hash = values.get('token_hash'), type = values.get('type');
    if (!token_hash) return;
    void fetch('/api/auth/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token_hash, type }) }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The link is invalid or expired.');
      setAuthorized(true);
    }).catch(cause => setError(cause instanceof Error ? cause.message : 'The link is invalid or expired.'));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const values = new FormData(event.currentTarget);
    if (values.get('password') !== values.get('confirm')) { setError('The passwords do not match.'); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: values.get('password') }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Password reset failed.');
      router.replace('/admin/signin'); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Password reset failed.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>{authorized ? <form onSubmit={submit}><fieldset disabled={busy}><label htmlFor="password">New password (12–128 characters)</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><label htmlFor="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /><button className="primary">{busy ? 'Saving…' : 'Set password and sign out'}</button></fieldset></form> : <p role="status">Open a valid recovery link to continue.</p>}{error && <p className="error" role="alert">{error}</p>}<p><Link href="/admin/signin">Back to sign in / request a new link</Link></p></>;
}
