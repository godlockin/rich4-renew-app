/** BYOA 執行期素材包儲存與查詢測試（以記憶體合成測試用 USTAR 封裝，不含任何商業素材）。 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ByoaPackStore,
  clearByoaPack,
  getByoaAsset,
  getByoaJson,
  getByoaObjectUrl,
  hasByoaPack,
  importByoaTar,
  revokeAll,
} from './byoa-store';

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
    header.set(enc.encode('0000644\0'), 100);
    header.set(enc.encode('0000000\0'), 108);
    header.set(enc.encode('0000000\0'), 116);
    const sizeOct = data.length.toString(8).padStart(11, '0');
    header.set(enc.encode(`${sizeOct}\0`), 124);
    header.set(enc.encode('00000000000\0'), 136);
    header.fill(0x20, 148, 156);
    header[156] = (f.type ?? '0').charCodeAt(0);
    header.set(enc.encode('ustar\0'), 257);
    header.set(enc.encode('00'), 263);

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

describe('BYOA runtime store (byoa-store.ts)', () => {
  beforeEach(async () => {
    await clearByoaPack();
  });

  it('imports a valid TAR pack and retrieves JSON and binary assets', async () => {
    const binPayload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const tar = buildTar([
      { name: 'assets/', content: '', type: '5' },
      { name: 'assets/maps/maps.json', content: JSON.stringify({ maps: [{ id: 1, name: 'Taiwan' }] }) },
      { name: 'assets/orig/manifest.json', content: JSON.stringify({ version: 2 }) },
      { name: 'assets/hd/manifest-hd.json', content: JSON.stringify({ scale: 4 }) },
      { name: 'assets/hd/tile.png', content: binPayload },
    ]);

    expect(await hasByoaPack()).toBe(false);

    const res = await importByoaTar(tar);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fileCount).toBe(4);
      expect(res.totalBytes).toBeGreaterThan(binPayload.length);
    }
    expect(await hasByoaPack()).toBe(true);

    const maps = await getByoaJson<{ maps: Array<{ id: number; name: string }> }>('assets/maps/maps.json');
    expect(maps?.maps[0]?.name).toBe('Taiwan');

    // Supports leading ./ or / normalization
    const orig = await getByoaJson<{ version: number }>('./assets/orig/manifest.json');
    expect(orig?.version).toBe(2);

    const bin = await getByoaAsset('/assets/hd/tile.png');
    expect(bin).toEqual(binPayload);

    const url = await getByoaObjectUrl('assets/hd/tile.png');
    expect(url).toMatch(/^blob:/);
    revokeAll();
  });

  it('rejects invalid TAR archives without overwriting existing pack state', async () => {
    const badTar = buildTar([
      { name: 'assets/maps/maps.json', content: '{}' },
      { name: 'assets/orig/manifest.json', content: '{}' },
    ]);

    const missingRes = await importByoaTar(badTar);
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.missing).toEqual(['assets/hd/manifest-hd.json']);
      expect(missingRes.error).toBeTruthy();
    }
    expect(await hasByoaPack()).toBe(false);

    const corruptRes = await importByoaTar(new Uint8Array(64));
    expect(corruptRes.ok).toBe(false);
    if (!corruptRes.ok) {
      expect(corruptRes.error).toContain('TAR');
    }
  });

  it('clears stored assets with clearByoaPack()', async () => {
    const tar = buildTar([
      { name: 'assets/maps/maps.json', content: '{"ok":true}' },
      { name: 'assets/orig/manifest.json', content: '{}' },
      { name: 'assets/hd/manifest-hd.json', content: '{}' },
    ]);

    const res = await importByoaTar(tar);
    expect(res.ok).toBe(true);
    expect(await hasByoaPack()).toBe(true);

    await clearByoaPack();
    expect(await hasByoaPack()).toBe(false);
    expect(await getByoaAsset('assets/maps/maps.json')).toBeNull();
    expect(await getByoaJson('assets/maps/maps.json')).toBeNull();
  });

  it('supports isolated ByoaPackStore instances in memory fallback mode', async () => {
    const store = new ByoaPackStore('test-byoa-isolated', 'files');
    const tar = buildTar([
      { name: 'assets/maps/maps.json', content: '{"id":42}' },
      { name: 'assets/orig/manifest.json', content: '{}' },
      { name: 'assets/hd/manifest-hd.json', content: '{}' },
      { name: 'notes.txt', content: 'ignored outside assets/' },
    ]);

    const res = await store.importTar(tar);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.fileCount).toBe(3);
    }
    expect(await store.getJson<{ id: number }>('assets/maps/maps.json')).toEqual({ id: 42 });
    expect(await store.getAsset('notes.txt')).toBeNull();

    await store.clear();
    expect(await store.hasPack()).toBe(false);
  });
});
