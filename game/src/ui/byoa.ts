/**
 * BYOA (Bring Your Own Assets) 自備素材包驗證與載入器。
 *
 * 商業版大富翁4素材（原版提取、高清重繪、音效、地圖）不隨原始碼散布，由玩家自備 `rich4-assets.tar`。
 * 本模組純以 Uint8Array 解析 USTAR/POSIX TAR 標頭與校驗和，檢查必要清單路徑是否存在且無路徑穿越風險。
 */

export const REQUIRED_ASSET_PATHS = [
  'assets/maps/maps.json',
  'assets/orig/manifest.json',
  'assets/hd/manifest-hd.json',
] as const;

export interface TarEntry {
  path: string;
  size: number;
  type: 'file' | 'dir' | 'other';
  offset: number;
}

export interface ByoaValidationResult {
  ok: boolean;
  error?: string;
  entries: TarEntry[];
  missing: string[];
  totalBytes: number;
}

const BLOCK = 512;
const dec = new TextDecoder('utf-8');

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let i = 0; i < BLOCK; i++) {
    if (bytes[offset + i] !== 0) return false;
  }
  return true;
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let end = start;
  const limit = start + len;
  while (end < limit && bytes[end] !== 0) end++;
  return dec.decode(bytes.subarray(start, end));
}

function parseOctal(bytes: Uint8Array, start: number, len: number): number | null {
  // Base-256 encoding (GNU tar extension for large sizes)
  if (len > 0 && (bytes[start] & 0x80) !== 0) {
    let val = 0;
    for (let i = 1; i < len; i++) {
      val = val * 256 + bytes[start + i];
    }
    return Number.isSafeInteger(val) ? val : null;
  }
  const raw = readAscii(bytes, start, len).trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 8);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function verifyHeaderChecksum(bytes: Uint8Array, offset: number): boolean {
  const expected = parseOctal(bytes, offset + 148, 8);
  if (expected === null) return false;
  let unsignedSum = 0;
  for (let i = 0; i < BLOCK; i++) {
    unsignedSum += i >= 148 && i < 156 ? 0x20 : bytes[offset + i];
  }
  return unsignedSum === expected;
}

function normalizeTarPath(raw: string): string | null {
  let p = raw.replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+$/, '');
  if (!p || p.startsWith('/')) return null;
  const parts = p.split('/');
  if (parts.some(seg => seg === '..' || seg === '.')) return null;
  return p;
}

function fail(error: string, totalBytes: number, requiredPaths: readonly string[], entries: TarEntry[] = []): ByoaValidationResult {
  const present = new Set(entries.filter(e => e.type === 'file').map(e => e.path));
  const missing = requiredPaths.filter(p => !present.has(p));
  return { ok: false, error, entries, missing, totalBytes };
}

/**
 * 驗證 BYOA `.tar` 素材包標頭校驗和、路徑安全性與必要資產清單。
 */
export function validateAssetTar(
  bytes: Uint8Array,
  requiredPaths: readonly string[] = REQUIRED_ASSET_PATHS,
): ByoaValidationResult {
  const totalBytes = bytes.length;
  if (totalBytes < BLOCK) {
    return fail('檔案過小，非有效的 TAR 封裝', totalBytes, requiredPaths);
  }

  const entries: TarEntry[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + BLOCK <= totalBytes) {
    if (isZeroBlock(bytes, offset)) {
      break;
    }

    if (!verifyHeaderChecksum(bytes, offset)) {
      return fail(`TAR 標頭校驗和無效（位移 ${offset}）`, totalBytes, requiredPaths, entries);
    }

    const magic = readAscii(bytes, offset + 257, 6);
    if (magic && !magic.startsWith('ustar')) {
      return fail(`不支援的 TAR 標頭格式：${magic}`, totalBytes, requiredPaths, entries);
    }

    const size = parseOctal(bytes, offset + 124, 12);
    if (size === null || size < 0) {
      return fail(`TAR 檔案大小欄位無效（位移 ${offset}）`, totalBytes, requiredPaths, entries);
    }

    const dataOffset = offset + BLOCK;
    const paddedSize = Math.ceil(size / BLOCK) * BLOCK;
    if (dataOffset + size > totalBytes) {
      return fail(`TAR 檔案內容截斷（位移 ${offset}）`, totalBytes, requiredPaths, entries);
    }

    const typeByte = bytes[offset + 156];
    const typeChar = typeByte === 0 ? '0' : String.fromCharCode(typeByte);

    // GNU tar longname ('L')
    if (typeChar === 'L') {
      pendingLongName = readAscii(bytes, dataOffset, size);
      offset = dataOffset + paddedSize;
      continue;
    }

    // PAX extended headers ('x' / 'g')
    if (typeChar === 'x' || typeChar === 'g') {
      offset = dataOffset + paddedSize;
      continue;
    }

    const namePart = readAscii(bytes, offset, 100);
    const prefixPart = readAscii(bytes, offset + 345, 155);
    const rawName = pendingLongName ?? (prefixPart ? `${prefixPart}/${namePart}` : namePart);
    pendingLongName = null;

    const normalized = normalizeTarPath(rawName);
    if (!normalized) {
      return fail(`TAR 含有不安全或無效的路徑：${rawName}`, totalBytes, requiredPaths, entries);
    }

    const type: TarEntry['type'] = typeChar === '5' ? 'dir' : typeChar === '0' ? 'file' : 'other';
    entries.push({ path: normalized, size, type, offset: dataOffset });

    offset = dataOffset + paddedSize;
  }

  if (entries.length === 0) {
    return fail('TAR 封裝內沒有任何檔案', totalBytes, requiredPaths, entries);
  }

  const fileSet = new Set(entries.filter(e => e.type === 'file').map(e => e.path));
  const missing = requiredPaths.filter(p => !fileSet.has(p));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `缺少必要素材檔案：${missing.join(', ')}`,
      entries,
      missing,
      totalBytes,
    };
  }

  return { ok: true, entries, missing: [], totalBytes };
}

/** 從已驗證的 TAR 位元組中零拷貝擷取單一檔案內容。 */
export function extractTarFile(bytes: Uint8Array, entry: TarEntry): Uint8Array {
  return bytes.subarray(entry.offset, entry.offset + entry.size);
}

/** 從已驗證的 TAR 位元組中讀取並解析 JSON 檔案。 */
export function readTarJson<T>(bytes: Uint8Array, entries: readonly TarEntry[], path: string): T | null {
  const entry = entries.find(e => e.type === 'file' && e.path === path);
  if (!entry) return null;
  try {
    return JSON.parse(dec.decode(extractTarFile(bytes, entry))) as T;
  } catch {
    return null;
  }
}
