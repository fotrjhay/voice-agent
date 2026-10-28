import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateUpload, uploadLimit, MAX_UPLOAD_BYTES } from '../lib/upload-validation';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DOCUMENT_MAX_UPLOAD_BYTES', '');

});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('file validation', () => {
  it.each([
    ['guide.txt', 'text/plain', 'plain text'], ['guide.md', 'text/markdown', '# Guide'],
    ['guide.text', 'text/plain', 'more text'], ['guide.csv', 'text/csv', 'name,value\nrow,1'],
    ['guide.json', 'application/json', '{"business":"example"}'], ['guide.PDF', 'application/pdf', '%PDF-1.7\nexample\n%%EOF'],
  ])('accepts supported content %s', async (name, mime, content) => {
    expect((await validateUpload(name, mime, Buffer.from(content))).name).toBe(name);
  });
  it('inspects DOCX structure rather than trusting a .docx extension', async () => {
    const bytes = readFileSync(new URL('./fixtures/minimal.docx', import.meta.url));
    expect((await validateUpload('guide.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes)).mimeType).toContain('wordprocessingml');
    await expect(validateUpload('guide.docx', 'application/octet-stream', Buffer.from('PK-not-a-real-archive'))).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    ['guide.exe', 'application/octet-stream', 'binary'], ['../guide.txt', 'text/plain', 'text'],
    ['guide.pdf', 'application/pdf', '<html>not PDF</html>'], ['guide.json', 'application/json', '{'],
    ['guide.txt', 'application/pdf', 'text'], ['bad\nname.txt', 'text/plain', 'text'],
    ['guide.txt', 'text/plain', '\0binary'], ['guide.txt', 'text/plain', ''],
  ])('rejects invalid file %j', async (name, mime, content) => {
    await expect(validateUpload(name, mime, Buffer.from(content))).rejects.toThrow();
  });
  it('enforces UTF-8 and rejects binary bytes in text files', async () => {
    await expect(validateUpload('guide.txt', 'text/plain', Buffer.from([0xff, 0xfe, 0x80]))).rejects.toMatchObject({ status: 400 });
  });
  it('supports a lower operator limit but never raises the 3 MiB ceiling', async () => {
    vi.stubEnv('DOCUMENT_MAX_UPLOAD_BYTES', '5'); expect(uploadLimit()).toBe(5);
    await expect(validateUpload('guide.txt', 'text/plain', Buffer.from('123456'))).rejects.toMatchObject({ status: 413 });
    vi.stubEnv('DOCUMENT_MAX_UPLOAD_BYTES', String(MAX_UPLOAD_BYTES + 1)); expect(uploadLimit).toThrow();
    vi.stubEnv('DOCUMENT_MAX_UPLOAD_BYTES', 'invalid'); expect(uploadLimit).toThrow();
  });
});
