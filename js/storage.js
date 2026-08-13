/* storage.js — IndexedDB 封装 + localStorage 降级 */
'use strict';

const Storage = {
  DB_NAME: 'StudDataDB',
  DB_VERSION: 4,
  db: null,
  useLocalStorage: false,

  // 用户数据 stores（需要在 deleteDatabase 前备份）
  _USER_STORES: ['horses', 'dam_groups', 'farms', 'trainers', 'owners', 'countries', 'jockeys', 'races', 'results', 'press_articles'],

  /** 初始化数据库 */
  async init() {
    try {
      // 如果老用户数据库被 ped_ 缓存污染，先 deleteDatabase 彻底清除
      await this._nukeIfContaminated();
      this.db = await this._openDB();
      // 先恢复备份（如果有），再做迁移和预置数据检查
      await this._restoreBackupIfNeeded();
      await this._checkAndMigrate();
      await this._loadPresetData();
      console.log('[Storage] IndexedDB 就绪');
    } catch (e) {
      console.warn('[Storage] IndexedDB 不可用，降级为 localStorage:', e.message);
      this.useLocalStorage = true;
    }
  },

  /**
   * 检测并清除被 ped_ 缓存污染的数据库。
   * 
   * 仅在检测到 ped_ 污染时才执行 deleteDatabase，正常用户不受影响。
   * Safari 中 ped_ 数据导致 WebKitBlobResource 错误，无法用 cursor 遍历删除，
   * 只能整库删除重建。
   */
  async _nukeIfContaminated() {
    // 已完成清理的用户直接跳过
    if (localStorage.getItem('ped_purge_done')) return;

    // 尝试快速 open 检测是否有 ped_ 污染
    let db;
    try {
      db = await this._quickOpen(3000);
    } catch (e) {
      // open 超时 — 很可能是 Safari 被 ped_ 数据锁住，需要强制删库
      console.warn('[Storage] 数据库打开超时，可能被 ped_ 缓存锁住:', e.message);
      try { await this._deleteDB(); } catch (e2) { /* ignore */ }
      localStorage.setItem('ped_purge_done', '1');
      return;
    }

    if (!db) {
      // 新库或空库，无需任何处理
      localStorage.setItem('ped_purge_done', '1');
      return;
    }

    // 检测 config store 中是否有 ped_ 前缀的 key（快速探测，不遍历全部）
    let isContaminated = false;
    try {
      isContaminated = await this._detectPedContamination(db);
    } catch (e) {
      // 检测本身崩溃（Safari Blob 错误），视为被污染
      console.warn('[Storage] ped_ 检测失败，视为已污染:', e.message);
      isContaminated = true;
    }

    if (!isContaminated) {
      // 正常用户，无需清理
      db.close();
      localStorage.setItem('ped_purge_done', '1');
      return;
    }

    // 确认被污染，执行备份 + 删库
    console.log('[Storage] 检测到 ped_ 缓存污染，执行清理...');
    let backed = false;
    try {
      await this._backupUserData(db);
      backed = true;
      console.log('[Storage] 用户数据已备份');
    } catch (e) {
      console.warn('[Storage] 备份失败:', e.message);
    }
    db.close();

    try {
      await this._deleteDB();
      console.log('[Storage] 旧数据库已删除');
    } catch (e) {
      console.warn('[Storage] deleteDatabase 失败:', e.message);
    }

    localStorage.setItem('ped_purge_done', '1');
    if (backed) {
      localStorage.setItem('ped_purge_has_backup', '1');
    }
  },

  /**
   * 快速检测 config store 是否含有 ped_ 前缀的 key。
   * 使用 IDBKeyRange 查询 'ped_' 开头的第一个 key，避免遍历全部记录。
   */
  _detectPedContamination(db) {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains('config')) {
        resolve(false);
        return;
      }
      const tx = db.transaction('config', 'readonly');
      const store = tx.objectStore('config');
      // IDBKeyRange.bound('ped_', 'ped_\uffff') 匹配所有 ped_ 开头的 key
      const range = IDBKeyRange.bound('ped_', 'ped_\uffff');
      const req = store.openKeyCursor(range);
      const t = setTimeout(() => resolve(true), 1000); // 1秒没响应视为有问题
      req.onsuccess = (e) => {
        clearTimeout(t);
        // 如果 cursor 有结果，说明存在 ped_ 开头的 key
        resolve(!!e.target.result);
      };
      req.onerror = () => {
        clearTimeout(t);
        // 出错视为有污染
        resolve(true);
      };
    });
  },

  /** 快速打开数据库（仅用于备份），带严格超时。新库或无需备份时返回 null */
  _quickOpen(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`quick-open timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      let isUpgrade = false;
      const request = indexedDB.open(this.DB_NAME);

      request.onupgradeneeded = (e) => {
        // 数据库不存在或版本为 0，会触发 upgrade 创建 version 1 空库
        // 标记为新库，不需要备份
        isUpgrade = true;
      };

      request.onsuccess = (e) => {
        clearTimeout(timeout);
        const db = e.target.result;
        if (isUpgrade || !db.objectStoreNames.contains('horses')) {
          // 新建的空库或不含用户数据的库，无需备份
          db.close();
          resolve(null);
        } else {
          resolve(db);
        }
      };

      request.onerror = (e) => {
        clearTimeout(timeout);
        reject(e.target.error || new Error('open failed'));
      };
    });
  },

  /** 备份所有用户数据 store 到 localStorage */
  async _backupUserData(db) {
    const storeNames = [...db.objectStoreNames];
    const userStores = this._USER_STORES.filter(s => storeNames.includes(s));
    const backup = {};

    for (const storeName of userStores) {
      try {
        const data = await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).getAll();
          // 单个 store 读取 2 秒超时
          const t = setTimeout(() => reject(new Error(`getAll timeout: ${storeName}`)), 2000);
          req.onsuccess = () => { clearTimeout(t); resolve(req.result || []); };
          req.onerror = () => { clearTimeout(t); reject(req.error); };
        });
        if (data.length > 0) {
          backup[storeName] = data;
        }
      } catch (e) {
        // 单个 store 读取失败不影响其他 store 的备份
        console.warn(`[Storage] 备份 ${storeName} 失败:`, e.message);
      }
    }

    // 安全备份 config store 中的关键 flag（精确 get，不遍历，不触碰 ped_ 记录）
    if (storeNames.includes('config')) {
      const configKeys = ['migration_v2_done', 'preset_countries_loaded_v5', 'year_mode'];
      const configItems = [];
      for (const key of configKeys) {
        try {
          const item = await new Promise((resolve, reject) => {
            const tx = db.transaction('config', 'readonly');
            const req = tx.objectStore('config').get(key);
            const t = setTimeout(() => resolve(null), 1000);
            req.onsuccess = () => { clearTimeout(t); resolve(req.result || null); };
            req.onerror = () => { clearTimeout(t); resolve(null); };
          });
          if (item) configItems.push(item);
        } catch (e) { /* skip */ }
      }
      if (configItems.length > 0) {
        backup['config'] = configItems;
      }
    }

    if (Object.keys(backup).length > 0) {
      try {
        localStorage.setItem('ped_purge_backup', JSON.stringify(backup));
      } catch (e) {
        // localStorage 可能容量不够（5MB 限制），尝试只备份 horses
        console.warn('[Storage] 完整备份超出 localStorage 限制，尝试最小备份:', e.message);
        try {
          const minimal = {};
          if (backup.horses) minimal.horses = backup.horses;
          if (backup.dam_groups) minimal.dam_groups = backup.dam_groups;
          localStorage.setItem('ped_purge_backup', JSON.stringify(minimal));
        } catch (e2) {
          console.warn('[Storage] 最小备份也失败:', e2.message);
        }
      }
    }
  },

  /** 删除整个数据库 */
  _deleteDB() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('deleteDatabase timeout (5s)'));
      }, 5000);
      const request = indexedDB.deleteDatabase(this.DB_NAME);
      request.onsuccess = () => { clearTimeout(timeout); resolve(); };
      request.onerror = (e) => { clearTimeout(timeout); reject(e.target.error || new Error('deleteDatabase failed')); };
      request.onblocked = () => {
        // 被其他连接阻塞时，等待一下再 resolve
        console.warn('[Storage] deleteDatabase blocked，等待释放...');
      };
    });
  },

  /** 从 localStorage 恢复备份的用户数据 */
  async _restoreBackupIfNeeded() {
    if (!localStorage.getItem('ped_purge_has_backup')) return;
    const raw = localStorage.getItem('ped_purge_backup');
    if (!raw) { localStorage.removeItem('ped_purge_has_backup'); return; }

    try {
      const backup = JSON.parse(raw);
      for (const [storeName, items] of Object.entries(backup)) {
        if (!this.db.objectStoreNames.contains(storeName)) continue;
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const item of items) {
          store.put(item);
        }
        await new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      console.log('[Storage] 用户数据已从备份恢复');
    } catch (e) {
      console.warn('[Storage] 恢复备份失败:', e.message);
    }

    // 清理备份数据
    localStorage.removeItem('ped_purge_backup');
    localStorage.removeItem('ped_purge_has_backup');
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

  /** 加载预置真实国数据（仅当 races store 为空时） */
  async _loadPresetData() {
    // 双重检测：config flag 或 races store 已有数据
    const flag = await this.get('config', 'preset_countries_loaded_v5');
    if (flag) return;

    // 检查 races store 是否已有数据（备份恢复后可能已有）
    const existingRaces = await this.getAll('races');
    if (existingRaces.length > 0) {
      // races 已有数据，补设 flag 避免下次重复检查
      await this.put('config', { key: 'preset_countries_loaded_v5', value: true });
      return;
    }

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
