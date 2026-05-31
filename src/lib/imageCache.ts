// src/lib/imageCache.ts
// Persistent artist image cache using IndexedDB
// TTL: 7 days. Max entries: 500 (evicts oldest beyond that).
// Fail-silent on all errors — a cache miss is always safe.

const DB_NAME    = 'mu-artist-images';
const STORE_NAME = 'blobs';
const DB_VERSION = 1;
const TTL_MS     = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 500;

interface CacheRecord {
  id: string;
  blob: Blob;
  cachedAt: number;
  source: 'spotify' | 'wikipedia' | 'deezer' | 'initials';
}

class ArtistImageCache {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<void> | null = null;

  open(): Promise<void> {
    if (this.db) return Promise.resolve();
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };

      req.onerror = () => reject(req.error);
    });

    return this.openPromise;
  }

  async get(artistId: string): Promise<Blob | null> {
    if (!this.db) {
      await this.open().catch(() => {});
    }
    if (!this.db) return null;

    return new Promise((resolve) => {
      try {
        const tx  = this.db!.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(artistId);

        req.onsuccess = () => {
          const record = req.result as CacheRecord | undefined;
          if (!record) return resolve(null);

          // Check TTL
          if (Date.now() - record.cachedAt > TTL_MS) {
            this.delete(artistId); // evict stale entry
            return resolve(null);
          }

          resolve(record.blob);
        };

        req.onerror = () => resolve(null); // miss is safe
      } catch {
        resolve(null);
      }
    });
  }

  async set(
    artistId: string,
    blob: Blob,
    source: CacheRecord['source'] = 'spotify'
  ): Promise<void> {
    if (!this.db) {
      await this.open().catch(() => {});
    }
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx = this.db!.transaction(STORE_NAME, 'readwrite');
        const record: CacheRecord = {
          id: artistId,
          blob,
          cachedAt: Date.now(),
          source,
        };
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve(); // fail silent
      } catch {
        resolve();
      }
    });
  }

  async delete(artistId: string): Promise<void> {
    if (!this.db) return;
    try {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(artistId);
    } catch { /* fail silent */ }
  }

  // Count how many of a given artist list are already cached
  async countCached(artistIds: string[]): Promise<number> {
    if (!this.db) {
      await this.open().catch(() => {});
    }
    if (!this.db) return 0;
    let count = 0;
    await Promise.all(
      artistIds.map(async (id) => {
        const hit = await this.get(id);
        if (hit) count++;
      })
    );
    return count;
  }

  // Evict oldest entries if over MAX_ENTRIES
  // Call once on startup — fire and forget
  async evictIfNeeded(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve) => {
      try {
        const tx       = this.db!.transaction(STORE_NAME, 'readwrite');
        const store    = tx.objectStore(STORE_NAME);
        const countReq = store.count();

        countReq.onsuccess = () => {
          if (countReq.result <= MAX_ENTRIES) return resolve();

          const toDelete = countReq.result - MAX_ENTRIES + 50; // delete 50 extra as buffer
          let deleted = 0;

          const idx = store.index('cachedAt');
          idx.openCursor().onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
            if (!cursor || deleted >= toDelete) return resolve();
            cursor.delete();
            deleted++;
            cursor.continue();
          };
        };

        countReq.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export const persistentImageCache = new ArtistImageCache();
