import 'server-only';
import { fromBuffer, type Entry } from 'yauzl';
import { HttpError } from './http-error';

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const formats: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', text: 'text/plain', csv: 'text/csv', json: 'application/json',
};
export function uploadLimit() {
  const configured = Number(process.env.DOCUMENT_MAX_UPLOAD_BYTES || MAX_UPLOAD_BYTES);
  if (!Number.isSafeInteger(configured) || configured < 1 || configured > MAX_UPLOAD_BYTES) throw new HttpError(503, 'Upload size configuration is invalid.');
  return configured;
}

async function inspectDocx(data: Buffer) {
  return new Promise<void>((resolve, reject) => {
    fromBuffer(data, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('Invalid DOCX')); return; }
      let count = 0, totalSize = 0;
      let document = false, contentTypes = false, pending = false, ended = false;
      let settled = false;
      const seen = new Set<string>();
      const fail = () => { if (settled) return; settled = true; zip.close(); reject(new Error('Invalid DOCX')); };
      const finish = () => { if (ended && !pending && !settled) { if (!document || !contentTypes) { fail(); return; } settled = true; zip.close(); resolve(); } };
      zip.on('error', fail);
      zip.on('entry', (entry: Entry) => {
        if (settled) return;
        totalSize += entry.uncompressedSize;
        if (++count > 2000 || totalSize > 32 * 1024 * 1024 || (entry.generalPurposeBitFlag & 1)
          || seen.has(entry.fileName) || entry.fileName.includes('..') || entry.fileName.includes('\\') || /vbaProject\.bin$/i.test(entry.fileName)) { fail(); return; }
        seen.add(entry.fileName);
        if (entry.fileName === 'word/document.xml') document = true;
        if (entry.fileName === '[Content_Types].xml') {
          if (entry.uncompressedSize > 65536 || pending || contentTypes) { fail(); return; }
          pending = true;
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) { fail(); return; }
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 65536) { stream.destroy(); fail(); } else chunks.push(chunk); });
            stream.on('end', () => {
              contentTypes = Buffer.concat(chunks).toString('utf8').includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
              pending = false; if (!settled) zip.readEntry();
            });
          });
        } else zip.readEntry();
      });
      zip.on('end', () => { ended = true; finish(); });
      zip.readEntry();
    });
  });
}

export async function validateUpload(name: string, contentType: string, bytes: Buffer) {
  name = name.normalize('NFKC').trim();
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(name)) throw new HttpError(400, 'Use a file name of 1–180 characters without path separators or control characters.');
  const extension = name.split('.').pop()?.toLowerCase() || '';
  const mimeType = formats[extension];
  if (!mimeType) throw new HttpError(400, 'Choose a PDF, DOCX, TXT, MD, TEXT, CSV or JSON file.');
  if (!bytes.length || bytes.length > uploadLimit()) throw new HttpError(413, 'The file is empty or exceeds the configured upload limit (at most 3 MiB).');
  const supplied = contentType.split(';')[0].toLowerCase();
  const accepted = [mimeType, 'application/octet-stream'];
  if (['md', 'csv', 'json', 'text', 'txt'].includes(extension)) accepted.push('text/plain');
  if (supplied && !accepted.includes(supplied)) throw new HttpError(400, 'The file type does not match its extension.');
  try {
    if (extension === 'pdf') {
      if (bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-1024).includes(Buffer.from('%%EOF'))) throw new Error('PDF');
    } else if (extension === 'docx') {
      await inspectDocx(bytes);
    } else {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('binary');
      if (extension === 'json') JSON.parse(text);
    }
  } catch { throw new HttpError(400, 'The content is not a valid supported document. Text files must use UTF-8.'); }
  return { name, mimeType, bytes };
}
