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
type Record = { document_id: string; original_name: string; content_hash: string; byte_size: number; mime_type: string; provider_path: string; business_id: string; provider_file_id: string | null; revision: string | null };
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
  return { ...stored, name: record.original_name, documentId: record.document_id, sourceId: `${business}:${record.document_id}`, businessId: business };
}
export async function listDocuments(cursor?: string) {
  const result = await documentStorage.list(cursor);
  const ids = result.files.map(file => file.id);
  const records = ids.length ? await query<Record>('SELECT document_id, original_name, business_id, provider_file_id FROM voice_agent_admin.documents WHERE provider = $1 AND provider_file_id = ANY($2::text[]) AND business_id = $3', ['dropbox', ids, businessId()]) : { rows: [] };
  return { ...result, files: result.files.map((file: StoredFile) => {
    const record = records.rows.find(row => row.provider_file_id === file.id);
    return record ? { ...file, name: record.original_name, documentId: record.document_id, sourceId: `${record.business_id}:${record.document_id}`, businessId: record.business_id } : file;
  }) };
}
