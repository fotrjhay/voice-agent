import { redirect } from 'next/navigation';
import { requireAdmin } from '../../lib/auth';
import { HttpError } from '../../lib/http-error';
import AdminDashboard from './dashboard';
import Link from 'next/link';
import { appOrigins } from '../../lib/origins';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administration · Voice Desk', robots: { index: false, follow: false } };
export default async function AdminPage() {
  try { await requireAdmin(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect('/admin/signin');
    return <main><h1>Admin access unavailable</h1><p role="alert">Admin access is unavailable. Ask the operator to check your membership and the authentication/database configuration.</p><Link href={appOrigins().voice?.origin || '/'}>Return to voice assistant</Link></main>;
  }
  return <AdminDashboard voiceUrl={appOrigins().voice?.origin || '/'} />;
}
