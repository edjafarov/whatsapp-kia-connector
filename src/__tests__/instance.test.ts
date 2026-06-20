import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAuthError } from '../auth-error';
import { WhatsAppRuntime } from '../instance';

/**
 * Stateful ctx: a doc store keyed by (source, source_id, type) so findBySourceId
 * round-trips an upserted doc — needed by the day-merge and media re-link paths.
 * `docs` keeps every upsert call in order for assertions; `current(...)` reads
 * the latest stored version.
 */
function harness() {
  const docs: any[] = [];
  const store = new Map<string, any>();
  let nextId = 0n;
  const key = (s: string, sid: string, t: string) => `${s}|${sid}|${t}`;
  const ctx: any = {
    db: { all: async () => [], run: async () => {} },
    accountId: 1n,
    converter: { convert: async () => ({ markdown: null }) },
    findBySourceId: async (s: string, sid: string, t: string) =>
      store.get(key(s, sid, t)) ?? null,
    upsertDocument: async (d: any) => {
      const k = key(d.source, d.source_id, d.type);
      const id = store.get(k)?.id ?? (nextId += 1n);
      const doc = { ...d, id };
      store.set(k, doc);
      docs.push(doc);
      return id;
    },
    saveSyncState: async () => {},
  };
  const ev = new EventEmitter();
  const sock: any = { ev: { on: ev.on.bind(ev) }, end: () => {} };
  const current = (sid: string) =>
    store.get(key('whatsapp', sid, 'whatsapp_chat_day'));
  return { docs, ctx, ev, store, current, makeSocket: () => sock };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await wait(5);
  }
  throw new Error('waitFor: condition not met in time');
}

describe('WhatsAppRuntime', () => {
  it('ingests a live text message into a chat-day doc', async () => {
    const h = harness();
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir: '/tmp/x',
      makeSocket: h.makeSocket,
      downloadMedia: async () => null,
    });
    await rt.startRealtime();
    h.ev.emit('connection.update', { connection: 'open' });
    h.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { id: 'M1', remoteJid: 'alice@s.whatsapp.net' },
          messageTimestamp: 1749634895,
          message: { conversation: 'hi' },
        },
      ],
    });
    await rt.flush();
    const day = h.docs.find((d) => d.type === 'whatsapp_chat_day');
    expect(day.markdown).toContain('hi');
  });

  it('auto-flushes after an ingest without an explicit flush/pollDelta', async () => {
    const h = harness();
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir: '/tmp/x',
      makeSocket: h.makeSocket,
      downloadMedia: async () => null,
      flushDebounceMs: 1,
    });
    await rt.startRealtime();
    h.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { id: 'M1', remoteJid: 'alice@s.whatsapp.net' },
          messageTimestamp: 1749634895,
          message: { conversation: 'auto' },
        },
      ],
    });
    // No flush()/pollDelta() call: the debounced timer must materialize the doc.
    await waitFor(() =>
      h.docs.some(
        (d) => d.type === 'whatsapp_chat_day' && /auto/.test(d.markdown),
      ),
    );
  });

  it('renders pushName instead of a phone number', async () => {
    const h = harness();
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir: '/tmp/x',
      makeSocket: h.makeSocket,
      downloadMedia: async () => null,
    });
    await rt.startRealtime();
    h.ev.emit('messages.upsert', {
      type: 'notify',
      messages: [
        {
          key: { id: 'M1', remoteJid: '49170111@s.whatsapp.net' },
          pushName: 'Alice Example',
          messageTimestamp: 1749634895,
          message: { conversation: 'hi' },
        },
      ],
    });
    await rt.flush();
    const day = h.docs.find((d) => d.type === 'whatsapp_chat_day');
    expect(day.markdown).toContain('Alice Example:');
    expect(day.markdown).not.toContain('+49170111');
  });

  it('resolves a chat name from a history-sync contacts payload', async () => {
    const h = harness();
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir: '/tmp/x',
      makeSocket: h.makeSocket,
      downloadMedia: async () => null,
    });
    await rt.startRealtime();
    h.ev.emit('messaging-history.set', {
      contacts: [{ id: '49170222@s.whatsapp.net', name: 'Bob Builder' }],
      chats: [],
      messages: [
        {
          key: { id: 'H1', remoteJid: '49170222@s.whatsapp.net' },
          messageTimestamp: 1749634895,
          message: { conversation: 'hey' },
        },
      ],
    });
    await rt.flush();
    const day = h.docs.find((d) => d.type === 'whatsapp_chat_day');
    expect(day.title).toContain('Bob Builder');
    expect(day.markdown).toContain('Bob Builder:');
  });

  it('writes the day doc immediately and re-links media after it downloads', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-media-'));
    const h = harness();
    let downloaded = false;
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir,
      makeSocket: h.makeSocket,
      // Slow-ish download so the day doc is flushed BEFORE bytes arrive.
      downloadMedia: async () => {
        await wait(15);
        downloaded = true;
        return Buffer.from('imgbytes');
      },
    });
    try {
      await rt.startRealtime();
      h.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [
          {
            key: { id: 'IMG1', remoteJid: 'alice@s.whatsapp.net' },
            messageTimestamp: 1749634895,
            message: {
              imageMessage: { mimetype: 'image/jpeg', caption: 'cap' },
            },
          },
        ],
      });
      // Text path: the day doc exists right away with a placeholder, no link yet.
      await rt.flush();
      const sid = h.docs.find((d) => d.type === 'whatsapp_chat_day')!.source_id;
      expect(h.current(sid).markdown).toContain('[image]');
      expect(h.current(sid).markdown).not.toContain('doc://');
      expect(downloaded).toBe(false);

      // Background media completes → a file doc is emitted and the day re-links.
      await waitFor(() => /doc:\/\//.test(h.current(sid).markdown));
      expect(h.docs.some((d) => d.type === 'file')).toBe(true);
      expect(h.current(sid).markdown).toContain('[Attachment](doc://');
    } finally {
      await rt.shutdown();
      fs.rmSync(mediaDir, { recursive: true, force: true });
    }
  });

  it('marks logged-out so pollDelta throws an auth error', async () => {
    const h = harness();
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir: '/tmp/x',
      makeSocket: h.makeSocket,
      downloadMedia: async () => null,
    });
    await rt.startRealtime();
    h.ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    let threw: unknown;
    try {
      await rt.pollDelta();
    } catch (e) {
      threw = e;
    }
    expect(isAuthError(threw)).toBe(true);
  });

  // C1: a freshly-paired account runs startBackfill THEN startRealtime; both
  // must funnel through ensureStarted so only ONE Baileys socket ever opens
  // (two would share the one Signal key store and run two live connections).
  it('opens at most one socket across startBackfill + startRealtime', async () => {
    const h = harness();
    let made = 0;
    const ev = new EventEmitter();
    const sock: any = { ev: { on: ev.on.bind(ev) }, end: () => {} };
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir: '/tmp/x',
      makeSocket: () => {
        made += 1;
        return sock;
      },
      downloadMedia: async () => null,
    });
    await rt.startBackfill();
    await rt.startRealtime();
    expect(made).toBe(1);
  });

  // Two messages for the same chat arriving in the same tick must both land in
  // the day doc — the ingest mutex serializes them so neither clobbers the other.
  it('does not lose a message arriving alongside a media message', async () => {
    const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-i1-'));
    const h = harness();
    const rt = new WhatsAppRuntime({
      ctx: h.ctx,
      accountId: 1n,
      selfJid: 'me@s.whatsapp.net',
      mediaDir,
      makeSocket: h.makeSocket,
      downloadMedia: async () => {
        await new Promise((r) => setTimeout(r, 0));
        return Buffer.from('x');
      },
    });
    try {
      await rt.startRealtime();
      h.ev.emit('connection.update', { connection: 'open' });
      h.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [
          {
            key: { id: 'IMG1', remoteJid: 'alice@s.whatsapp.net' },
            messageTimestamp: 1749634895,
            message: {
              imageMessage: {
                mimetype: 'image/jpeg',
                caption: 'photo-caption',
              },
            },
          },
        ],
      });
      h.ev.emit('messages.upsert', {
        type: 'notify',
        messages: [
          {
            key: { id: 'TXT2', remoteJid: 'alice@s.whatsapp.net' },
            messageTimestamp: 1749634896,
            message: { conversation: 'second-text' },
          },
        ],
      });
      await rt.flush();
      const day = h.docs.find((d) => d.type === 'whatsapp_chat_day');
      expect(day).toBeDefined();
      expect(day.markdown).toContain('photo-caption');
      expect(day.markdown).toContain('second-text');
    } finally {
      await rt.shutdown();
      fs.rmSync(mediaDir, { recursive: true, force: true });
    }
  });
});
