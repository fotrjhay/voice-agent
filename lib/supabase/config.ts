export function supabaseConfig() {
  // Server/proxy runtime lookup; do not freeze deployment configuration into a build.
  const env = process.env;
  const url = Reflect.get(env, 'NEXT_PUBLIC_SUPABASE_URL') || '';
  const key = Reflect.get(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || '';
  const parsed = new URL(url);
  if (!key || parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(parsed.hostname) && parsed.protocol === 'http:'))) throw new Error('Supabase configuration missing');
  return { url: parsed.origin, key };
}
