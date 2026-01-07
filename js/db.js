/**
 * IndexedDB layer for language model storage
 * Stores n-gram counts separately from main app data for performance
 */

const DB_NAME = 'palate_lm';
const DB_VERSION = 1;

const STORES = {
  UNIGRAMS: 'unigrams',
  BIGRAMS: 'bigrams',
  TRIGRAMS: 'trigrams',
  META: 'meta'
};

let dbInstance = null;

/**
 * Open/create the IndexedDB database
 */
export async function openDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Unigrams: word -> count
      if (!db.objectStoreNames.contains(STORES.UNIGRAMS)) {
        db.createObjectStore(STORES.UNIGRAMS, { keyPath: 'word' });
      }

      // Bigrams: "prev|word" -> count
      if (!db.objectStoreNames.contains(STORES.BIGRAMS)) {
        const store = db.createObjectStore(STORES.BIGRAMS, { keyPath: 'key' });
        store.createIndex('prev', 'prev', { unique: false });
      }

      // Trigrams: "prevPrev|prev|word" -> count
      if (!db.objectStoreNames.contains(STORES.TRIGRAMS)) {
        const store = db.createObjectStore(STORES.TRIGRAMS, { keyPath: 'key' });
        store.createIndex('context', 'context', { unique: false });
      }

      // Meta: stores processed snapshot IDs, model stats, etc.
      if (!db.objectStoreNames.contains(STORES.META)) {
        db.createObjectStore(STORES.META, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Get a value from a store
 */
export async function get(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Put a value into a store
 */
export async function put(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all values from a store
 */
export async function getAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all values matching an index
 */
export async function getAllByIndex(storeName, indexName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear a store
 */
export async function clear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all language model data
 */
export async function clearAllLMData() {
  await clear(STORES.UNIGRAMS);
  await clear(STORES.BIGRAMS);
  await clear(STORES.TRIGRAMS);
  await clear(STORES.META);
}

/**
 * Batch update n-gram counts (for performance)
 */
export async function batchUpdateCounts(unigrams, bigrams, trigrams) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORES.UNIGRAMS, STORES.BIGRAMS, STORES.TRIGRAMS],
      'readwrite'
    );

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    const uniStore = tx.objectStore(STORES.UNIGRAMS);
    const biStore = tx.objectStore(STORES.BIGRAMS);
    const triStore = tx.objectStore(STORES.TRIGRAMS);

    // Update unigrams
    for (const [word, count] of Object.entries(unigrams)) {
      const request = uniStore.get(word);
      request.onsuccess = () => {
        const existing = request.result;
        const newCount = (existing?.count || 0) + count;
        uniStore.put({ word, count: newCount });
      };
    }

    // Update bigrams
    for (const [key, data] of Object.entries(bigrams)) {
      const request = biStore.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        const newCount = (existing?.count || 0) + data.count;
        biStore.put({
          key,
          prev: data.prev,
          word: data.word,
          count: newCount
        });
      };
    }

    // Update trigrams
    for (const [key, data] of Object.entries(trigrams)) {
      const request = triStore.get(key);
      request.onsuccess = () => {
        const existing = request.result;
        const newCount = (existing?.count || 0) + data.count;
        triStore.put({
          key,
          context: data.context,
          prevPrev: data.prevPrev,
          prev: data.prev,
          word: data.word,
          count: newCount
        });
      };
    }
  });
}

/**
 * Get bigrams for a given previous word
 */
export async function getBigramsForPrev(prevWord) {
  return getAllByIndex(STORES.BIGRAMS, 'prev', prevWord);
}

/**
 * Get trigrams for a given context (prevPrev|prev)
 */
export async function getTrigramsForContext(context) {
  return getAllByIndex(STORES.TRIGRAMS, 'context', context);
}

/**
 * Get top N unigrams by count
 */
export async function getTopUnigrams(n = 10) {
  const all = await getAll(STORES.UNIGRAMS);
  return all
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/**
 * Store/retrieve processed snapshot IDs
 */
export async function getProcessedSnapshots() {
  const meta = await get(STORES.META, 'processedSnapshots');
  return meta?.ids || [];
}

export async function setProcessedSnapshots(ids) {
  await put(STORES.META, { id: 'processedSnapshots', ids });
}

export async function addProcessedSnapshot(snapshotId) {
  const ids = await getProcessedSnapshots();
  if (!ids.includes(snapshotId)) {
    ids.push(snapshotId);
    await setProcessedSnapshots(ids);
  }
}

export { STORES };
