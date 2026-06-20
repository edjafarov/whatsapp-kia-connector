import { ContactBook } from '../contacts';

describe('ContactBook', () => {
  it('resolves a known JID to its display name', () => {
    const book = new ContactBook('11111@s.whatsapp.net');
    book.set('22222@s.whatsapp.net', 'Alice');
    expect(book.name('22222@s.whatsapp.net')).toBe('Alice');
  });

  it('labels our own JID as "You"', () => {
    const book = new ContactBook('11111@s.whatsapp.net');
    expect(book.name('11111@s.whatsapp.net')).toBe('You');
  });

  it('falls back to the phone number for unknown JIDs', () => {
    const book = new ContactBook('11111@s.whatsapp.net');
    expect(book.name('49170123@s.whatsapp.net')).toBe('+49170123');
  });
});
