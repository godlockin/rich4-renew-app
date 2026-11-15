/** OTA 清單簽章往返測試：驗證 scripts/sign-update.mjs 產生的金鑰與簽章可通過 update.ts verifyManifestSignature。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyManifestSignature } from './update';

const here = dirname(fileURLToPath(import.meta.url));
const signScript = resolve(here, '../../scripts/sign-update.mjs');

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rich4-ota-sign-'));
  tempDirs.push(dir);
  return dir;
}

describe('OTA 清單簽章 (sign-update.mjs + verifyManifestSignature)', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips --keygen and --sign with verifyManifestSignature', async () => {
    const dir = makeTempDir();
    const privPath = join(dir, 'ota.pem');
    const pubPath = join(dir, 'ota.pub.b64');
    const manifestPath = join(dir, '1.2.3.json');

    execFileSync(process.execPath, [signScript, '--keygen', '--out-key', privPath, '--out-pub', pubPath], {
      encoding: 'utf8',
    });
    const pubKeyB64 = readFileSync(pubPath, 'utf8').trim();
    expect(pubKeyB64.length).toBeGreaterThan(32);

    const manifest = {
      version: '1.2.3',
      shell: 1,
      files: {
        'assets/b.webp': ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 200],
        'index.html': ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 100],
      } as Record<string, [string, number]>,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

    execFileSync(process.execPath, [signScript, '--sign', manifestPath, '--key', privPath], {
      encoding: 'utf8',
    });

    const signed = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest & { sig?: string };
    expect(typeof signed.sig).toBe('string');
    expect(signed.sig!.length).toBeGreaterThan(0);

    // Valid signature passes
    expect(await verifyManifestSignature(signed, pubKeyB64)).toBe(true);

    // CLI --verify also passes
    const verifyOut = execFileSync(process.execPath, [signScript, '--verify', manifestPath, '--pub', pubPath], {
      encoding: 'utf8',
    });
    expect(verifyOut).toContain('Signature VALID');
  });

  it('rejects tampered file hash, version, shell, or extra file', async () => {
    const dir = makeTempDir();
    const privPath = join(dir, 'ota.pem');
    const pubPath = join(dir, 'ota.pub.b64');
    const manifestPath = join(dir, '1.2.4.json');

    execFileSync(process.execPath, [signScript, '--keygen', '--out-key', privPath, '--out-pub', pubPath], {
      encoding: 'utf8',
    });
    const pubKeyB64 = readFileSync(pubPath, 'utf8').trim();

    const manifest = {
      version: '1.2.4',
      shell: 1,
      files: {
        'index.html': ['11111111111111111111111111111111', 512],
        'assets/app.js': ['22222222222222222222222222222222', 1024],
      } as Record<string, [string, number]>,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    execFileSync(process.execPath, [signScript, '--sign', manifestPath, '--key', privPath], { encoding: 'utf8' });
    const signed = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest & { sig: string };

    // Tampered file hash
    const tamperedHash = {
      ...signed,
      files: { ...signed.files, 'index.html': ['ffffffffffffffffffffffffffffffff', 512] as [string, number] },
    };
    expect(await verifyManifestSignature(tamperedHash, pubKeyB64)).toBe(false);

    // Tampered version
    expect(await verifyManifestSignature({ ...signed, version: '9.9.9' }, pubKeyB64)).toBe(false);

    // Tampered shell
    expect(await verifyManifestSignature({ ...signed, shell: 2 }, pubKeyB64)).toBe(false);

    // Added unexpected file
    const extraFile = {
      ...signed,
      files: { ...signed.files, 'evil.js': ['33333333333333333333333333333333', 10] as [string, number] },
    };
    expect(await verifyManifestSignature(extraFile, pubKeyB64)).toBe(false);
  });

  it('rejects signatures verified against a different public key or missing sig', async () => {
    const dir = makeTempDir();
    const priv1 = join(dir, 'k1.pem');
    const pub1 = join(dir, 'k1.pub');
    const priv2 = join(dir, 'k2.pem');
    const pub2 = join(dir, 'k2.pub');
    const manifestPath = join(dir, '2.0.0.json');

    execFileSync(process.execPath, [signScript, '--keygen', '--out-key', priv1, '--out-pub', pub1]);
    execFileSync(process.execPath, [signScript, '--keygen', '--out-key', priv2, '--out-pub', pub2]);

    const pubKey1 = readFileSync(pub1, 'utf8').trim();
    const pubKey2 = readFileSync(pub2, 'utf8').trim();

    const manifest = {
      version: '2.0.0',
      shell: 1,
      files: { 'index.html': ['abcdef0123456789abcdef0123456789', 42] as [string, number] },
    };
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
    execFileSync(process.execPath, [signScript, '--sign', manifestPath, '--key', priv1]);
    const signed = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest & { sig: string };

    expect(await verifyManifestSignature(signed, pubKey1)).toBe(true);
    expect(await verifyManifestSignature(signed, pubKey2)).toBe(false);
    expect(await verifyManifestSignature(manifest, pubKey1)).toBe(false);
    expect(await verifyManifestSignature(manifest, '')).toBe(true);
  });
});
