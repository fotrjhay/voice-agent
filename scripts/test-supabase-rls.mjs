import pg from 'pg';
import { readFile } from 'node:fs/promises';
if (process.env.RUN_SUPABASE_RLS_TESTS !== 'yes-disposable' || !process.env.SUPABASE_RLS_TEST_DATABASE_URL) {
  console.log('SKIP RLS integration: explicitly configure a disposable Supabase database and RUN_SUPABASE_RLS_TESTS=yes-disposable.');
  process.exit(0);
}
const url = new URL(process.env.SUPABASE_RLS_TEST_DATABASE_URL);
for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
const local = ['localhost', '127.0.0.1'].includes(url.hostname);
const client = new pg.Client({ connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true, ...(process.env.SUPABASE_RLS_TEST_CA ? { ca: process.env.SUPABASE_RLS_TEST_CA.replace(/\\n/g, '\n') } : {}) }, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
try {
  await client.connect();
  await client.query(await readFile(new URL('../tests/rls.integration.sql', import.meta.url), 'utf8'));
  console.log('PASS disposable Supabase policies: anonymous/non-admin denial, self-grant denial, explicit admin access and concurrency. All fixtures rolled back.');
} catch {
  await client.query('ROLLBACK').catch(() => {}); console.error('RLS integration failed. Check the disposable database/migrations and inspect policies with the operator. Provider details suppressed.'); process.exitCode = 1;
} finally { await client.end(); }
