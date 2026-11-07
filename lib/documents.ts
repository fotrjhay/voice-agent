import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query } from './db';
import { HttpError } from './http-error';
import { documentStorage, dropboxHash, uploadFolder, type StoredFile } from './storage';
import type { validateUpload } from './upload-validation';

function businessId() {
  const id = process.env.BUSINESS_ID || 'primary';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new HttpError(503, 'Business identifier configuration is invalid.');
  return id;
}

async function ingestionStatusAvailable() {
  const result = await query<{ available: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema = 'voice_agent_admin'
      AND table_name = 'documents' AND column_name = 'ingestion_state'
  ) AS available`);
  return result.rows[0]?.available === true;
}
type Record = { document_id: string; original_name: string; content_hash: string; byte_size: number; mime_type: string; provider_path: string; business_id: string; provider_file_id: string | null; revision: string | null; ingestion_state?: string };
export async function uploadDocument(file: Awaited<ReturnType<typeof validateUpload>>, key: string, userId: string) {
  const idempotencyKey = z.uuid().parse(key);
  const id = randomUUID();
  const business = businessId();
  const hash = dropboxHash(file.bytes);
  const path = `${uploadFolder()}/${id}.${file.name.split('.').pop()!.toLowerCase()}`;
  await query(`INSERT INTO voice_agent_admin.documents
    (document_id, idempotency_key, created_by, business_id, original_name, content_hash, byte_size, mime_type, provider_path)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (created_by, idempotency_key) DO NOTHING`,
  [id, idempotencyKey, userId, business, file.name, hash, file.bytes.length, file.mimeType, path]);
  const result = await query<Record>('SELECT document_id, original_name, content_hash, byte_size, mime_type, provider_path, business_id, provider_file_id, revision FROM voice_agent_admin.documents WHERE created_by = $1 AND idempotency_key = $2 AND provider = $3', [userId, idempotencyKey, 'dropbox']);
  const record = result.rows[0];
  if (!record) throw new HttpError(503, 'Upload reservation could not be read. Retry the same file.');
  if (record.business_id !== business || record.content_hash !== hash || record.byte_size !== file.bytes.length || record.original_name !== file.name || record.mime_type !== file.mimeType) throw new HttpError(409, 'This upload key belongs to a different file. Select the document again to start a new upload.');
  const stored = await documentStorage.upload(file, record.provider_path, hash);
  try { await query('UPDATE voice_agent_admin.documents SET provider_file_id = $1, revision = $2 WHERE document_id = $3', [stored.id, stored.revision, record.document_id]); }
  catch { throw new HttpError(503, 'The file may be in Dropbox, but its receipt could not be saved. Retry the same file without selecting it again.'); }
  const sourceId = `${business}:${record.document_id}`;
  const ingestionUrl = process.env.INGESTION_SERVICE_URL;
  const ingestionKey = process.env.INGESTION_API_KEY;
  if (ingestionUrl && ingestionKey && await ingestionStatusAvailable()) {
    const target = new URL('/ingest', ingestionUrl);
    if (target.protocol !== 'https:' || target.username || target.password) throw new HttpError(503, 'Invalid ingestion configuration.');
    // Atomically claim dispatch. An uncertain request remains processing and is never blindly retried.
    const claim = await query('UPDATE voice_agent_admin.documents SET ingestion_state=$1 WHERE document_id=$2 AND ingestion_state=$3 RETURNING document_id', ['processing', record.document_id, 'uploaded']);
    if (claim.rows.length) {
      const body = new FormData();
      body.set('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.name);
      body.set('company_id', business); body.set('source_id', sourceId); body.set('source_name', file.name);
      body.set('replace_source', 'false'); body.set('dry_run', 'false');
      try {
        const response = await fetch(target, { method: 'POST', headers: { 'X-API-Key': ingestionKey }, body, redirect: 'error', signal: AbortSignal.timeout(40000) });
        const result = await response.json();
        const state = response.ok && result.success === true && result.records_inserted > 0 && result.source_id === sourceId && result.company_id === business ? 'indexed' : 'failed';
        await query('UPDATE voice_agent_admin.documents SET ingestion_state=$1 WHERE document_id=$2', [state, record.document_id]);
      } catch { /* A timeout may follow a committed write. Keep processing for operator reconciliation. */ }
    }
  }
  return { ...stored, name: record.original_name, documentId: record.document_id, sourceId, businessId: business };
}
export async function listDocuments(cursor?: string) {
  const result = await documentStorage.list(cursor);
  const ids = result.files.map(file => file.id);
  const statusColumn = ids.length && await ingestionStatusAvailable() ? 'ingestion_state' : "'uploaded' AS ingestion_state";
  const records = ids.length ? await query<Record>(`SELECT document_id, original_name, business_id, provider_file_id, revision, ${statusColumn} FROM voice_agent_admin.documents WHERE provider = $1 AND provider_file_id = ANY($2::text[]) AND business_id = $3`, ['dropbox', ids, businessId()]) : { rows: [] };
  return { ...result, files: await Promise.all(result.files.map(async (file: StoredFile) => {
    const record = records.rows.find(row => row.provider_file_id === file.id);
    let status = record?.ingestion_state === 'indexed' ? 'unverified' : record?.ingestion_state || 'uploaded';
    if (record?.revision && record.revision !== file.revision) status = 'uploaded';
    if (record?.ingestion_state === 'indexed' && record.revision === file.revision && process.env.RAG_WRAPPER_URL && process.env.RAG_WRAPPER_API_KEY) {
      try {
        const response = await fetch(new URL(`/sources/${encodeURIComponent(`${record.business_id}:${record.document_id}`)}`, process.env.RAG_WRAPPER_URL), { headers: { 'X-API-Key': process.env.RAG_WRAPPER_API_KEY }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
        const evidence = await response.json();
        if (response.ok && evidence.source_id === `${record.business_id}:${record.document_id}` && evidence.available === true && evidence.records > 0) status = 'searchable';
      } catch { /* Availability is unverified. */ }
    }
    return record ? { ...file, status, name: record.original_name, documentId: record.document_id, sourceId: `${record.business_id}:${record.document_id}`, businessId: record.business_id } : { ...file, status: 'uploaded' };
  })) };
}
