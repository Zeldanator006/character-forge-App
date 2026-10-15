/* Where the app keeps things on the device: characters, entries you add, and settings.

   Two interchangeable backends with the same async interface:
   - idbStore(): IndexedDB in the browser (and inside the Android/iOS app wrapper)
   - memoryStore(): plain objects, for tests */

const TABLES = ['characters', 'entries', 'settings', 'pdfs', 'pdf_files', 'wiki_pages'];
// tables whose rows carry their own id (a name or a path) instead of a number counted up
const KEYED = new Set(['settings', 'wiki_pages']);
const VERSION = 3;  // 1: characters, entries, settings; 2: added pdfs, pdf_files; 3: added wiki_pages

export function memoryStore() {
  const data = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
  const next = Object.fromEntries(TABLES.map((t) => [t, 1]));
  const clone = (v) => (v === undefined ? v : structuredClone(v));
  return {
    async all(table) { return [...data[table].values()].map(clone); },
    async get(table, id) { return clone(data[table].get(id)); },
    async put(table, value) {
      const v = clone(value);
      if (v.id == null) v.id = next[table]++;
      else next[table] = Math.max(next[table], Number(v.id) + 1 || next[table]);
      data[table].set(v.id, v);
      return v.id;
    },
    async delete(table, id) { data[table].delete(id); },
    async count(table) { return data[table].size; },
    async putMany(table, values) { for (const v of values) await this.put(table, v); },
    async deleteMany(table, ids) { for (const id of ids) data[table].delete(id); },
  };
}

export function idbStore(name = 'character-forge') {
  let dbp;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) {
        if (!db.objectStoreNames.contains(t)) {
          db.createObjectStore(t, KEYED.has(t) ? { keyPath: 'id' } : { keyPath: 'id', autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('This browser won’t let the app save data. Private browsing can cause this.'));
  }));
  const run = async (table, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(table, mode);
      const req = fn(tx.objectStore(table));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error || new Error('Couldn’t save on this device.'));
      tx.onabort = () => reject(tx.error || new Error('Couldn’t save on this device (storage may be full).'));
    });
  };
  return {
    all: (table) => run(table, 'readonly', (s) => s.getAll()),
    get: (table, id) => run(table, 'readonly', (s) => s.get(id)),
    put: (table, value) => {
      const v = { ...value };
      if (v.id == null) delete v.id;
      return run(table, 'readwrite', (s) => s.put(v));
    },
    delete: (table, id) => run(table, 'readwrite', (s) => s.delete(id)),
    count: (table) => run(table, 'readonly', (s) => s.count()),
    // one transaction for a whole import: thousands of separate ones would take minutes on a phone
    putMany: (table, values) => run(table, 'readwrite', (s) => {
      for (const value of values) {
        const v = { ...value };
        if (v.id == null) delete v.id;
        s.put(v);
      }
    }),
    deleteMany: (table, ids) => run(table, 'readwrite', (s) => { for (const id of ids) s.delete(id); }),
  };
}
