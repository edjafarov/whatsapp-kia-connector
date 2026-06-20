/**
 * @jest-environment node
 *
 * This is main-process code; force the node test environment. The default
 * jsdom env breaks adm-zip's inflate (getData() returns empty) because it
 * swaps the Buffer/zlib realm, which the zip round-trip test below relies on.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { importTranscriptText, importChatFile } from '../import-file';

function fakeCtx() {
  const docs: any[] = [];
  return {
    docs,
    findBySourceId: async () => null,
    upsertDocument: async (d: any) => {
      docs.push(d);
      return BigInt(docs.length);
    },
  } as any;
}

function tmpBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wa-imp-'));
}

const converter = { convert: async () => ({ markdown: null }) } as any;

/** Import a one-line android transcript under a given chat name; return the
 *  chat-day doc that was upserted. */
async function importNamed(chatName: string, transcript: string) {
  const ctx = fakeCtx();
  await importTranscriptText({
    ctx,
    accountId: 7n,
    baseDir: tmpBase(),
    converter,
    chatName,
    transcript,
    mediaFiles: new Map(),
  });
  return ctx.docs.find((d: any) => d.type === 'whatsapp_chat_day');
}

const ONE_LINE = '11/06/2026, 09:41 - Alice: morning!\n';

describe('importTranscriptText', () => {
  it('parses a transcript and upserts chat-day docs', async () => {
    const ctx = fakeCtx();
    const base = tmpBase();
    const text = fs.readFileSync(
      path.join(__dirname, 'fixtures', 'android_chat.txt'),
      'utf8',
    );
    const r = await importTranscriptText({
      ctx,
      accountId: 7n,
      baseDir: base,
      converter,
      chatName: 'Family',
      transcript: text,
      mediaFiles: new Map(),
    });
    expect(r.days).toBeGreaterThanOrEqual(1);
    const dayDoc = ctx.docs.find((d: any) => d.type === 'whatsapp_chat_day');
    expect(dayDoc.source_id).toMatch(/^name:family:\d{4}-\d{2}-\d{2}$/);
    expect(dayDoc.markdown).toContain('Alice: morning!');
  });

  describe('nameKey (Fix 1: distinct names must not collide)', () => {
    it('keeps diacritic-only-different German names distinct', async () => {
      const muller = await importNamed('Müller', ONE_LINE);
      const moller = await importNamed('Möller', ONE_LINE);
      // The old slug stripped non-ASCII so both → "mller"; NFKD decomposition
      // preserves the distinct base vowels.
      expect(muller.source_id).toMatch(/^name:muller:\d{4}-\d{2}-\d{2}$/);
      expect(moller.source_id).toMatch(/^name:moller:\d{4}-\d{2}-\d{2}$/);
      expect(muller.source_id).not.toBe(moller.source_id);
    });

    it('hash-falls-back for a fully non-Latin (CJK) name', async () => {
      const doc = await importNamed('家族', ONE_LINE);
      // Slug is empty after stripping → stable 12-hex hash key (not empty,
      // so distinct non-Latin chats never merge into one identity).
      expect(doc.source_id).toMatch(/^name:[0-9a-f]{12}:\d{4}-\d{2}-\d{2}$/);
    });

    it('gives two different CJK names different hash keys', async () => {
      const a = await importNamed('家族', ONE_LINE);
      const b = await importNamed('会社', ONE_LINE);
      expect(a.source_id).not.toBe(b.source_id);
    });
  });

  describe('chat type (Fix 2: dm/group from distinct senders)', () => {
    it('labels a 3-sender transcript as group', async () => {
      const transcript =
        '11/06/2026, 09:41 - Alice: hi\n' +
        '11/06/2026, 09:42 - Bob: yo\n' +
        '11/06/2026, 09:43 - Carol: hey\n';
      const doc = await importNamed('Crew', transcript);
      expect(doc.metadata.chat_type).toBe('group');
    });

    it('labels a 2-sender transcript as dm even with a system notice', async () => {
      const transcript =
        '11/06/2026, 09:40 - Messages and calls are end-to-end encrypted. Tap to learn more.\n' +
        '11/06/2026, 09:41 - Alice: hi\n' +
        '11/06/2026, 09:42 - Bob: yo\n';
      const doc = await importNamed('Bob', transcript);
      expect(doc.metadata.chat_type).toBe('dm');
    });
  });
});

describe('importChatFile', () => {
  it('extracts a transcript from a zip and derives the chat name', async () => {
    const ctx = fakeCtx();
    const dir = tmpBase();
    const zipPath = path.join(dir, 'export.zip');
    const zip = new AdmZip();
    zip.addFile(
      'WhatsApp Chat with Family.txt',
      Buffer.from(
        '11/06/2026, 09:41 - Alice: morning!\n' +
          '11/06/2026, 09:42 - Bob: IMG-20260611-WA0001.jpg (file attached)\n',
      ),
    );
    zip.addFile('IMG-20260611-WA0001.jpg', Buffer.from('fakejpg'));
    zip.writeZip(zipPath);

    const r = await importChatFile({
      ctx,
      accountId: 7n,
      baseDir: dir,
      converter,
      filePath: zipPath,
    });
    expect(r).toMatchObject({ ok: true });
    const dayDoc = ctx.docs.find((d: any) => d.type === 'whatsapp_chat_day');
    expect(dayDoc).toBeTruthy();
    expect(dayDoc.source_id).toContain('name:family');
  });

  it('returns ok:false (does not throw) on a corrupt zip', async () => {
    const ctx = fakeCtx();
    const dir = tmpBase();
    const badPath = path.join(dir, 'broken.zip');
    fs.writeFileSync(badPath, Buffer.from('not a zip'));

    const r = await importChatFile({
      ctx,
      accountId: 7n,
      baseDir: dir,
      converter,
      filePath: badPath,
    });
    expect(r.ok).toBe(false);
    expect(ctx.docs).toHaveLength(0);
  });

  it('returns ok:false for an unreadable transcript path', async () => {
    const ctx = fakeCtx();
    const dir = tmpBase();
    const r = await importChatFile({
      ctx,
      accountId: 7n,
      baseDir: dir,
      converter,
      filePath: path.join(dir, 'does-not-exist.txt'),
    });
    expect(r.ok).toBe(false);
  });
});
