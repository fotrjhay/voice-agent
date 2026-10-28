import { z } from 'zod';
import { authorizeAdmin } from '../../../../lib/auth';
import { adminError } from '../../../../lib/admin-response';
import { listDocuments, uploadDocument } from '../../../../lib/documents';
import { uploadLimit, validateUpload } from '../../../../lib/upload-validation';
import { HttpError } from '../../../../lib/http-error';
import { json } from '../../../../lib/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    await authorizeAdmin(request, 'admin-read');
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { pageToken } = z.object({ pageToken: z.string().min(1).max(8192).optional() }).strict().parse(params);
    return json(await listDocuments(pageToken));
  } catch (error) { return adminError(error); }
}
export async function POST(request: Request) {
  try {
    const { user } = await authorizeAdmin(request, 'admin-upload');
    // Raw binary avoids multipart/base64 expansion and keeps request size under Vercel's 4.5 MB limit.
    // The browser supplies a name, never a destination folder or Drive credential.
    const limit = uploadLimit();
    const length = request.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new HttpError(413, 'The file exceeds the configured upload limit (at most 3 MiB).');
    if (new URL(request.url).search) throw new HttpError(400, 'Upload destinations cannot be set by the browser.');
    let name: string;
    try { name = decodeURIComponent(request.headers.get('x-file-name') || ''); }
    catch { throw new HttpError(400, 'The file name is invalid.'); }
    const reader = request.body?.getReader();
    if (!reader) throw new HttpError(400, 'Choose a file to upload.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new HttpError(413, 'The file exceeds the configured upload limit (at most 3 MiB).');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const file = await validateUpload(name, request.headers.get('content-type') || '', Buffer.concat(chunks));
    const stored = await uploadDocument(file, request.headers.get('x-upload-key') || '', user.id);
    return json({ file: stored, status: 'uploaded_to_dropbox', message: 'Uploaded to Dropbox. Search availability is not yet tracked.' }, 201);
  } catch (error) { return adminError(error); }
}
