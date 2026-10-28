import { sameOrigin } from './origins';
import 'server-only';
import { z } from 'zod';
import { assistantInstructions } from './assistant-instructions';
import type { BusinessSettings } from './settings-schema';

export const querySchema = z.object({ query: z.string().trim().min(1).max(1000) }).strict();
export function sameOriginRequest(request: Request) { return sameOrigin(request, 'voice'); }
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function readQuery(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('input');
  const text = await limitedText(request, 4096);
  return querySchema.parse(JSON.parse(text));
}
export async function limitedText(input: Request | Response, max: number) {
  const reader = input.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new Error('size');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
const passageSchema = z.object({
  id: z.string(), text: z.string(),
  source: z.object({ source_id: z.string().nullish(), source_name: z.string().nullish(), page_number: z.number().nullish() }).nullish(),
});
export async function searchKnowledge(query: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const start = performance.now();
  const result = (status: string, passages: unknown[] = []) => ({ status, passages, retrieval_ms: Math.round(performance.now() - start) });
  if (!process.env.RAG_WRAPPER_URL || !process.env.RAG_WRAPPER_API_KEY) return result('unavailable');
  try {
    const url = new URL(process.env.RAG_WRAPPER_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return result('unavailable');
    url.pathname = url.pathname.replace(/\/$/, '') + '/search';
    const response = await fetcher(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.RAG_WRAPPER_API_KEY },
      body: JSON.stringify({ query, limit: 5 }), cache: 'no-store',
      signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) { await response.body?.cancel(); return result('unavailable'); }
    const data = z.object({ results: z.array(passageSchema) }).parse(JSON.parse(await limitedText(response, 256_000)));
    const passages = data.results.slice(0, 5).map(p => ({ id: p.id.slice(0, 120), text: p.text.slice(0, 2000), source: p.source ? {
      source_id: p.source.source_id?.slice(0, 120), source_name: p.source.source_name?.slice(0, 200), page_number: p.source.page_number,
    } : null }));
    return result(passages.length ? 'ok' : 'empty', passages);
  } catch { return result('unavailable'); }
}
export function sessionConfig(settings?: BusinessSettings) {
  return { type: 'realtime', model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime', output_modalities: ['audio'],
    instructions: assistantInstructions(settings),
    audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: true, silence_duration_ms: 600 } }, output: { voice: process.env.OPENAI_REALTIME_VOICE || 'marin' } },
    tools: [{ type: 'function', name: 'search_knowledge', description: 'Retrieve business facts using a self-contained question.', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['query'], additionalProperties: false } }], tool_choice: 'auto', max_output_tokens: 800,
  };
}
