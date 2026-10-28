'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

export default function SignIn({ enabled }: { enabled: boolean; hasError?: boolean }) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    const form = new FormData(event.currentTarget);
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/auth/${recovering ? 'recover' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), ...(!recovering ? { password: form.get('password') } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The request failed. Retry shortly.');
      if (recovering) setMessage(data.message); else { router.replace('/admin'); router.refresh(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The request failed. Retry shortly.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <>{!enabled && <p role="alert" className="error">Admin sign-in is not configured. Ask the operator to complete Supabase setup.</p>}
    <form onSubmit={submit}><fieldset disabled={!enabled || busy}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
      {!recovering && <><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} /></>}
      <button className="primary" type="submit">{busy ? 'Please wait…' : recovering ? 'Send recovery email' : 'Sign in'}</button></fieldset></form>
    <button disabled={busy} onClick={() => { setRecovering(!recovering); setError(''); setMessage(''); }}>{recovering ? 'Back to sign in' : 'Forgot password?'}</button>
    <p role="status" aria-live="polite">{message}</p>{error && <p className="error" role="alert">{error}</p>}</>;
}
