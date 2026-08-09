import { graph3dLayoutSchemaVersion } from './graph3d-layout-utils.mjs';

// Content- and identity-free coordinates only. Schema 4 isolates the compact community-island
// world coordinates from every legacy single-cloud cache entry.
export const layoutCacheSchemaVersion = graph3dLayoutSchemaVersion;

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

export function validateLayoutCacheMetadata(metadata, { nodeCount, communityCount } = {}) {
  if (!metadata) {
    return null;
  }
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 0
    || !Number.isSafeInteger(communityCount) || communityCount < 0
    || !(metadata.communityIndexByNode instanceof ArrayBuffer)
    || !(metadata.communityCenters instanceof ArrayBuffer)
    || !(metadata.communityBounds instanceof ArrayBuffer)
    || !(metadata.structuralRanks instanceof ArrayBuffer)
    || metadata.communityIndexByNode.byteLength !== nodeCount * Uint32Array.BYTES_PER_ELEMENT
    || metadata.structuralRanks.byteLength !== nodeCount * Uint32Array.BYTES_PER_ELEMENT
    || metadata.communityCenters.byteLength !== communityCount * 3 * Float64Array.BYTES_PER_ELEMENT
    || metadata.communityBounds.byteLength !== communityCount * 6 * Float64Array.BYTES_PER_ELEMENT) {
    return null;
  }
  const communityIndexByNode = new Uint32Array(metadata.communityIndexByNode);
  const structuralRanks = new Uint32Array(metadata.structuralRanks);
  const communityCenters = new Float64Array(metadata.communityCenters);
  const communityBounds = new Float64Array(metadata.communityBounds);
  if (![...communityCenters, ...communityBounds].every(Number.isFinite)) {
    return null;
  }
  for (let index = 0; index < nodeCount; index += 1) {
    if (communityIndexByNode[index] >= communityCount || structuralRanks[index] >= nodeCount) {
      return null;
    }
  }
  for (let index = 0; index < communityCount; index += 1) {
    const offset = index * 6;
    if (communityBounds[offset] > communityBounds[offset + 1]
      || communityBounds[offset + 2] > communityBounds[offset + 3]
      || communityBounds[offset + 4] > communityBounds[offset + 5]) {
      return null;
    }
  }
  return { communityIndexByNode, structuralRanks, communityCenters, communityBounds };
}

export function layoutCacheRecord({ digest, lens, nodeCount, coordinates, communityLayout }) {
  const key = layoutCacheKey({ digest, lens });
  if (!key || !(coordinates instanceof ArrayBuffer)) {
    return null;
  }
  const metadata = communityLayout
    ? validateLayoutCacheMetadata(communityLayout, { nodeCount, communityCount: communityLayout.communityCount })
    : null;
  // Schema 4 is all-or-nothing: coordinates without the matching community
  // metadata describe a different renderer contract and must be a cache miss.
  if (!metadata) {
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
  record.communityCount = communityLayout.communityCount;
  record.communityIndexByNode = communityLayout.communityIndexByNode.slice(0);
  record.communityCenters = communityLayout.communityCenters.slice(0);
  record.communityBounds = communityLayout.communityBounds.slice(0);
  record.structuralRanks = communityLayout.structuralRanks.slice(0);
  return validateLayoutCacheLayout(record, { digest, lens, nodeCount }) ? record : null;
}

export function validateLayoutCacheLayout(record, identity) {
  const coordinates = validateLayoutCacheRecord(record, identity);
  const communityLayout = validateLayoutCacheMetadata(record, {
    nodeCount: identity?.nodeCount,
    communityCount: record?.communityCount
  });
  return coordinates && communityLayout ? { coordinates, communityLayout: { communityCount: record.communityCount, ...communityLayout } } : null;
}

export function shouldRetainLayoutCacheRecord(record, digest) {
  const normalizedDigest = String(digest).toLowerCase();
  const validKeys = new Set(['all', 'obsidian', 'graphify'].map((lens) => layoutCacheKey({ digest: normalizedDigest, lens })));
  const coordinates = validateLayoutCacheRecord(record, {
    digest: record?.digest,
    lens: record?.lens,
    nodeCount: record?.nodeCount
  });
  const metadata = validateLayoutCacheMetadata(record, {
    nodeCount: record?.nodeCount,
    communityCount: record?.communityCount
  });
  return record?.digest === normalizedDigest &&
    record?.schemaVersion === layoutCacheSchemaVersion &&
    validKeys.has(record?.key) && Boolean(coordinates) &&
    Boolean(metadata);
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
  return (await readLayoutCacheLayout(identity, nodeCount))?.coordinates ?? null;
}

/**
 * Reads the schema-4 cache as one record/transaction. Callers must never mix
 * coordinates and metadata from independent reads because either half could be
 * replaced between transactions.
 */
export async function readLayoutCacheLayout(identity, nodeCount) {
  const key = layoutCacheKey(identity);
  if (!key) return null;
  const database = await openDatabase();
  if (!database) return null;
  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(validateLayoutCacheLayout(request.result, { ...identity, nodeCount }));
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

export async function readLayoutCacheMetadata(identity, nodeCount) {
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
      request.onsuccess = () => resolve(validateLayoutCacheMetadata(request.result, {
        nodeCount,
        communityCount: request.result?.communityCount
      }));
      request.onerror = () => resolve(null);
      transaction.onabort = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

export async function writeLayoutCache(identity, nodeCount, coordinates, communityLayout) {
  const record = layoutCacheRecord({ ...identity, nodeCount, coordinates, communityLayout });
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
