import { authConfigured } from '../../../lib/auth';
import SignIn from './signin';
import Link from 'next/link';
import { appOrigins } from '../../../lib/origins';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin sign-in · Voice Desk', robots: { index: false, follow: false } };
export default function SignInPage() {
  return <main className="admin-shell"><header><span className="brand">◉ VOICE DESK</span><Link href={appOrigins().voice?.origin || '/'}>Voice assistant</Link></header><section className="admin-card signin-card"><p className="eyebrow">BUSINESS ADMINISTRATION</p><h1>Welcome back.</h1><p>Sign in with your operator-provisioned administrator account.</p><p>No public registration is available.</p><SignIn enabled={authConfigured()} /></section></main>;
}
