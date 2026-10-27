import { json, localRequest, readQuery, searchKnowledge } from '../../../lib/server';
export async function POST(request: Request) {
  if (!localRequest(request)) return json({ error: 'Local same-origin access required.' }, 403);
  let query: string;
  try { ({ query } = await readQuery(request)); }
  catch { return json({ error: 'Provide only a query of 1–1000 characters.' }, 400); }
  return json(await searchKnowledge(query, request.signal));
}
