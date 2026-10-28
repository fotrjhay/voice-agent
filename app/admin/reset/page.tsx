import { requireAdmin } from '../../../lib/auth';
import ResetPassword from './reset';
export const dynamic = 'force-dynamic';
export default async function ResetPage() {
  let authorized = false;
  try { await requireAdmin(); authorized = true; } catch { /* Recovery links establish their session through /api/auth/confirm. */ }
  return <main className="admin-shell"><section className="admin-card signin-card"><h1>Set your password.</h1><p>Use your administrator invitation or recovery email. Links expire and can only be used once.</p><ResetPassword initialAuthorized={authorized} /></section></main>;
}
