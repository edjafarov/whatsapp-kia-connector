/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

describe('dist bundle loads standalone', () => {
  it('exports {connector,hooks,makeByteSource} with no node_modules reachable', () => {
    const dist = path.join(__dirname, '..', '..', 'dist', 'index.js');
    expect(fs.existsSync(dist)).toBe(true); // run `npm run build` first
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-iso-'));
    fs.copyFileSync(dist, path.join(dir, 'index.js'));
    const probe = path.join(dir, 'probe.js');
    fs.writeFileSync(
      probe,
      `const m = require('./index.js');
       if (!m.connector || m.connector.id !== 'whatsapp') throw new Error('no connector');
       if (!m.hooks || !m.hooks['begin-pairing'] || !m.hooks['whatsapp-import']) throw new Error('no hooks');
       if (typeof m.makeByteSource !== 'function') throw new Error('no makeByteSource');
       if (m.makeByteSource({ dataDir: '/tmp' }).source !== 'whatsapp') throw new Error('bad byteSource');
       console.log('OK');`,
    );
    const out = execFileSync('node', [probe], { cwd: dir, encoding: 'utf8' });
    expect(out.trim()).toBe('OK');
  });
});
