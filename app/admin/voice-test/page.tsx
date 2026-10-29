import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requireVoiceDiagnosticsAdmin } from '../../../lib/diagnostic-access';
import { HttpError } from '../../../lib/http-error';
import { getBusinessSettings } from '../../../lib/settings';
import Voice from '../../voice';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin voice diagnostics', robots: { index: false, follow: false } };

export default async function VoiceTestPage() {
  try { await requireVoiceDiagnosticsAdmin(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    if (error instanceof HttpError && error.status === 401) redirect('/admin/signin');
    return <main><h1>Admin access unavailable</h1><p role="alert">Voice testing requires verified administrator access.</p><Link href="/admin">Return to administration</Link></main>;
  }
  const { settings } = await getBusinessSettings();
  return <><p><Link href="/admin">Return to administration</Link> · Authorized voice test. Enable diagnostics below before starting.</p><Voice business={settings.businessName} diagnosticsAuthorized /></>;
}
