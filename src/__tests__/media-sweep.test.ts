/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openTestDb } from './harness';
import { sweepMediaCache } from '../media';

describe('sweepMediaCache', () => {
  it('deletes bytes for terminal/text docs, keeps in-flight ones', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-sweep-'));
    const db = openTestDb();
    const write = (h: string) => fs.writeFileSync(path.join(base, h), 'x');
    // doc A: has text, no deep row → deletable
    write('aaa');
    write('bbb');
    write('ccc');
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:1','file','a','txt','{}','','aaa','t','t','t')`,
    );
    // doc B: image, no markdown, deep row 'pending' → keep
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:2','file','b',NULL,'{}','','bbb','t','t','t')`,
    );
    const bId = (
      await db.all(`SELECT id FROM documents WHERE content_hash='bbb'`)
    )[0].id as bigint;
    await db.run(
      `INSERT INTO deep_extractions (document_id,state,content_hash) VALUES (?, 'pending','bbb')`,
      [bId],
    );
    // doc C: image, deep row 'done' → deletable
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:3','file','c',NULL,'{}','','ccc','t','t','t')`,
    );
    const cId = (
      await db.all(`SELECT id FROM documents WHERE content_hash='ccc'`)
    )[0].id as bigint;
    await db.run(
      `INSERT INTO deep_extractions (document_id,state,content_hash) VALUES (?, 'done','ccc')`,
      [cId],
    );

    // Shared content_hash 'ddd': two docs at the SAME cache file. D1 is done,
    // D2 is still pending → the shared file must be KEPT (D2 still needs it).
    write('ddd');
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:4','file','d1',NULL,'{}','','ddd','t','t','t')`,
    );
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:5','file','d2',NULL,'{}','','ddd','t','t','t')`,
    );
    const d1Id = (
      await db.all(`SELECT id FROM documents WHERE source_id='c:4'`)
    )[0].id as bigint;
    const d2Id = (
      await db.all(`SELECT id FROM documents WHERE source_id='c:5'`)
    )[0].id as bigint;
    await db.run(
      `INSERT INTO deep_extractions (document_id,state,content_hash) VALUES (?, 'done','ddd')`,
      [d1Id],
    );
    await db.run(
      `INSERT INTO deep_extractions (document_id,state,content_hash) VALUES (?, 'pending','ddd')`,
      [d2Id],
    );

    // Shared content_hash 'eee': two docs at the SAME cache file, BOTH done →
    // the shared file must be DELETED (no sibling still needs it).
    write('eee');
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:6','file','e1',NULL,'{}','','eee','t','t','t')`,
    );
    await db.run(
      `INSERT INTO documents (source,source_id,type,title,markdown,metadata,source_url,content_hash,created_at,ingested_at,updated_at)
       VALUES ('whatsapp','c:7','file','e2',NULL,'{}','','eee','t','t','t')`,
    );
    const e1Id = (
      await db.all(`SELECT id FROM documents WHERE source_id='c:6'`)
    )[0].id as bigint;
    const e2Id = (
      await db.all(`SELECT id FROM documents WHERE source_id='c:7'`)
    )[0].id as bigint;
    await db.run(
      `INSERT INTO deep_extractions (document_id,state,content_hash) VALUES (?, 'done','eee')`,
      [e1Id],
    );
    await db.run(
      `INSERT INTO deep_extractions (document_id,state,content_hash) VALUES (?, 'done','eee')`,
      [e2Id],
    );

    const n = await sweepMediaCache(db, base);
    // A delete, B keep, C delete, ddd keep, eee delete ⇒ 3
    expect(n).toBe(3);
    expect(fs.existsSync(path.join(base, 'aaa'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'bbb'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'ccc'))).toBe(false);
    expect(fs.existsSync(path.join(base, 'ddd'))).toBe(true);
    expect(fs.existsSync(path.join(base, 'eee'))).toBe(false);

    // Idempotent: a second sweep removes nothing more.
    expect(await sweepMediaCache(db, base)).toBe(0);

    await db.close();
  });
});
