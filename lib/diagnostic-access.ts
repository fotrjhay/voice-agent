import 'server-only';
import { authorizeAdmin, requireAdmin } from './auth';
import { HttpError } from './http-error';

export function voiceDiagnosticsEnabled() {
  return process.env.VOICE_DIAGNOSTICS_ENABLED === 'true';
}

export async function requireVoiceDiagnosticsAdmin() {
  if (!voiceDiagnosticsEnabled()) throw new HttpError(404, 'Voice diagnostics are disabled.');
  return requireAdmin();
}

export async function authorizeVoiceDiagnostics(request: Request) {
  if (!voiceDiagnosticsEnabled()) throw new HttpError(404, 'Voice diagnostics are disabled.');
  if (request.headers.get('x-voice-diagnostics') !== '1') throw new HttpError(400, 'Explicit diagnostics opt-in is required.');
  return authorizeAdmin(request, 'admin-read');
}
