// Content- and identity-free coordinates only.
export const layoutCacheSchemaVersion = 1;

const databaseName = 'brainbar-3d-layout-cache';
const databaseVersion = 1;
const storeName = 'layouts';
let databasePromise;

export function normalizeLayoutCacheLens(lens) {
  return lens === 'obsidian' || lens === 'graphify' ? lens : 'all';
}

export function isLayoutCacheDigest(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

export function layoutCacheKey({ digest, lens }) {
  if (!isLayoutCacheDigest(digest)) {
    return '';
  }
  return `${layoutCacheSchemaVersion}:${String(digest).toLowerCase()}:${normalizeLayoutCacheLens(lens)}`;
}

export function validateLayoutCacheRecord(record, { digest, lens, nodeCount }) {
  const key = layoutCacheKey({ digest, lens });
  if (
    !key ||
    !record ||
    record.key !== key ||
    record.schemaVersion !== layoutCacheSchemaVersion ||
    record.digest !== String(digest).toLowerCase() ||
    record.lens !== normalizeLayoutCacheLens(lens) ||
    !Number.isSafeInteger(nodeCount) ||
    nodeCount < 0 ||
    record.nodeCount !== nodeCount ||
    !(record.coordinates instanceof ArrayBuffer) ||
    record.coordinates.byteLength !== nodeCount * 3 * Float64Array.BYTES_PER_ELEMENT
  ) {
    return null;
  }
  const coordinates = new Float64Array(record.coordinates);
  return [...coordinates].every(Number.isFinite) ? coordinates : null;
}

export function layoutCacheRecord({ digest, lens, nodeCount, coordinates }) {
  const key = layoutCacheKey({ digest, lens });
  if (!key || !(coordinates instanceof ArrayBuffer)) {
    return null;
  }
  const record = {
    key,
    schemaVersion: layoutCacheSchemaVersion,
    digest: String(digest).toLowerCase(),
    lens: normalizeLayoutCacheLens(lens),
    nodeCount,
    coordinates: coordinates.slice(0)
  };
  return validateLayoutCacheRecord(record, { digest, lens, nodeCount }) ? record : null;
}

export function shouldRetainLayoutCacheRecord(record, digest) {
  const normalizedDigest = String(digest).toLowerCase();
  const validKeys = new Set(['all', 'obsidian', 'graphify'].map((lens) => layoutCacheKey({ digest: normalizedDigest, lens })));
  return record?.digest === normalizedDigest &&
    record?.schemaVersion === layoutCacheSchemaVersion &&
    validKeys.has(record?.key);
}

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  databasePromise = new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(databaseName, databaseVersion);
    } catch (_) {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) {
        request.result.createObjectStore(storeName, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

export async function readLayoutCache(identity, nodeCount) {
  const key = layoutCacheKey(identity);
  if (!key) {
    return null;
  }
  const database = await openDatabase();
  if (!database) {
    return null;
  }
  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(validateLayoutCacheRecord(request.result, { ...identity, nodeCount }));
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

export async function writeLayoutCache(identity, nodeCount, coordinates) {
  const record = layoutCacheRecord({ ...identity, nodeCount, coordinates });
  if (!record) {
    return false;
  }
  const database = await openDatabase();
  if (!database) {
    return false;
  }
  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const existing = store.getAll();
      existing.onsuccess = () => {
        for (const item of existing.result || []) {
          if (!shouldRetainLayoutCacheRecord(item, record.digest) || item?.key === record.key) {
            store.delete(item?.key);
          }
        }
        store.put(record);
      };
      existing.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

export async function clearLayoutCacheForTesting() {
  if (typeof indexedDB === 'undefined') {
    return false;
  }
  const database = await openDatabase();
  database?.close();
  databasePromise = undefined;
  return await new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.deleteDatabase(databaseName);
    } catch (_) {
      resolve(false);
      return;
    }
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

export async function overwriteLayoutCacheForTesting(record) {
  const database = await openDatabase();
  if (!database || !record?.key) {
    return false;
  }
  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}
