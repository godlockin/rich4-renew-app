import { beforeEach, describe, expect, it } from 'vitest';
import { DLC_PACKS, installedPacks, isPackReady, markPackInstalled, packForMap } from './dlc';

function mockStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

describe('DLC 分包管理 (ui/dlc.ts)', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = mockStorage();
  });

  it('正確映射地圖 ID 到對應 DLC 分包', () => {
    expect(packForMap(0)).toBeNull();
    expect(packForMap(7)).toBeNull();
    expect(packForMap(100)).toBe('tycoon');
    expect(packForMap(104)).toBe('tycoon');
    expect(packForMap(105)).toBe('finale');
    expect(packForMap(106)).toBe('kabukicho');
    expect(packForMap(107)).toBe('jiqing');
    expect(DLC_PACKS.length).toBe(5);
  });

  it('偵測探針資源存在時自動標記已安裝', async () => {
    expect(installedPacks().has('kabukicho')).toBe(false);
    const ok = await isPackReady('kabukicho', async () => true);
    expect(ok).toBe(true);
    expect(installedPacks().has('kabukicho')).toBe(true);
  });

  it('探針失敗且未安裝時回傳 false，手動標記後回傳 true', async () => {
    expect(await isPackReady('jiqing', async () => false)).toBe(false);
    markPackInstalled('jiqing');
    expect(await isPackReady('jiqing', async () => false)).toBe(true);
  });
});
