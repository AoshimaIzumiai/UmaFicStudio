/* storage.js — IndexedDB 封装 + localStorage 降级 */
'use strict';

const Storage = {
  DB_NAME: 'StudDataDB',
  DB_VERSION: 4,
  db: null,
  useLocalStorage: false,

  /** 初始化数据库 */
  async init() {
    try {
      this.db = await this._openDB();
      await this._purgeLegacyPedCache();
      await this._checkAndMigrate();
      await this._loadPresetData();
      console.log('[Storage] IndexedDB 就绪');
    } catch (e) {
      console.warn('[Storage] IndexedDB 不可用，降级为 localStorage:', e.message);
      this.useLocalStorage = true;
    }
  },

  /**
   * 清除旧版遗留的 ped_ 血统缓存（cursor 逐条删除，避免 getAll 内存爆炸）。
   * 必须在 _openDB 成功后、其他逻辑之前执行，否则 Safari 可能因数据量过大崩溃。
   */
  async _purgeLegacyPedCache() {
    try {
      const tx = this.db.transaction('config', 'readwrite');
      const store = tx.objectStore('config');
      let hasPed = false;
      await new Promise((resolve, reject) => {
        const req = store.openKeyCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) { resolve(); return; }
          if (typeof cursor.key === 'string' && cursor.key.startsWith('ped_')) {
            hasPed = true;
            cursor.delete();
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      if (hasPed) console.log('[Storage] 已清理遗留 ped_ 缓存');
    } catch (e) {
      // cursor 方式失败（Safari Blob 崩溃），终极兜底：清空 config store 并重建必要标记
      console.warn('[Storage] cursor 清理失败，尝试清空 config store:', e.message);
      try {
        const tx2 = this.db.transaction('config', 'readwrite');
        tx2.objectStore('config').clear();
        await new Promise((resolve, reject) => {
          tx2.oncomplete = () => resolve();
          tx2.onerror = () => reject(tx2.error);
        });
        console.log('[Storage] config store 已清空（用户设置将重建）');
      } catch (e2) {
        console.warn('[Storage] config store 清空也失败:', e2.message);
      }
    }
  },

  _openDB() {
    return new Promise((resolve, reject) => {
      // Safari 在数据量大时 open 可能长时间卡住，加超时保护
      const timeout = setTimeout(() => {
        reject(new Error('IndexedDB open timeout (10s)'));
      }, 10000);

      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('horses')) {
          const store = db.createObjectStore('horses', { keyPath: 'id' });
          store.createIndex('name_en', 'name_en', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          store.createIndex('dam_id', 'dam_id', { unique: false });
        }
        if (!db.objectStoreNames.contains('dam_groups')) {
          db.createObjectStore('dam_groups', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'key' });
        }
        // v2: 实体管理 stores
        if (!db.objectStoreNames.contains('farms')) {
          const s = db.createObjectStore('farms', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('trainers')) {
          const s = db.createObjectStore('trainers', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('owners')) {
          const s = db.createObjectStore('owners', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
        // v3: 赛事系统 stores
        if (!db.objectStoreNames.contains('countries')) {
          const s = db.createObjectStore('countries', { keyPath: 'id' });
          s.createIndex('code', 'code', { unique: true });
        }
        if (!db.objectStoreNames.contains('jockeys')) {
          const s = db.createObjectStore('jockeys', { keyPath: 'id' });
          s.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('races')) {
          const s = db.createObjectStore('races', { keyPath: 'id' });
          s.createIndex('country_id', 'country_id', { unique: false });
        }
        if (!db.objectStoreNames.contains('results')) {
          const s = db.createObjectStore('results', { keyPath: 'id' });
          s.createIndex('race_id', 'race_id', { unique: false });
        }
        // v4: Press 文章
        if (!db.objectStoreNames.contains('press_articles')) {
          const s = db.createObjectStore('press_articles', { keyPath: 'id' });
          s.createIndex('updated_at', 'updated_at', { unique: false });
        }
      };
      request.onsuccess = (e) => { clearTimeout(timeout); resolve(e.target.result); };
      request.onerror = (e) => { clearTimeout(timeout); reject(e.target.error); };
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
  },

  // === 实体 CRUD ===

  async getEntity(store, id) { return this.get(store, id); },
  async saveEntity(store, data) { return this.put(store, data); },
  async deleteEntity(store, id) { return this.delete(store, id); },
  async getAllEntities(store) { return this.getAll(store); },

  async _findEntityByName(store, name) {
    const all = await this.getAll(store);
    return all.find(e => e.name === name) || null;
  },

  // === Press 文章 ===

  async savePressArticle(article) { return this.put('press_articles', article); },
  async getPressArticle(id) { return this.get('press_articles', id); },
  async getAllPressArticles() { return this.getAll('press_articles'); },
  async deletePressArticle(id) { return this.delete('press_articles', id); },

  // === 数据迁移 ===

  async _checkAndMigrate() {
    const flag = await this.get('config', 'migration_v2_done');
    if (flag) return;
    await this.migrateEntityReferences();
    await this.put('config', { key: 'migration_v2_done', value: true });
  },

  /** 加载预置真实国数据（首次运行时） */
  async _loadPresetData() {
    const flag = await this.get('config', 'preset_countries_loaded_v5');
    if (flag) return;
    try {
      const resp = await fetch('data/real_countries.json');
      if (!resp.ok) return;
      const data = await resp.json();
      // 支持多国家格式
      if (data.countries) {
        for (const c of data.countries) await this.put('countries', c);
      } else if (data.country) {
        await this.put('countries', data.country);
      }
      for (const race of (data.races || [])) {
        await this.put('races', race);
      }
      await this.put('config', { key: 'preset_countries_loaded_v5', value: true });
      console.log(`[Storage] 预置数据加载完成: ${data.races?.length || 0} 场赛事`);
    } catch (e) {
      console.warn('[Storage] 预置数据加载失败:', e.message);
    }
  },

  async migrateEntityReferences() {
    const horses = await this.getAllHorses();
    const mapping = { farm: 'farm_', trainer: 'trn_', owner: 'own_' };
    const stores = { farm: 'farms', trainer: 'trainers', owner: 'owners' };

    for (const horse of horses) {
      let changed = false;
      for (const [field, prefix] of Object.entries(mapping)) {
        const val = horse[field];
        if (val && !val.startsWith(prefix)) {
          const existing = await this._findEntityByName(stores[field], val);
          if (existing) {
            horse[field] = existing.id;
          } else {
            const id = prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
            await this.put(stores[field], { id, name: val });
            horse[field] = id;
          }
          changed = true;
        }
      }
      if (changed) await this.saveHorse(horse);
    }
  }
};

// 自动初始化
Storage.init();
