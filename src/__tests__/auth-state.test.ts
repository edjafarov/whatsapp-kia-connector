import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeEncryptedAuthState } from '../auth-state';

// In-memory SafeStorageLike (no Electron in unit tests).
const ss = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8'),
};

describe('makeEncryptedAuthState', () => {
  it('round-trips creds through the encrypted blob', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-')),
      'creds.bin',
    );
    const a = await makeEncryptedAuthState(file, ss);
    a.state.creds.me = { id: '123@s.whatsapp.net', name: 'Me' } as any;
    await a.saveCreds();
    const b = await makeEncryptedAuthState(file, ss);
    expect(b.state.creds.me?.id).toBe('123@s.whatsapp.net');
  });

  it('starts from fresh creds when no blob exists', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-')),
      'creds.bin',
    );
    const a = await makeEncryptedAuthState(file, ss);
    expect(a.state.creds.registered).toBe(false);
  });

  it('preserves an undecryptable blob and starts fresh (no throw)', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-')),
      'creds.bin',
    );
    // A real-but-unreadable file (e.g. safeStorage key rotated): present on disk
    // but decryptString throws. Must NOT be silently wiped.
    fs.writeFileSync(file, Buffer.from('garbage-cipher-bytes'));
    const badSs = {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: () => {
        throw new Error('bad key');
      },
    };
    const a = await makeEncryptedAuthState(file, badSs);
    expect(a.state.creds.registered).toBe(false);
    // The unreadable blob is moved aside so the next saveCreds can't clobber it.
    expect(fs.existsSync(`${file}.corrupt`)).toBe(true);
  });

  it('refuses to persist when encryption is unavailable', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-')),
      'creds.bin',
    );
    const noEncSs = {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8'),
    };
    // Load path is fine (no file yet); the guard fires only on write.
    const a = await makeEncryptedAuthState(file, noEncSs);
    await expect(a.saveCreds()).rejects.toThrow(/unavailable/);
  });
});
