/**
 * BYOA (Bring Your Own Assets) 執行期素材包儲存與匯入 UI。
 *
 * 將玩家自備的 `.tar` 素材包驗證後寫入瀏覽器 IndexedDB（在 Node/測試/無痕等無法使用
 * IndexedDB 的環境自動降級為記憶體 Map），並提供二進位、JSON、Object URL 查詢與匯入彈窗。
 */
import { extractTarFile, validateAssetTar } from './byoa';

export type ByoaImportResult =
  | { ok: true; fileCount: number; totalBytes: number }
  | { ok: false; error: string; missing: string[] };

const DEFAULT_DB_NAME = 'rich4-byoa-assets';
const DEFAULT_STORE_NAME = 'files';
const DB_VERSION = 1;
const IDB_TIMEOUT_MS = 4000;

const dec = new TextDecoder('utf-8');

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
};

function normalizeRelPath(relPath: string): string {
  let p = relPath.trim().replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  return p;
}

function guessMimeType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  const ext = path.slice(dot + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      val => {
        clearTimeout(timer);
        resolve(val);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class ByoaPackStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly memory = new Map<string, Uint8Array>();
  private readonly objectUrls = new Map<string, string>();
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryOnly = false;

  constructor(dbName = DEFAULT_DB_NAME, storeName = DEFAULT_STORE_NAME) {
    this.dbName = dbName;
    this.storeName = storeName;
    if (typeof indexedDB === 'undefined') {
      this.memoryOnly = true;
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.memoryOnly || typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable'));
    }
    if (!this.dbPromise) {
      this.dbPromise = withTimeout(
        new Promise<IDBDatabase>((resolve, reject) => {
          let req: IDBOpenDBRequest;
          try {
            req = indexedDB.open(this.dbName, DB_VERSION);
          } catch (err) {
            reject(err);
            return;
          }
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(this.storeName)) {
              db.createObjectStore(this.storeName);
            }
          };
          req.onsuccess = () => {
            const db = req.result;
            db.onclose = () => {
              this.dbPromise = null;
            };
            db.onversionchange = () => {
              db.close();
              this.dbPromise = null;
            };
            resolve(db);
          };
          req.onerror = () => {
            this.dbPromise = null;
            reject(req.error ?? new Error('IndexedDB open failed'));
          };
          req.onblocked = () => {
            this.dbPromise = null;
            reject(new Error('IndexedDB open blocked'));
          };
        }),
        IDB_TIMEOUT_MS,
        'IndexedDB open',
      ).catch(err => {
        this.dbPromise = null;
        this.memoryOnly = true;
        throw err;
      });
    }
    return this.dbPromise;
  }

  private async runIdb<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.openDb();
    return withTimeout(
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(this.storeName, mode);
        const store = tx.objectStore(this.storeName);
        const req = op(store);
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      }),
      IDB_TIMEOUT_MS,
      'IndexedDB transaction',
    );
  }

  private resolveCandidateKeys(relPath: string): string[] {
    const norm = normalizeRelPath(relPath);
    if (!norm) return [];
    if (norm === 'assets' || norm.startsWith('assets/')) return [norm];
    return [norm, `assets/${norm}`];
  }

  async importTar(bytes: Uint8Array): Promise<ByoaImportResult> {
    const validation = validateAssetTar(bytes);
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.error ?? '無效的 BYOA TAR 素材包',
        missing: validation.missing,
      };
    }

    const assetEntries = validation.entries.filter(
      e => e.type === 'file' && (e.path === 'assets' || e.path.startsWith('assets/')),
    );

    const files = new Map<string, Uint8Array>();
    let totalBytes = 0;
    for (const entry of assetEntries) {
      // Copy slice so the stored buffer does not pin the entire source TAR in memory.
      const copy = extractTarFile(bytes, entry).slice();
      files.set(entry.path, copy);
      totalBytes += copy.byteLength;
    }

    this.revokeAll();
    this.memory.clear();
    for (const [path, data] of files) {
      this.memory.set(path, data);
    }

    if (!this.memoryOnly) {
      try {
        const db = await this.openDb();
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            const store = tx.objectStore(this.storeName);
            store.clear();
            for (const [path, data] of files) {
              store.put(data, path);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write failed'));
          }),
          IDB_TIMEOUT_MS * 2,
          'IndexedDB importTar',
        );
      } catch {
        // Fallback to in-memory storage if IndexedDB fails (e.g., private browsing / quota).
        this.memoryOnly = true;
      }
    }

    return {
      ok: true,
      fileCount: files.size,
      totalBytes,
    };
  }

  async getAsset(relPath: string): Promise<Uint8Array | null> {
    const keys = this.resolveCandidateKeys(relPath);
    for (const key of keys) {
      const cached = this.memory.get(key);
      if (cached) return cached;
    }

    if (this.memoryOnly) return null;

    for (const key of keys) {
      try {
        const stored = await this.runIdb<unknown>('readonly', s => s.get(key));
        if (stored instanceof Uint8Array) {
          this.memory.set(key, stored);
          return stored;
        }
        if (stored instanceof ArrayBuffer) {
          const view = new Uint8Array(stored);
          this.memory.set(key, view);
          return view;
        }
      } catch {
        this.memoryOnly = true;
        return null;
      }
    }
    return null;
  }

  async getJson<T>(relPath: string): Promise<T | null> {
    const bytes = await this.getAsset(relPath);
    if (!bytes) return null;
    try {
      return JSON.parse(dec.decode(bytes)) as T;
    } catch {
      return null;
    }
  }

  async getObjectUrl(relPath: string): Promise<string | null> {
    const keys = this.resolveCandidateKeys(relPath);
    for (const key of keys) {
      const existing = this.objectUrls.get(key);
      if (existing) return existing;
    }

    const bytes = await this.getAsset(relPath);
    if (!bytes || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return null;
    }

    const primaryKey = keys[0];
    const mime = guessMimeType(primaryKey);
    const blob = new Blob([new Uint8Array(bytes)], { type: mime });
    const url = URL.createObjectURL(blob);
    this.objectUrls.set(primaryKey, url);
    return url;
  }

  async hasPack(): Promise<boolean> {
    if (this.memory.size > 0) return true;
    if (this.memoryOnly) return false;
    try {
      const count = await this.runIdb<number>('readonly', s => s.count());
      return count > 0;
    } catch {
      this.memoryOnly = true;
      return false;
    }
  }

  async clear(): Promise<void> {
    this.revokeAll();
    this.memory.clear();
    if (this.memoryOnly) return;
    try {
      await this.runIdb('readwrite', s => s.clear());
    } catch {
      this.memoryOnly = true;
    }
  }

  revokeAll(): void {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this.objectUrls.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.objectUrls.clear();
  }
}

const defaultStore = new ByoaPackStore();

export function importByoaTar(bytes: Uint8Array): Promise<ByoaImportResult> {
  return defaultStore.importTar(bytes);
}

export function getByoaAsset(relPath: string): Promise<Uint8Array | null> {
  return defaultStore.getAsset(relPath);
}

export function getByoaJson<T>(relPath: string): Promise<T | null> {
  return defaultStore.getJson<T>(relPath);
}

export function getByoaObjectUrl(relPath: string): Promise<string | null> {
  return defaultStore.getObjectUrl(relPath);
}

export function hasByoaPack(): Promise<boolean> {
  return defaultStore.hasPack();
}

export function clearByoaPack(): Promise<void> {
  return defaultStore.clear();
}

export function revokeAll(): void {
  defaultStore.revokeAll();
}

export interface ByoaModalHandle {
  close: () => void;
  overlay: HTMLElement;
}

/**
 * 開啟 BYOA 素材包匯入彈窗，讓玩家選擇本機 `.tar` 封裝並寫入執行期儲存。
 */
export function openByoaImportModal(
  onImported?: (res: ByoaImportResult) => void,
): ByoaModalHandle | null {
  if (typeof document === 'undefined' || !document.body) {
    return null;
  }

  const existing = document.getElementById('byoa-import-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'byoa-import-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '匯入 BYOA 素材包');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:9999',
    'display:grid',
    'place-items:center',
    'padding:16px',
    'background:rgba(12,16,28,0.72)',
    'backdrop-filter:blur(4px)',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(440px,100%)',
    'background:#1b2234',
    'color:#f3f5fa',
    'border:2px solid #d4a84f',
    'border-radius:14px',
    'padding:20px',
    'box-shadow:0 18px 48px rgba(0,0,0,0.45)',
    'font-family:system-ui,-apple-system,sans-serif',
    'display:flex',
    'flex-direction:column',
    'gap:14px',
  ].join(';');

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';

  const title = document.createElement('h2');
  title.textContent = '匯入自備素材包 (BYOA)';
  title.style.cssText = 'margin:0;font-size:18px;font-weight:700;color:#ffd87a;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', '關閉');
  closeBtn.style.cssText = [
    'border:none',
    'background:transparent',
    'color:#b8c1d9',
    'font-size:18px',
    'cursor:pointer',
    'padding:4px 8px',
    'line-height:1',
  ].join(';');

  header.append(title, closeBtn);

  const desc = document.createElement('p');
  desc.textContent = '本專案不含商業版素材。請選擇您自備的 rich4-assets.tar 檔案，驗證通過後將儲存於本機瀏覽器中。';
  desc.style.cssText = 'margin:0;font-size:13px;line-height:1.55;color:#cbd3e6;';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.tar';
  fileInput.style.cssText = [
    'width:100%',
    'box-sizing:border-box',
    'padding:10px',
    'border:1px dashed #6b7aa1',
    'border-radius:8px',
    'background:#111726',
    'color:#e6ecf8',
    'cursor:pointer',
  ].join(';');

  const status = document.createElement('div');
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'font-size:13px;line-height:1.5;min-height:20px;color:#9fb0d1;';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = '清除已存素材';
  clearBtn.style.cssText = [
    'padding:8px 12px',
    'border-radius:8px',
    'border:1px solid #596582',
    'background:transparent',
    'color:#d2daf0',
    'font-size:13px',
    'cursor:pointer',
  ].join(';');

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.textContent = '關閉';
  doneBtn.style.cssText = [
    'padding:8px 16px',
    'border-radius:8px',
    'border:none',
    'background:#d4a84f',
    'color:#181c28',
    'font-size:13px',
    'font-weight:700',
    'cursor:pointer',
  ].join(';');

  actions.append(clearBtn, doneBtn);
  card.append(header, desc, fileInput, status, actions);
  overlay.append(card);
  document.body.append(overlay);

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };

  const close = () => {
    window.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };

  window.addEventListener('keydown', onKeyDown);
  closeBtn.addEventListener('click', close);
  doneBtn.addEventListener('click', close);
  overlay.addEventListener('click', ev => {
    if (ev.target === overlay) close();
  });

  void hasByoaPack().then(has => {
    if (has && !status.textContent) {
      status.textContent = '目前已載入自備素材包，可重新選擇 .tar 覆蓋或清除。';
    }
  });

  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true;
    await clearByoaPack();
    status.style.color = '#ffd87a';
    status.textContent = '已清除本機儲存的素材包。';
    clearBtn.disabled = false;
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    fileInput.disabled = true;
    status.style.color = '#9fb0d1';
    status.textContent = `正在驗證並匯入 ${file.name}…`;

    try {
      const buf = await file.arrayBuffer();
      const res = await importByoaTar(new Uint8Array(buf));
      if (res.ok) {
        status.style.color = '#7ee787';
        status.textContent = `匯入成功：共 ${res.fileCount} 個檔案（${formatBytes(res.totalBytes)}）。`;
      } else {
        status.style.color = '#ff8b8b';
        const missingInfo = res.missing.length ? ` 缺少：${res.missing.join(', ')}` : '';
        status.textContent = `匯入失敗：${res.error}${missingInfo}`;
      }
      onImported?.(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '讀取檔案失敗';
      status.style.color = '#ff8b8b';
      status.textContent = `匯入失敗：${msg}`;
      onImported?.({ ok: false, error: msg, missing: [] });
    } finally {
      fileInput.disabled = false;
    }
  });

  return { close, overlay };
}
