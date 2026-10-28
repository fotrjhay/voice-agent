// Shared by the proxy and routes. Never derive an allowed public origin from request headers.
function origin(value: string) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Invalid origin');
  return url;
}
export function appOrigins() {
  const voice = process.env.VOICE_APP_ORIGIN?.trim() || process.env.APP_ORIGIN?.trim()
    || (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  const admin = process.env.ADMIN_APP_ORIGIN?.trim() || voice;
  return { voice: voice ? origin(voice) : null, admin: admin ? origin(admin) : null };
}
export function requestSite(request: Request) {
  try {
    const host = request.headers.get('host');
    if (!host || (request.headers.has('x-forwarded-host') && request.headers.get('x-forwarded-host') !== host)) return null;
    const configured = appOrigins();
    if (configured.admin?.host === host) return { origin: configured.admin.origin, adminRoot: configured.admin.host !== configured.voice?.host };
    if (configured.voice?.host === host) return { origin: configured.voice.origin, adminRoot: false };
    if (!configured.voice && !configured.admin) {
      const url = origin(`${new URL(request.url).protocol}//${host}`);
      if (url.host === host && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return { origin: url.origin, adminRoot: false };
    }
  } catch { /* Invalid configuration fails closed. */ }
  return null;
}
export function sameOrigin(request: Request, target: 'voice' | 'admin' = 'admin') {
  const site = requestSite(request);
  if (!site || request.headers.get('origin') !== site.origin || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (target === 'voice') {
    try { const voice = appOrigins().voice; return !voice || site.origin === voice.origin; } catch { return false; }
  }
  return true;
}
