import { ContactBook } from '../contacts';
import { normalizeWAMessage } from '../messages';

const book = new ContactBook('me@s.whatsapp.net');
book.set('alice@s.whatsapp.net', 'Alice');

describe('normalizeWAMessage', () => {
  it('normalizes a plain text message', () => {
    const n = normalizeWAMessage(
      {
        key: {
          id: 'M1',
          remoteJid: 'c@g.us',
          participant: 'alice@s.whatsapp.net',
        },
        messageTimestamp: 1749634895,
        message: { conversation: 'hello there' },
      } as any,
      book,
      'c@g.us',
    );
    expect(n).toMatchObject({
      id: 'M1',
      sender: 'Alice',
      text: 'hello there',
      system: false,
    });
    expect(n!.tsMs).toBe(1749634895000);
  });

  it('describes an image message with a caption', () => {
    const n = normalizeWAMessage(
      {
        key: {
          id: 'M2',
          remoteJid: 'c@g.us',
          participant: 'alice@s.whatsapp.net',
        },
        messageTimestamp: 1749634900,
        message: { imageMessage: { caption: 'look', mimetype: 'image/jpeg' } },
      } as any,
      book,
      'c@g.us',
    );
    expect(n!.media).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' });
    expect(n!.text).toBe('look');
  });

  it('returns null for a key without a message body (e.g. reactions)', () => {
    const n = normalizeWAMessage(
      {
        key: { id: 'M3', remoteJid: 'c@g.us' },
        messageTimestamp: 1,
        message: { reactionMessage: {} },
      } as any,
      book,
      'c@g.us',
    );
    expect(n).toBeNull();
  });
});
