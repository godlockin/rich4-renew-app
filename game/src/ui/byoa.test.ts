/** BYOA 素材包 TAR 驗證與載入測試（以記憶體合成測試用 USTAR 封裝，不含任何商業素材）。 */
import { describe, expect, it } from 'vitest';
import { REQUIRED_ASSET_PATHS, extractTarFile, readTarJson, validateAssetTar } from './byoa';

const enc = new TextEncoder();

function buildTar(files: Array<{ name: string; content: string | Uint8Array; type?: '0' | '5' }>): Uint8Array {
  const chunks: Uint8Array[] = [];

  for (const f of files) {
    const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    const header = new Uint8Array(512);
    const nameBytes = enc.encode(f.name);
    if (nameBytes.length > 100) {
      throw new Error(`Test helper name too long: ${f.name}`);
    }
    header.set(nameBytes, 0);
    // mode
    header.set(enc.encode('0000644\0'), 100);
    // uid, gid
    header.set(enc.encode('0000000\0'), 108);
    header.set(enc.encode('0000000\0'), 116);
    // size in octal (11 digits + NUL)
    const sizeOct = data.length.toString(8).padStart(11, '0');
    header.set(enc.encode(`${sizeOct}\0`), 124);
    // mtime
    header.set(enc.encode('00000000000\0'), 136);
    // checksum placeholder (8 spaces)
    header.fill(0x20, 148, 156);
    // typeflag
    header[156] = (f.type ?? '0').charCodeAt(0);
    // ustar magic + version
    header.set(enc.encode('ustar\0'), 257);
    header.set(enc.encode('00'), 263);

    // compute checksum
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    const chkOct = sum.toString(8).padStart(6, '0');
    header.set(enc.encode(`${chkOct}\0 `), 148);

    chunks.push(header);
    if (data.length > 0) {
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
      padded.set(data, 0);
      chunks.push(padded);
    }
  }

  // two 512-byte zero blocks for EOF
  chunks.push(new Uint8Array(1024));

  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

describe('BYOA TAR validator (byoa.ts)', () => {
  it('validates a compliant TAR archive and reads JSON manifests', () => {
    const tar = buildTar([
      { name: 'assets/', content: '', type: '5' },
      { name: 'assets/maps/maps.json', content: JSON.stringify({ maps: [{ id: 1, name: 'TestMap' }] }) },
      { name: 'assets/orig/manifest.json', content: JSON.stringify({ version: 1 }) },
      { name: 'assets/hd/manifest-hd.json', content: JSON.stringify({ scale: 4 }) },
    ]);

    const res = validateAssetTar(tar);
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.entries.filter(e => e.type === 'file')).toHaveLength(3);

    const maps = readTarJson<{ maps: { id: number; name: string }[] }>(tar, res.entries, 'assets/maps/maps.json');
    expect(maps?.maps[0]?.name).toBe('TestMap');

    const hdEntry = res.entries.find(e => e.path === 'assets/hd/manifest-hd.json')!;
    expect(new TextDecoder().decode(extractTarFile(tar, hdEntry))).toBe('{"scale":4}');
  });

  it('normalizes leading ./ paths', () => {
    const tar = buildTar([
      { name: './assets/maps/maps.json', content: '{}' },
      { name: './assets/orig/manifest.json', content: '{}' },
      { name: './assets/hd/manifest-hd.json', content: '{}' },
    ]);

    const res = validateAssetTar(tar);
    expect(res.ok).toBe(true);
    expect(res.entries.map(e => e.path)).toEqual([...REQUIRED_ASSET_PATHS]);
  });

  it('reports missing required asset paths', () => {
    const tar = buildTar([
      { name: 'assets/maps/maps.json', content: '{}' },
      { name: 'assets/orig/manifest.json', content: '{}' },
    ]);

    const res = validateAssetTar(tar);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['assets/hd/manifest-hd.json']);
  });

  it('rejects corrupted TAR header checksum', () => {
    const tar = buildTar([{ name: 'assets/maps/maps.json', content: '{}' }]);
    tar[10] ^= 0xff; // corrupt name byte without updating checksum
    const res = validateAssetTar(tar);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('校驗和');
  });

  it('rejects truncated payload or undersized buffers', () => {
    expect(validateAssetTar(new Uint8Array(100)).ok).toBe(false);

    const tar = buildTar([
      { name: 'assets/maps/maps.json', content: 'x'.repeat(600) },
      { name: 'assets/orig/manifest.json', content: '{}' },
      { name: 'assets/hd/manifest-hd.json', content: '{}' },
    ]);
    // Truncate right in the middle of the first file's 600-byte payload
    const truncated = tar.subarray(0, 512 + 300);
    const res = validateAssetTar(truncated);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('截斷');
  });

  it('rejects path traversal and absolute paths', () => {
    const traversal = buildTar([{ name: '../etc/passwd', content: 'root' }]);
    expect(validateAssetTar(traversal).ok).toBe(false);

    const absolute = buildTar([{ name: '/assets/maps/maps.json', content: '{}' }]);
    expect(validateAssetTar(absolute).ok).toBe(false);
  });

  it('rejects empty TAR archive', () => {
    const empty = new Uint8Array(1024);
    const res = validateAssetTar(empty);
    expect(res.ok).toBe(false);
  });
});
