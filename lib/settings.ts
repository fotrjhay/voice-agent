import 'server-only';
import { databaseConfigured, query } from './db';
import { settingsSchema, type BusinessSettings } from './settings-schema';
import { HttpError } from './http-error';
import type { SupabaseServer } from './supabase/server';
import { z } from 'zod';

function savedResult(input: unknown) {
  const parsed = z.object({ settings: settingsSchema, version: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), updated_at: z.string() }).safeParse(input);
  if (!parsed.success) throw new HttpError(503, 'Saved settings are invalid. Ask the operator to check the database.');
  return { settings: parsed.data.settings, version: parsed.data.version, updatedAt: parsed.data.updated_at, source: 'database' as const };
}

export function environmentSettings(): BusinessSettings {
  const parsed = settingsSchema.safeParse({
    businessName: process.env.BUSINESS_NAME || 'Your business',
    greeting: process.env.AGENT_GREETING || 'Hello! How can I help you today?',
    tone: process.env.AGENT_TONE || 'friendly',
    instructions: process.env.AGENT_INSTRUCTIONS || 'Be friendly and concise. Ask one clarification at a time when needed.',
    supportEmail: process.env.SUPPORT_EMAIL || '', supportPhone: process.env.SUPPORT_PHONE || '', supportUrl: process.env.SUPPORT_URL || '',
  });
  if (!parsed.success) throw new HttpError(503, 'The initial business settings are invalid. Check the server configuration.');
  return parsed.data;
}

export async function getBusinessSettings() {
  if (!databaseConfigured()) return { settings: environmentSettings(), source: 'environment' as const, updatedAt: null, version: 0 };
  const result = await query<{ settings: unknown; updated_at: Date; version: string | number }>('SELECT settings, updated_at, version FROM voice_agent_admin.business_settings WHERE id = 1');
  if (!result.rows.length) return { settings: environmentSettings(), source: 'environment' as const, updatedAt: null, version: 0 };
  const parsed = settingsSchema.safeParse(result.rows[0].settings);
  if (!parsed.success) throw new HttpError(503, 'The saved business settings are invalid. An administrator must repair them.');
  return { settings: parsed.data, source: 'database' as const, updatedAt: result.rows[0].updated_at.toISOString(), version: Number(result.rows[0].version) };
}

export async function readAdminSettings(client: SupabaseServer) {
  const { data, error } = await client.schema('voice_agent_admin').from('business_settings').select('settings,updated_at,version').eq('id', 1).maybeSingle();
  if (error) throw new HttpError(503, 'Saved settings could not be read. Check Supabase access and retry.');
  if (!data) return { settings: environmentSettings(), source: 'environment', updatedAt: null, version: 0 };
  return savedResult(data);
}
export async function saveBusinessSettings(input: unknown, client: SupabaseServer) {
  const { settings, version } = z.object({ settings: settingsSchema, version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict().parse(input);
  const { data, error } = await client.schema('voice_agent_admin').rpc('save_settings', { new_settings: settings, expected_version: version }).single();
  if (error?.code === 'P0001') throw new HttpError(409, 'Settings changed since you loaded them. Reload settings, review your edits and save again.');
  if (error || !data) throw new HttpError(503, 'Settings could not be saved. Check Supabase access and retry.');
  return savedResult(data);
}
