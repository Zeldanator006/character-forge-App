/* Where the app keeps things on the device: characters, entries you add, and settings.

   Two interchangeable backends with the same async interface:
   - idbStore(): IndexedDB in the browser (and inside the Android/iOS app wrapper)
   - memoryStore(): plain objects, for tests */

const TABLES = ['characters', 'entries', 'settings'];

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
  };
}

export function idbStore(name = 'character-forge') {
  let dbp;
  const open = () => dbp || (dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const t of TABLES) {
        if (!db.objectStoreNames.contains(t)) {
          db.createObjectStore(t, t === 'settings' ? { keyPath: 'id' } : { keyPath: 'id', autoIncrement: true });
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
  };
}
