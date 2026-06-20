import fs from 'node:fs';
import path from 'node:path';
import { parseExportTranscript } from '../import-parse';

const fx = (n: string) =>
  fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

describe('parseExportTranscript', () => {
  it('parses an iOS transcript: system, text, multiline, media', () => {
    const msgs = parseExportTranscript(fx('ios_chat.txt'), {
      daysFirst: false,
    });
    expect(msgs[0].system).toBe(true);
    const alice = msgs.find((m) => m.text === 'morning!')!;
    expect(alice.sender).toBe('Alice');
    const media = msgs.find((m) => m.media)!;
    expect(media.media!.kind).toBe('image');
    const multiline = msgs.find((m) => m.text.includes('second line'))!;
    expect(multiline.text).toContain('see you');
  });

  it('parses an Android transcript with day-first dates', () => {
    const msgs = parseExportTranscript(fx('android_chat.txt'), {
      daysFirst: true,
    });
    expect(msgs.find((m) => m.text === 'morning!')!.sender).toBe('Alice');
    expect(msgs.some((m) => m.media?.kind === 'image')).toBe(true);
  });

  it('assigns stable synthetic ids (hash of ts+sender+text)', () => {
    const a = parseExportTranscript(fx('android_chat.txt'), {
      daysFirst: true,
    });
    const b = parseExportTranscript(fx('android_chat.txt'), {
      daysFirst: true,
    });
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  it('disambiguates same-minute duplicate messages, deterministically', () => {
    // Minute-precision Android timestamps: two identical messages in the same
    // minute must still get distinct ids (else mergeMessages collapses them).
    const transcript = [
      '11/06/2026, 09:41 - Alice: ok',
      '11/06/2026, 09:41 - Alice: ok',
    ].join('\n');
    const a = parseExportTranscript(transcript, { daysFirst: true });
    expect(a).toHaveLength(2);
    expect(new Set(a.map((m) => m.id)).size).toBe(2);
    // Re-parsing the same input yields the same two ids (deterministic).
    const b = parseExportTranscript(transcript, { daysFirst: true });
    expect(b.map((m) => m.id)).toEqual(a.map((m) => m.id));
  });
});
