import 'server-only';
import { Pool, type QueryResultRow } from 'pg';
import { HttpError } from './http-error';

const state = globalThis as typeof globalThis & { voiceAdminPool?: Pool };
export function databaseConfigured() { return Boolean(process.env.ADMIN_DATABASE_URL?.trim()); }

function pool() {
  if (state.voiceAdminPool) return state.voiceAdminPool;
  if (!databaseConfigured()) throw new HttpError(503, 'The admin database is not configured.');
  const url = new URL(process.env.ADMIN_DATABASE_URL!);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database configuration');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const disableTls = process.env.ADMIN_DATABASE_TLS === 'disable' && local && process.env.NODE_ENV !== 'production';
  // URL SSL options must not override certificate verification.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  state.voiceAdminPool = new Pool({
    connectionString: url.toString(), max: 2, idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
    ssl: disableTls ? false : { rejectUnauthorized: true, ...(process.env.ADMIN_DATABASE_CA ? { ca: process.env.ADMIN_DATABASE_CA.replace(/\\n/g, '\n') } : {}) },
  });
  state.voiceAdminPool.on('error', () => { /* Do not log provider errors or connection strings. */ });
  return state.voiceAdminPool;
}

export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
  try { return await pool().query<T>(sql, values); }
  catch { throw new HttpError(503, 'The settings database is unavailable. Check connectivity and the admin migration, then retry.'); }
}
