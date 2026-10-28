import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
let storage: typeof import('../lib/storage');
const path = '/documents/6f9e4709-8a18-46ee-8a98-f9b8d5ea4520.txt';
const file = { name: 'Original guide.txt', mimeType: 'text/plain', bytes: Buffer.from('business text') };
const token = () => Response.json({ access_token: 'temporary-test-access', expires_in: 3600 });
const missing = () => Response.json({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }, { status: 409 });
function receipt() { return { '.tag': 'file', id: 'id:stable-dropbox-id', name: path.split('/').pop(), rev: 'revision-1', content_hash: storage.dropboxHash(file.bytes), path_lower: path, server_modified: '2026-10-28T12:00:00Z' }; }
beforeEach(async () => {
  vi.resetModules(); storage = await import('../lib/storage');
  vi.stubEnv('DROPBOX_APP_KEY', 'app-key'); vi.stubEnv('DROPBOX_APP_SECRET', 'app-secret'); vi.stubEnv('DROPBOX_REFRESH_TOKEN', 'offline-refresh'); vi.stubEnv('DROPBOX_UPLOAD_FOLDER', '/documents');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('refreshes offline credentials server-side and uploads to the fixed reserved path', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json(receipt())); vi.stubGlobal('fetch', fetcher);
  const result = await storage.documentStorage.upload(file, path, storage.dropboxHash(file.bytes));
  expect(result).toMatchObject({ id: 'id:stable-dropbox-id', revision: 'revision-1', provider: 'dropbox' });
  const refresh = fetcher.mock.calls[0]; expect(refresh[0]).toBe('https://api.dropboxapi.com/oauth2/token'); expect(refresh[1].body.get('grant_type')).toBe('refresh_token');
  expect(refresh[1].body.get('refresh_token')).toBe('offline-refresh');
  const upload = fetcher.mock.calls[2]; expect(upload[0]).toBe('https://content.dropboxapi.com/2/files/upload');
  expect(JSON.parse(upload[1].headers['Dropbox-API-Arg'])).toMatchObject({ path, mode: 'add', autorename: false, strict_conflict: true });
  expect(JSON.stringify(result)).not.toMatch(/offline-refresh|app-secret|temporary-test-access/);
});
it('uses Dropbox block-hash semantics rather than a plain file SHA256', () => {
  const expected = createHash('sha256').update(createHash('sha256').update(file.bytes).digest()).digest('hex');
  expect(storage.dropboxHash(file.bytes)).toBe(expected);
});
it('does not upload again after a prior successful attempt with the same reserved path', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json(receipt())); vi.stubGlobal('fetch', fetcher);
  expect((await storage.documentStorage.upload(file, path, storage.dropboxHash(file.bytes))).id).toBe('id:stable-dropbox-id');
  expect(fetcher.mock.calls.some(call => call[0].includes('files/upload'))).toBe(false);
});
it('resolves a concurrent create conflict to the same verified file, without autorename', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json({ error: { '.tag': 'path' } }, { status: 409 })).mockResolvedValueOnce(Response.json(receipt())); vi.stubGlobal('fetch', fetcher);
  expect((await storage.documentStorage.upload(file, path, storage.dropboxHash(file.bytes))).id).toBe('id:stable-dropbox-id');
});
it('rejects reserved paths containing different content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ ...receipt(), content_hash: 'different' })));
  await expect(storage.documentStorage.upload(file, path, storage.dropboxHash(file.bytes))).rejects.toMatchObject({ status: 409 });
});
it('keeps a missing receipt after a create conflict retryable rather than reporting a false content mismatch', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json({ error: { '.tag': 'path' } }, { status: 409 })).mockResolvedValueOnce(missing()));
  await expect(storage.documentStorage.upload(file, path, storage.dropboxHash(file.bytes))).rejects.toMatchObject({ status: 502 });
});
it('refreshes and retries only once after an expired access token', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ entries: [], has_more: false, cursor: 'end' })); vi.stubGlobal('fetch', fetcher);
  expect((await storage.documentStorage.list()).files).toEqual([]);
  expect(fetcher.mock.calls.filter(call => call[0].includes('oauth2/token'))).toHaveLength(2);
});
it('paginates actual files and filters out paths outside the configured folder', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(Response.json({ entries: [receipt(), { ...receipt(), path_lower: '/other/file.txt' }, { '.tag': 'folder', name: 'nested' }], has_more: true, cursor: 'next' })).mockResolvedValueOnce(Response.json({ entries: [], has_more: false, cursor: 'end' })); vi.stubGlobal('fetch', fetcher);
  const first = await storage.documentStorage.list(); expect(first.files).toHaveLength(1); expect(first.nextPageToken).toBe('next');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ path: '/documents', recursive: false, limit: 50 });
  await storage.documentStorage.list(first.nextPageToken); expect(fetcher.mock.calls[2][0]).toContain('list_folder/continue'); expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ cursor: 'next' });
});
it.each(['/documents/../outside.txt', '/other/6f9e4709-8a18-46ee-8a98-f9b8d5ea4520.txt', '/documents/nested/6f9e4709-8a18-46ee-8a98-f9b8d5ea4520.txt'])('rejects an unsafe destination %s', async badPath => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(storage.documentStorage.upload(file, badPath, 'hash')).rejects.toMatchObject({ status: 400 }); expect(fetcher).not.toHaveBeenCalled();
});
it('fails closed without refresh credentials and hides provider errors', async () => {
  vi.stubEnv('DROPBOX_REFRESH_TOKEN', ''); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(storage.documentStorage.list()).rejects.toMatchObject({ status: 503 }); expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv('DROPBOX_REFRESH_TOKEN', 'offline-refresh'); fetcher.mockResolvedValue(new Response('private provider details', { status: 403 }));
  await expect(storage.documentStorage.list()).rejects.toMatchObject({ status: 502, message: 'Could not list Dropbox files. Check folder access or retry.' });
});
it('keeps timeout failures retryable without claiming a file was not uploaded', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(missing()).mockRejectedValueOnce(new DOMException('private URL', 'TimeoutError')));
  await expect(storage.documentStorage.upload(file, path, storage.dropboxHash(file.bytes))).rejects.toMatchObject({ status: 502, message: 'Upload could not be confirmed. Retry the same selected file; its upload key prevents duplicates.' });
});
