import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from './http-error';
import type { validateUpload } from './upload-validation';

type Upload = Awaited<ReturnType<typeof validateUpload>>;
export type StoredFile = { id: string; name: string; revision: string; modifiedTime?: string; provider: 'dropbox' };
export interface DocumentStorage {
  list(cursor?: string): Promise<{ files: StoredFile[]; nextPageToken?: string }>;
  upload(file: Upload, path: string, expectedHash: string): Promise<StoredFile>;
}
export function uploadFolder() {
  const folder = process.env.DROPBOX_UPLOAD_FOLDER || '/documents';
  if (folder.length > 300 || !folder.startsWith('/') || folder.split('/').slice(1).some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f\\:]/.test(part))) throw new HttpError(503, 'Dropbox folder configuration is invalid.');
  return folder;
}
export function dropboxHash(bytes: Buffer) {
  const hashes: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * 1024 * 1024) hashes.push(createHash('sha256').update(bytes.subarray(offset, offset + 4 * 1024 * 1024)).digest());
  return createHash('sha256').update(Buffer.concat(hashes)).digest('hex');
}
let cachedToken: { value: string; expires: number } | undefined;
let refreshing: Promise<string> | undefined;
async function accessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const key = process.env.DROPBOX_APP_KEY, secret = process.env.DROPBOX_APP_SECRET, refresh = process.env.DROPBOX_REFRESH_TOKEN;
    if (!key || !secret || !refresh) throw new HttpError(503, 'Dropbox storage is not configured.');
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }), cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Dropbox authentication failed'); }
    const data = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json());
    cachedToken = { value: data.access_token, expires: Date.now() + Math.max(0, data.expires_in - 60) * 1000 };
    return data.access_token;
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}
class DropboxFailure extends Error {
  constructor(public status: number, public tag: string) { super('Dropbox request failed'); }
}
function asciiJson(value: unknown) { return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`); }
async function api(endpoint: string, args: unknown, bytes?: Buffer) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt === 1);
    const response = await fetch(`https://${bytes ? 'content' : 'api'}.dropboxapi.com/2/${endpoint}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, ...(bytes
        ? { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': asciiJson(args) }
        : { 'Content-Type': 'application/json' }) }, body: bytes ? new Uint8Array(bytes) : JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 && attempt === 0) { await response.body?.cancel(); cachedToken = undefined; continue; }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new DropboxFailure(response.status, data.error?.path?.['.tag'] || data.error?.['.tag'] || 'unknown');
    return data;
  }
  throw new Error('Dropbox authentication failed');
}
const metadata = z.object({ '.tag': z.literal('file').optional(), id: z.string().min(1).max(200), name: z.string().max(1000), rev: z.string().min(1), server_modified: z.string().optional(), content_hash: z.string().optional(), path_lower: z.string().optional() });
function stored(data: unknown): StoredFile {
  const file = metadata.parse(data);
  return { id: file.id, name: file.name, revision: file.rev, modifiedTime: file.server_modified, provider: 'dropbox' };
}
function assertPath(path: string) {
  if (!path.startsWith(`${uploadFolder()}/`) || !/\/[a-f0-9-]{36}\.(pdf|docx|txt|md|text|csv|json)$/.test(path) || path.slice(uploadFolder().length + 1).includes('/')) throw new HttpError(400, 'Invalid upload destination.');
}
async function existing(path: string) {
  try { return metadata.parse(await api('files/get_metadata', { path })); }
  catch (error) { if (error instanceof DropboxFailure && error.status === 409 && error.tag === 'not_found') return null; throw error; }
}
export const documentStorage: DocumentStorage = {
  async list(cursor) {
    try {
      const folder = uploadFolder();
      const data = await api(cursor ? 'files/list_folder/continue' : 'files/list_folder', cursor ? { cursor } : { path: folder, recursive: false, include_deleted: false, limit: 50 });
      const parsed = z.object({ entries: z.array(z.unknown()).max(10000), cursor: z.string().max(8192), has_more: z.boolean() }).parse(data);
      const files = parsed.entries.filter(entry => (entry as { '.tag'?: string })?.['.tag'] === 'file').map(entry => metadata.parse(entry))
        .filter(file => file.path_lower?.slice(0, file.path_lower.lastIndexOf('/')) === folder.toLowerCase()).map(stored);
      return { files, nextPageToken: parsed.has_more ? parsed.cursor : undefined };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Could not list Dropbox files. Check folder access or retry.');
    }
  },
  async upload(file, path, expectedHash) {
    assertPath(path);
    try {
      let receipt = await existing(path);
      if (!receipt) {
        try { receipt = metadata.parse(await api('files/upload', { path, mode: 'add', autorename: false, strict_conflict: true, mute: true }, file.bytes)); }
        catch (error) {
          if (!(error instanceof DropboxFailure && error.status === 409)) throw error;
          receipt = await existing(path);
        }
      }
      if (!receipt) throw new Error('Upload receipt not confirmed');
      if (receipt.content_hash !== expectedHash) throw new HttpError(409, 'The reserved Dropbox path contains different content. Contact the operator.');
      return stored(receipt);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'Upload could not be confirmed. Retry the same selected file; its upload key prevents duplicates.');
    }
  },
};
