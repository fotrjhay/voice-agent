// Operator-run only. No public setup endpoint, no automatic execution by the app.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const key = process.env.DROPBOX_APP_KEY, secret = process.env.DROPBOX_APP_SECRET;
if (!key || !secret) throw new Error('Set DROPBOX_APP_KEY and DROPBOX_APP_SECRET locally first.');
const redirect = 'http://localhost:53682/dropbox/callback';
const state = randomBytes(32).toString('hex');
const scopes = ['files.content.write', 'files.metadata.read', ...(process.argv.includes('--ingestion-read') ? ['files.content.read'] : [])];
const authorize = new URL('https://www.dropbox.com/oauth2/authorize');
authorize.search = new URLSearchParams({ client_id: key, response_type: 'code', token_access_type: 'offline', redirect_uri: redirect, state, scope: scopes.join(' ') }).toString();
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, redirect);
  const received = Buffer.from(url.searchParams.get('state') || '');
  if (url.pathname !== '/dropbox/callback' || received.length !== state.length || !timingSafeEqual(received, Buffer.from(state)) || !url.searchParams.get('code')) {
    response.writeHead(400, { 'Content-Type': 'text/plain' }); response.end('Invalid or cancelled authorization.'); return;
  }
  try {
    const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirect }), signal: AbortSignal.timeout(15000),
    });
    if (!tokenResponse.ok) throw new Error('Authorization failed');
    const token = await tokenResponse.json();
    if (typeof token.refresh_token !== 'string' || /[\r\n]/.test(token.refresh_token)) throw new Error('No refresh token');
    await writeFile('.env.dropbox-setup.local', `DROPBOX_REFRESH_TOKEN=${token.refresh_token}\n`, { flag: 'wx', mode: 0o600 });
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end('Authorization complete. The private refresh token was saved locally, not displayed here. You may close this tab.');
    console.log('Saved .env.dropbox-setup.local. Copy the value privately into .env.local / hosting secrets. Never commit or share it.');
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain' }); response.end('Could not save authorization. Check local setup and retry. No token is displayed.');
    console.error('Authorization did not complete. Ensure .env.dropbox-setup.local does not already exist before starting a new authorized setup.');
  } finally { server.close(); clearTimeout(timer); }
});
server.listen(53682, '127.0.0.1', () => {
  console.log(`Register this exact redirect in the Dropbox app console: ${redirect}`);
  console.log(`Open this URL in your own browser to authorize the operator account:\n${authorize}`);
});
const timer = setTimeout(() => { server.close(); console.error('Authorization timed out after 10 minutes.'); }, 600000);
server.on('error', () => { clearTimeout(timer); console.error('Could not bind the loopback setup port.'); process.exitCode = 1; });
