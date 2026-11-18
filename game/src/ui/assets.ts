/** Loads the locally linked game data and art (see scripts/link-assets.mjs). */
import { parseBoard, type Board, type RawMap } from '../core/board';

export const ASSETS = `${import.meta.env.BASE_URL}assets`;

/**
 * A map of the list. `kind`: 'orig' the eight original maps (map-N.json), 'custom' the 自製地圖: the remake's own maps
 * (maps/remake/index.json: 東京, 大阪, 札幌, 九州, 沖繩, 大富翁城, with their own `data` / `image` paths). The old
 * workshop maps (editor/export_custom.py, maps/custom/index.json) are no longer offered (2026-10-17): they are listed
 * `hidden`, known only so saved games on them still load and show their name. `hidden`: not offered for a new game.
 */
export interface MapInfo { id: number; name: string; thumbnail: string; custom: boolean; kind: 'orig' | 'custom'; data?: string; image?: string; hidden?: boolean }

const images = new Map<string, Promise<HTMLImageElement>>();
export function image(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`無法載入素材 ${url}`));
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`無法載入 ${url}（請先執行 npm run assets）`);
  return r.json() as Promise<T>;
}

export async function mapList(): Promise<MapInfo[]> {
  const m = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/maps.json`);
  // The 原版地圖's illustrated postcards (tools/tycoon-art/map_thumbs.py build-orig, the user 2026-11-03) where installed.
  let postcards: number[] = [];
  try { postcards = (await json<{ ids: number[] }>(`${ASSETS}/maps/remake/orig-postcards.json`)).ids ?? []; } catch { /* the plain board pictures */ }
  const list: MapInfo[] = m.maps.map(x => ({ id: x.id, name: x.name, custom: false, kind: 'orig',
    thumbnail: postcards.includes(x.id) ? `${ASSETS}/maps/remake/orig-${x.id}-postcard.webp` : `${ASSETS}/maps/${x.thumbnail}` }));
  // The remake's own maps (ids 8..999) are the 自製地圖 list (their `replaces` named the workshop map whose slot they took).
  try {
    const r = await json<{ maps: { id: number; name: string; thumbnail: string; data: string; image: string; replaces?: number[]; hidden?: boolean }[] }>(`${ASSETS}/maps/remake/index.json`);
    for (const x of r.maps) {
      // `hidden`: a map only 大富豪模式 uses (大富翁城, its finale, docs/rules/19) is known but not offered.
      list.push({ id: x.id, name: x.name, thumbnail: x.thumbnail ? `${ASSETS}/maps/${x.thumbnail}` : makeMapThumbSvg(x.name), custom: true, kind: 'custom', data: x.data, image: x.image, ...(x.hidden ? { hidden: true } : {}) });
    }
  } catch { /* none installed */ }
  // Maps made in the workshop (editor/export_custom.py, ids from 1000): never offered any more, the 自製地圖 are the
  // remake's six; kept hidden so saved games on them still load (where their files are installed).
  try {
    const c = await json<{ maps: { id: number; name: string; thumbnail: string }[] }>(`${ASSETS}/maps/custom/index.json`);
    for (const x of c.maps) list.push({ id: x.id, name: x.name, thumbnail: `${ASSETS}/maps/${x.thumbnail}`, custom: true, kind: 'custom', hidden: true });
  } catch { /* no custom maps exported */ }
  if (!list.some(m => m.id === 108)) {
    list.push({ id: 108, name: '直播市區', thumbnail: makeMapThumbSvg('直播市區'), custom: true, kind: 'custom', data: 'remake/live-city.json', image: '' });
  }
  known = list;
  return list;
}

let known: MapInfo[] = [];

/** Sprites a map brings along (08 §3.4: landscapes whose resource the original archives do not have). */
export type MapSprites = Record<string, { dir: string; frames: { file: string; width: number; height: number; anchor_x: number; anchor_y: number }[] }>;

export interface MapArt {
  board: Board;
  /** The 2304×2304 top-down ground texture; the view projects it obliquely. */
  ground: HTMLImageElement;
  /** Extra sprites by "archive/NNNN", frames at 4× like the HD redraws (paths relative to maps/). */
  sprites: MapSprites;
  /**
   * Decorations: plants and the like that only dress the ground (no rules, not map records), each a map sprite
   * whose frames are the seasons (spring, summer, autumn, winter; fewer frames: the last one stands in).
   */
  decor: MapDecor[];
  /** Draw a notch across both road edges halfway between squares (the remake's own maps), whatever the ground style. */
  stepMarks: boolean;
  /** Sidewalk paths of the decorative passers-by, each a list of [x, y] map points (歌舞伎町, docs/rules/21 §8.1). */
  walkers?: [number, number][][];
}

export interface MapDecor { x: number; y: number; res: number }

function makeMapThumbSvg(name: string): string {
  const safe = name.replace(/[<>&"]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b4d89"/><stop offset="1" stop-color="#0e2a4d"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><circle cx="80" cy="70" r="34" fill="#3a8b5c" opacity=".85"/><circle cx="220" cy="115" r="46" fill="#469d6a" opacity=".85"/><path d="M80 70 Q150 40 220 115" stroke="#f5d47a" stroke-width="6" fill="none" stroke-dasharray="10 6"/><text x="160" y="172" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="22" font-weight="bold">${safe}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Generates a clean procedural ground image when a custom or shared map has no raster `.png` asset. */
export async function buildProceduralGround(board: Board): Promise<HTMLImageElement> {
  const sz = Math.max(256, board.size || 2304);
  const w = sz;
  const h = sz;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1e5b7a');
    grad.addColorStop(1, '#153b59');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Soft island patches around nodes
    ctx.fillStyle = '#3b7f4f';
    for (const n of board.nodes) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 72, 0, Math.PI * 2);
      ctx.fill();
    }
    // Road beds between connected nodes
    ctx.strokeStyle = '#d9c8a3';
    ctx.lineWidth = 34;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const n of board.nodes) {
      for (const nb of n.adjacent) {
        if (nb > n.id && board.nodes[nb]) {
          ctx.moveTo(n.x, n.y);
          ctx.lineTo(board.nodes[nb].x, board.nodes[nb].y);
        }
      }
    }
    ctx.stroke();
  }
  const img = new Image();
  img.src = c.toDataURL('image/png');
  await new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); });
  return img;
}

/** Builds a playable `MapArt` directly from a decoded `RawMap` (e.g. Map Editor 2.0 share code). */
export async function buildMapArtFromRaw(raw: RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean; walkers?: [number, number][][] }): Promise<MapArt> {
  const board = parseBoard(raw);
  const ground = await buildProceduralGround(board);
  return { board, ground, sprites: raw.sprites ?? {}, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks,
    ...(raw.walkers?.length ? { walkers: raw.walkers } : {}) };
}

export async function loadMap(id: number): Promise<MapArt> {
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  const data = entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`;
  const pic = entry && entry.image === '' ? '' : entry?.image ? `${ASSETS}/maps/${entry.image}` : `${base}.png`;
  const raw = await json<RawMap & { sprites?: MapSprites; decorations?: MapDecor[]; step_marks?: boolean; walkers?: [number, number][][] }>(data);
  const board = parseBoard(raw);
  const ground = pic ? await image(pic).catch(() => buildProceduralGround(board)) : await buildProceduralGround(board);
  return { board, ground, sprites: raw.sprites ?? {}, decor: raw.decorations ?? [], stepMarks: !!raw.step_marks,
    ...(raw.walkers?.length ? { walkers: raw.walkers } : {}) };
}

/**
 * Only a map's records (no ground picture): 大富豪模式 builds all five cities' rules from these and loads the art
 * of the city on screen only (docs/rules/17 §12). Includes the JSON's optional `tycoon` overlay.
 */
export async function loadMapData(id: number): Promise<RawMap & { tycoon?: unknown }> {
  let entry = known.find(m => m.id === id);
  if (!entry && id >= 8 && id < 1000) { await mapList().catch(() => []); entry = known.find(m => m.id === id); }
  const base = id >= 1000 ? `${ASSETS}/maps/custom/${id}` : `${ASSETS}/maps/map-${id}`;
  return json(entry?.data ? `${ASSETS}/maps/${entry.data}` : `${base}.json`);
}

/**
 * The original pictures' file type: 'png' as extracted, 'webp' in the app (scripts/bundle-assets.mjs converts them,
 * losslessly, and says so in orig/manifest.json `ext`). For the frames the game names itself rather than by the manifest.
 */
export let origExt = 'png';
export function setOrigExt(ext: string | undefined) { origExt = ext === 'webp' ? 'webp' : 'png'; }

/** HD portrait for a character (Data.mkf #2, aligned 4x; WebP in the app), falling back to the original. */
export async function portrait(character: number): Promise<HTMLImageElement> {
  const n = String(character).padStart(3, '0');
  for (const url of [`${ASSETS}/hd/Data/0002-SMP/frame-${n}.webp`, `${ASSETS}/hd/Data/0002-SMP/frame-${n}.png`]) {
    try { return await image(url); } catch { /* the next */ }
  }
  return image(`${ASSETS}/orig/Data/0002-SMP/frame-${n}.${origExt}`);
}
