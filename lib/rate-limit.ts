import 'server-only';
import { query } from './db';
import { HttpError } from './http-error';

// Fixed, bounded buckets in PostgreSQL work across Vercel function instances.
export async function rateLimit(bucket: 'auth' | 'admin-read' | 'admin-write' | 'admin-upload', limit: number) {
  const result = await query<{ hits: number }>(`INSERT INTO voice_agent_admin.rate_limits (bucket, window_start, hits)
    VALUES ($1, date_trunc('minute', clock_timestamp()), 1)
    ON CONFLICT (bucket) DO UPDATE SET
      hits = CASE WHEN rate_limits.window_start = EXCLUDED.window_start THEN rate_limits.hits + 1 ELSE 1 END,
      window_start = EXCLUDED.window_start RETURNING hits`, [bucket]);
  if (result.rows[0].hits > limit) throw new HttpError(429, 'Too many requests. Wait one minute and retry.');
}
