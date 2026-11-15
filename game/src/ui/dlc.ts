/**
 * 資源分包與按需 DLC 管理（對應 scripts/bundle-assets.mjs 的 --pack 分包）。
 * 基礎包僅保留通用 UI 與原版經典地圖；自製地圖、大富豪五城與圖鑑立繪可按需下載與驗證。
 */
import { ASSETS } from './assets';

export type PackId = 'tycoon' | 'kabukicho' | 'jiqing' | 'finale' | 'challenge';

export interface DlcPackInfo {
  id: PackId;
  name: string;
  desc: string;
  probe: string;
}

export const DLC_PACKS: readonly DlcPackInfo[] = [
  { id: 'tycoon', name: '大富豪・日本五城', desc: '東京、大阪、札幌、九州、沖繩地圖與地方事件', probe: `${ASSETS}/maps/remake/map-100.json` },
  { id: 'kabukicho', name: '歌舞伎町', desc: '夜生活主題地圖、店鋪與柏青哥小遊戲', probe: `${ASSETS}/maps/remake/map-106.json` },
  { id: 'jiqing', name: '激情歲月', desc: '北京舊城懷舊地圖、大喇叭廣播與專屬皮膚', probe: `${ASSETS}/maps/remake/map-107.json` },
  { id: 'finale', name: '大富翁城', desc: '純籌碼終極決戰與五種賭場大廳', probe: `${ASSETS}/maps/remake/map-105.json` },
  { id: 'challenge', name: '圖鑑高清立繪', desc: '425 張挑戰與每月任務原創插畫卡', probe: `${ASSETS}/maps/remake/challenge/star.webp` },
];

const KEY = 'rich4.dlc.installed';

/** 依地圖 ID 判斷所需 DLC 分包；原版地圖回傳 null。 */
export function packForMap(mapId: number): PackId | null {
  if (mapId >= 100 && mapId <= 104) return 'tycoon';
  if (mapId === 105) return 'finale';
  if (mapId === 106) return 'kabukicho';
  if (mapId === 107) return 'jiqing';
  return null;
}

/** 讀取本機已標記安裝的 DLC 清單。 */
export function installedPacks(): Set<PackId> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (Array.isArray(raw)) return new Set(raw.filter((x): x is PackId => typeof x === 'string'));
  } catch { /* none */ }
  return new Set();
}

/** 標記某分包已就緒。 */
export function markPackInstalled(id: PackId): void {
  const set = installedPacks();
  set.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

/**
 * 檢查分包是否可用：若本機已標記安裝，或本地/完整打包資源中已存在探針檔案即回傳 true。
 */
export async function isPackReady(id: PackId, probeFn?: (url: string) => Promise<boolean>): Promise<boolean> {
  if (installedPacks().has(id)) return true;
  const info = DLC_PACKS.find(p => p.id === id);
  if (!info) return true;
  const check = probeFn ?? (async (url: string) => {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return r.ok;
    } catch {
      return false;
    }
  });
  const ok = await check(info.probe);
  if (ok) markPackInstalled(id);
  return ok;
}
