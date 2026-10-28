import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), upload: vi.fn(), list: vi.fn() }));
vi.mock('../lib/db', () => ({ query: mocks.query }));
vi.mock('../lib/storage', async importOriginal => ({ ...await importOriginal<typeof import('../lib/storage')>(), documentStorage: { upload: mocks.upload, list: mocks.list } }));
import { uploadDocument, listDocuments } from '../lib/documents';
const key = '6f9e4709-8a18-46ee-8a98-f9b8d5ea4520', user = '9f9e4709-8a18-46ee-8a98-f9b8d5ea4520';
const file = { name: 'guide.txt', mimeType: 'text/plain', bytes: Buffer.from('guidance') };
let record: { document_id: string; original_name: string; content_hash: string; byte_size: number; mime_type: string; provider_path: string; business_id: string; provider_file_id?: string; revision?: string } | null;
beforeEach(() => {
  vi.clearAllMocks(); record = null;
  vi.stubEnv('BUSINESS_ID', 'business-one'); vi.stubEnv('DROPBOX_UPLOAD_FOLDER', '/documents');
  mocks.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.startsWith('INSERT') && !record) record = { document_id: values[0] as string, original_name: values[4] as string, content_hash: values[5] as string, byte_size: values[6] as number, mime_type: values[7] as string, provider_path: values[8] as string, business_id: values[3] as string };
    if (sql.startsWith('UPDATE') && record) { record.provider_file_id = values[0] as string; record.revision = values[1] as string; }
    return { rows: record ? [{ ...record }] : [] };
  });
  mocks.upload.mockResolvedValue({ id: 'id:provider-id', revision: 'revision', provider: 'dropbox', name: 'internal-name.txt' });
});
afterEach(() => vi.unstubAllEnvs());
it('reserves a server-generated document UUID and returns the same ID/source/path on retries', async () => {
  const first = await uploadDocument(file, key, user); const second = await uploadDocument(file, key, user);
  expect(first.documentId).not.toBe(key); expect(first.documentId).toBe(second.documentId); expect(first.sourceId).toBe(`business-one:${first.documentId}`);
  expect(first.name).toBe('guide.txt'); expect(first.businessId).toBe('business-one');
  expect(mocks.upload.mock.calls[0][1]).toBe(mocks.upload.mock.calls[1][1]);
  expect(mocks.query.mock.calls[0][0]).toContain('ON CONFLICT');
});
it('does not deduplicate different files by name and rejects reuse of a key for changed bytes', async () => {
  await uploadDocument(file, key, user);
  await expect(uploadDocument({ ...file, bytes: Buffer.from('different bytes') }, key, user)).rejects.toMatchObject({ status: 409 });
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it('preserves the retry reservation after an uncertain provider failure', async () => {
  mocks.upload.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(uploadDocument(file, key, user)).rejects.toThrow(); const path = record!.provider_path;
  await uploadDocument(file, key, user); expect(mocks.upload.mock.calls[1][1]).toBe(path);
});
it('lists actual provider files with their stored original names/source IDs and provider label', async () => {
  const saved = await uploadDocument(file, key, user);
  mocks.list.mockResolvedValue({ files: [{ id: saved.id, name: 'internal.txt', revision: 'new-revision', provider: 'dropbox' }], nextPageToken: 'next' });
  const result = await listDocuments(); expect(result.files[0]).toMatchObject({ name: 'guide.txt', sourceId: saved.sourceId, provider: 'dropbox', revision: 'new-revision' });
});
