/* storage.js — IndexedDB 封装 + localStorage 降级 */
'use strict';

const Storage = {
  DB_NAME: 'StudDataDB',
  DB_VERSION: 1,
  db: null,
  useLocalStorage: false,

  /** 初始化数据库 */
  async init() {
    try {
      this.db = await this._openDB();
      console.log('[Storage] IndexedDB 就绪');
    } catch (e) {
      console.warn('[Storage] IndexedDB 不可用，降级为 localStorage:', e.message);
      this.useLocalStorage = true;
    }
  },

  _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        // horses store
        if (!db.objectStoreNames.contains('horses')) {
          const store = db.createObjectStore('horses', { keyPath: 'id' });
          store.createIndex('name_en', 'name_en', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('dam_id', 'dam_id', { unique: false });
        }
        // dam_groups store
        if (!db.objectStoreNames.contains('dam_groups')) {
          db.createObjectStore('dam_groups', { keyPath: 'id' });
        }
        // config store
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  },

  // === 通用 CRUD ===

  async get(storeName, key) {
    if (this.useLocalStorage) return this._lsGet(storeName, key);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, data) {
    if (this.useLocalStorage) return this._lsPut(storeName, data);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(data);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, key) {
    if (this.useLocalStorage) return this._lsDelete(storeName, key);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async getAll(storeName) {
    if (this.useLocalStorage) return this._lsGetAll(storeName);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllByIndex(storeName, indexName, value) {
    if (this.useLocalStorage) {
      const all = this._lsGetAll(storeName);
      return all.filter(item => item[indexName] === value);
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const index = tx.objectStore(storeName).index(indexName);
      const req = index.getAll(value);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  // === 快捷方法 ===

  async getHorse(id) { return this.get('horses', id); },
  async saveHorse(horse) { return this.put('horses', horse); },
  async deleteHorse(id) { return this.delete('horses', id); },
  async getAllHorses() { return this.getAll('horses'); },

  async getGroup(id) { return this.get('dam_groups', id); },
  async saveGroup(group) { return this.put('dam_groups', group); },
  async deleteGroup(id) { return this.delete('dam_groups', id); },
  async getAllGroups() { return this.getAll('dam_groups'); },

  /** 查找所有引用了指定马为 sire 或 dam 的马 */
  async findHorsesReferencing(horseId) {
    const all = await this.getAllHorses();
    return all.filter(h => h.sire_id === horseId || h.dam_id === horseId);
  },

  // === localStorage 降级实现 ===

  _lsKey(storeName) { return `studdata_${storeName}`; },

  _lsGetStore(storeName) {
    const raw = localStorage.getItem(this._lsKey(storeName));
    return raw ? JSON.parse(raw) : {};
  },

  _lsSaveStore(storeName, store) {
    localStorage.setItem(this._lsKey(storeName), JSON.stringify(store));
  },

  _lsGet(storeName, key) {
    const store = this._lsGetStore(storeName);
    return store[key] || null;
  },

  _lsPut(storeName, data) {
    const store = this._lsGetStore(storeName);
    const key = data.id || data.key;
    store[key] = data;
    this._lsSaveStore(storeName, store);
  },

  _lsDelete(storeName, key) {
    const store = this._lsGetStore(storeName);
    delete store[key];
    this._lsSaveStore(storeName, store);
  },

  _lsGetAll(storeName) {
    const store = this._lsGetStore(storeName);
    return Object.values(store);
  }
};

// 自动初始化
Storage.init();
