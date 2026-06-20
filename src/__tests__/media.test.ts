import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storeMedia } from '../media';

function fakeCtx() {
  const docs: any[] = [];
  return {
    docs,
    upsertDocument: async (d: any) => {
      docs.push(d);
      return BigInt(docs.length);
    },
  } as any;
}

describe('storeMedia', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-'));

  it('writes bytes to <base>/<sha256> and emits a file doc', async () => {
    const ctx = fakeCtx();
    const bytes = Buffer.from('hello');
    const converter = { convert: async () => ({ markdown: null }) } as any;
    const docId = await storeMedia({
      ctx,
      accountId: 1n,
      baseDir: base,
      converter,
      chatKey: 'c1@s.whatsapp.net',
      msgId: 'm1',
      sentAtMs: Date.parse('2019-07-04T10:00:00Z'),
      bytes,
      filename: 'pic.jpg',
      mimeType: 'image/jpeg',
    });
    expect(typeof docId).toBe('string');
    const doc = ctx.docs[0];
    expect(doc.type).toBe('file');
    expect(doc.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.markdown).toBeNull();
    expect(doc.metadata.mime_type).toBe('image/jpeg');
    // created_at is the message send time, not import time (date-filtered retrieval).
    expect((doc.created_at as Date).getTime()).toBe(
      Date.parse('2019-07-04T10:00:00Z'),
    );
    expect(fs.existsSync(path.join(base, doc.content_hash))).toBe(true);
  });

  it('stores converter text for a supported document', async () => {
    const ctx = fakeCtx();
    const converter = {
      convert: async () => ({ markdown: 'invoice total 42' }),
    } as any;
    await storeMedia({
      ctx,
      accountId: 1n,
      baseDir: base,
      converter,
      chatKey: 'c1',
      msgId: 'm2',
      sentAtMs: Date.parse('2019-07-04T10:00:00Z'),
      bytes: Buffer.from('%PDF'),
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
    });
    expect(ctx.docs[0].markdown).toBe('invoice total 42');
  });
});
