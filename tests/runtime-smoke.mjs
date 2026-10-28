// Production HTTP/SSR-cookie smoke test with a local fake Supabase boundary. No external provider calls.
import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const adminId = '6f9e4709-8a18-46ee-8a98-f9b8d5ea4520';
const ordinaryId = '9f9e4709-8a18-46ee-8a98-f9b8d5ea4520';
let settings = null, version = 0;
const sessions = new Map();
function user(id) { return { id, aud: 'authenticated', role: 'authenticated', email: id === adminId ? 'admin@example.invalid' : 'user@example.invalid', app_metadata: {}, user_metadata: { is_admin: true }, created_at: '2026-10-28T00:00:00Z' }; }
function session(id) {
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const access = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: expiry, aud: 'authenticated', session_id: randomUUID() })).toString('base64url')}.mock-signature`;
  const result = { access_token: access, refresh_token: randomUUID(), expires_in: 3600, expires_at: expiry, token_type: 'bearer', user: user(id) };
  sessions.set(access, result); return result;
}
const backend = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, 'http://localhost');
  const authenticated = sessions.get(req.headers.authorization?.replace('Bearer ', ''));
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/sql') {
    if (body.sql.includes('rate_limits')) return send(200, { rows: [{ hits: 1 }] });
    if (body.sql.startsWith('SELECT settings')) return send(200, { rows: settings ? [{ settings, version, updated_at: new Date().toISOString() }] : [] });
    return send(400, {});
  }
  if (url.pathname === '/auth/v1/token') {
    if (body.email === 'admin@example.invalid' && body.password === 'correct-test-password') return send(200, session(adminId));
    if (body.email === 'user@example.invalid' && body.password === 'correct-test-password') return send(200, session(ordinaryId));
    return send(400, { msg: 'Invalid credentials', error_code: 'invalid_credentials' });
  }
  if (url.pathname === '/auth/v1/user') {
    if (!authenticated) return send(401, { msg: 'Session revoked', error_code: 'session_not_found' });
    return send(200, authenticated.user);
  }
  if (url.pathname === '/auth/v1/logout') {
    if (authenticated) sessions.delete(authenticated.access_token);
    res.writeHead(204); return res.end();
  }
  if (url.pathname === '/auth/v1/recover') return send(200, {});
  if (url.pathname === '/auth/v1/.well-known/jwks.json') return send(200, { keys: [] });
  if (url.pathname === '/rest/v1/rpc/is_admin') return send(200, authenticated?.user.id === adminId);
  if (url.pathname === '/rest/v1/business_settings') return send(200, settings ? { settings, version, updated_at: new Date().toISOString() } : null);
  if (url.pathname === '/rest/v1/rpc/save_settings') {
    if (authenticated?.user.id !== adminId) return send(403, { code: '42501' });
    if (body.expected_version !== version) return send(409, { code: 'P0001' });
    settings = body.new_settings; version++;
    return send(200, { settings, version, updated_at: new Date().toISOString() });
  }
  return send(404, { message: 'Mock endpoint not implemented' });
});
await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
const backendUrl = `http://127.0.0.1:${backend.address().port}`;
const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const child = spawn(process.execPath, ['--require', './tests/smoke-preload.cjs', './node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', SMOKE_BACKEND_URL: backendUrl,
    VOICE_APP_ORIGIN: 'https://voice.smoke.test', ADMIN_APP_ORIGIN: 'https://admin.smoke.test', APP_ORIGIN: 'https://voice.smoke.test',
    NEXT_PUBLIC_SUPABASE_URL: backendUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_mock',
    ADMIN_DATABASE_URL: 'postgresql://never-connect@invalid.invalid/admin', BUSINESS_NAME: 'Smoke business', AGENT_GREETING: 'Hello', AGENT_INSTRUCTIONS: 'Use evidence.', AGENT_TONE: 'friendly', SUPPORT_EMAIL: '', SUPPORT_PHONE: '', SUPPORT_URL: '',
    OPENAI_API_KEY: 'unused-smoke-key', RAG_WRAPPER_URL: 'https://invalid.invalid', RAG_WRAPPER_API_KEY: 'unused', DROPBOX_UPLOAD_FOLDER: '!', DROPBOX_APP_KEY: 'unused', DROPBOX_APP_SECRET: 'unused', DROPBOX_REFRESH_TOKEN: 'unused',
  },
});
let output = ''; child.stdout.on('data', data => { output = (output + data).slice(-5000); }); child.stderr.on('data', data => { output = (output + data).slice(-5000); });
let jar = new Map();
async function request(path, { method = 'GET', body, host = 'admin.smoke.test', origin = `https://${host}`, authenticated = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { Host: host, Origin: origin, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') } : {}) } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => {
        for (const value of res.headers['set-cookie'] || []) { const [pair] = value.split(';'); const offset = pair.indexOf('='); const name = pair.slice(0, offset), content = pair.slice(offset + 1); if (!content || /Max-Age=0/i.test(value)) jar.delete(name); else jar.set(name, content); }
        resolve({ status: res.statusCode, headers: res.headers, text });
      });
    }); req.setTimeout(12000, () => req.destroy(new Error('HTTP timeout'))); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { await request('/admin/signin'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  assert.ok(ready, 'Production server did not start');
  assert.equal((await request('/', { host: 'unknown.smoke.test' })).status, 403);
  assert.equal((await request('/')).status, 307);
  for (const [path, method] of [['/api/admin/settings', 'GET'], ['/api/admin/settings', 'PUT'], ['/api/admin/documents', 'GET'], ['/api/admin/documents', 'POST']]) assert.equal((await request(path, { method, body: method === 'GET' ? undefined : {} })).status, 401);
  console.log('PASS host routing and anonymous denial for all admin operations');
  const ordinary = await request('/api/auth/login', { method: 'POST', body: { email: 'user@example.invalid', password: 'correct-test-password' } }); assert.equal(ordinary.status, 401); assert.equal(jar.size, 0);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'admin@example.invalid', password: 'correct-test-password' } });
  assert.equal(login.status, 200); assert.ok(jar.size > 0); assert.ok(login.headers['set-cookie'].some(value => /;\s*Secure/i.test(value) && /SameSite=Lax/i.test(value)));
  assert.equal((await request('/')).status, 200);
  const data = { businessName: 'Saved smoke business', greeting: 'Welcome', tone: 'professional', instructions: 'Use evidence.\nBe brief.', supportEmail: '', supportPhone: '', supportUrl: '' };
  assert.equal((await request('/api/admin/settings', { method: 'PUT', body: { settings: data, version: 0 } })).status, 200);
  assert.equal(JSON.parse((await request('/api/admin/settings')).text).version, 1);
  assert.equal((await request('/api/admin/settings', { method: 'PUT', body: { settings: data, version: 0 } })).status, 409);
  assert.ok((await request('/', { host: 'voice.smoke.test', authenticated: false })).text.includes(data.businessName));
  assert.equal((await request('/api/admin/settings', { method: 'PUT', body: { settings: data, version: 1 }, origin: 'https://voice.smoke.test' })).status, 403);
  console.log('PASS actual Supabase SSR cookies, explicit membership, settings persistence/concurrency and same-origin protection (mock provider)');
  const cookiesBeforeLogout = new Map(jar);
  assert.equal((await request('/api/auth/logout', { method: 'POST', body: {} })).status, 200); assert.equal(jar.size, 0);
  jar = cookiesBeforeLogout;
  assert.equal((await request('/api/admin/settings')).status, 401);
  console.log('PASS sign-out cookie clearing and revoked session denial');
  console.log('No live Supabase, PostgreSQL, Dropbox, OpenAI, n8n or domain changes.');
} catch (error) { console.error(error); console.error(output); process.exitCode = 1; }
finally { child.kill(); backend.closeAllConnections(); backend.close(); }
