import { json, sameOriginRequest, readQuery, searchKnowledge } from '../../../lib/server';
export async function POST(request: Request) {
  if (!sameOriginRequest(request)) return json({ error: 'Same-origin access required. Check the server APP_ORIGIN configuration.' }, 403);
  let query: string;
  try { ({ query } = await readQuery(request)); }
  catch { return json({ error: 'Provide only a query of 1–1000 characters.' }, 400); }
  return json(await searchKnowledge(query, request.signal));
}
