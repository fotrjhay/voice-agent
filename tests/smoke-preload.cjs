// Explicit test-process preloader only. All SQL goes to a local in-memory mock, never PostgreSQL.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  // Test-only interception keeps the production URL validator active without external requests.
  if (url.origin === 'https://pipecat.smoke.test') return originalFetch(`${process.env.SMOKE_BACKEND_URL}/pipecat${url.pathname}`, init);
  return originalFetch(input, init);
};
globalThis.voiceAdminPool = {
  async query(sql, values) {
    const response = await fetch(`${process.env.SMOKE_BACKEND_URL}/sql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, values }) });
    if (!response.ok) throw new Error('Mock SQL failed');
    const result = await response.json();
    for (const row of result.rows) if (row.updated_at) row.updated_at = new Date(row.updated_at);
    return result;
  },
};
