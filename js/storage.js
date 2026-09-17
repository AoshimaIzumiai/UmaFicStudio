/* storage.js — IndexedDB 封装 + localStorage 降级 */
'use strict';

const Storage = {
  DB_NAME: globalThis.__STORAGE_TEST_DB_NAME__ || 'StudDataDB',
  DB_VERSION: 5,
  db: null,
  useLocalStorage: false,
  _workspaceOwner: null,
  _presetIdsReady: false,
  _syncSafetyErrors: new Map(),
  _v5MigrationKey: 'migration_v5_sync_records',

  // 用户数据 stores（需要在 deleteDatabase 前备份）
  _USER_STORES: ['horses', 'dam_groups', 'farms', 'trainers', 'owners', 'countries', 'jockeys', 'races', 'results', 'press_articles'],

  // 可同步的 stores（不含 press_articles、config）
  _SYNCABLE_STORES: new Set(['horses', 'dam_groups', 'farms', 'trainers', 'owners', 'countries', 'jockeys', 'races', 'results']),

  // 同步相关 stores（备份时也需要保留）
  _SYNC_STORES: ['sync_outbox', 'sync_meta'],

  // 初始化防护：重复调用必须等待同一个异步初始化过程
  _initPromise: null,
  _initDone: false,

  /** 初始化数据库；并发调用共享同一个 Promise */
  init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initInternal();
    return this._initPromise;
  },

  async _initInternal() {
    try {
      // 如果老用户数据库被 ped_ 缓存污染，先 deleteDatabase 彻底清除
      await this._nukeIfContaminated();
      this.db = await this._openDB();
      // 先恢复备份并加载 workspace owner，再做迁移和预置数据检查
      await this._restoreBackupIfNeeded();
      await this._loadWorkspaceOwner();
      await this._recoverInterruptedWorkspaceSwitch();
      // v5 记录迁移必须先取得静态 preset ID，避免把旧 preset 当作用户数据。
      await this._loadPresetData();
      await this._checkAndMigrate();
      // 检测数据丢失：已绑定 workspace 只进入隔离 staging，不静默写回。
      await this._detectAndRecoverDataLoss();
      // 启动定期自动备份
      this._startAutoBackup();
      this._initDone = true;
      console.log('[Storage] IndexedDB 就绪');
    } catch (e) {
      console.warn('[Storage] IndexedDB 不可用，降级为 localStorage:', e.message);
      this.useLocalStorage = true;
      this._initDone = true;
      // localStorage 降级模式下同步功能不可用
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
      // 无法打开就无法证明业务与同步状态已完整备份；必须 fail-closed 保留原库。
      console.warn('[Storage] 数据库打开超时，无法安全备份，取消污染清理:', e.message);
      this._setSyncSafetyError('SAFARI_BACKUP_UNAVAILABLE',
        'IndexedDB 无法安全备份，已取消数据库清理', { cause: e.message });
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
      backed = await this._backupUserData(db);
      console.log('[Storage] 用户数据已备份');
    } catch (e) {
      console.warn('[Storage] 关键数据备份失败，取消删库以避免数据丢失:', e.message);
    }
    db.close();

    // 有用户/同步数据时，备份失败绝不能继续 deleteDatabase。
    if (!backed) return;

    try {
      await this._deleteDB();
      console.log('[Storage] 旧数据库已删除');
    } catch (e) {
      console.warn('[Storage] deleteDatabase 失败:', e.message);
      return;
    }

    localStorage.setItem('ped_purge_done', '1');
    localStorage.setItem('ped_purge_has_backup', '1');
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

  /**
   * 备份所有用户与同步数据到 localStorage。
   * 任一业务/同步 store 读取失败、序列化失败、容量不足或回读条数不一致时抛错，
   * 调用方必须保留原数据库，禁止降级为不完整备份后继续 deleteDatabase。
   */
  async _backupUserData(db) {
    const storeNames = [...db.objectStoreNames];
    const allBackupStores = [...this._USER_STORES, ...this._SYNC_STORES];
    const storesToBackup = allBackupStores.filter(s => storeNames.includes(s));
    const backup = {};
    const expectedCounts = {};

    for (const storeName of storesToBackup) {
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        const t = setTimeout(() => reject(new Error(`getAll timeout: ${storeName}`)), 2000);
        req.onsuccess = () => { clearTimeout(t); resolve(req.result || []); };
        req.onerror = () => { clearTimeout(t); reject(req.error || new Error(`getAll failed: ${storeName}`)); };
        tx.onabort = () => { clearTimeout(t); reject(tx.error || new Error(`transaction aborted: ${storeName}`)); };
      });
      backup[storeName] = data;
      expectedCounts[storeName] = data.length;
    }

    // config 只保存可安全重建流程所需的精确 key，不遍历可能污染的 ped_ 数据。
    if (storeNames.includes('config')) {
      const configKeys = ['migration_v2_done', 'preset_countries_loaded_v5', 'year_mode'];
      const configItems = [];
      for (const key of configKeys) {
        const item = await new Promise((resolve) => {
          const tx = db.transaction('config', 'readonly');
          const req = tx.objectStore('config').get(key);
          const t = setTimeout(() => resolve(null), 1000);
          req.onsuccess = () => { clearTimeout(t); resolve(req.result || null); };
          req.onerror = () => { clearTimeout(t); resolve(null); };
        });
        if (item) configItems.push(item);
      }
      backup.config = configItems;
      expectedCounts.config = configItems.length;
    }

    let serialized;
    try {
      serialized = JSON.stringify({ version: 2, expectedCounts, stores: backup });
      if (typeof serialized !== 'string' || serialized.length === 0) {
        throw new Error('serialized backup is empty');
      }
    } catch (e) {
      throw new Error(`备份序列化失败: ${e.message}`);
    }

    try {
      localStorage.setItem('ped_purge_backup', serialized);
    } catch (e) {
      throw new Error(`备份容量不足或写入失败: ${e.message}`);
    }

    // 必须从 localStorage 回读、解析并逐 store 核对条数后才允许调用方删库。
    try {
      const persistedRaw = localStorage.getItem('ped_purge_backup');
      if (!persistedRaw) throw new Error('backup missing after write');
      const persisted = JSON.parse(persistedRaw);
      if (persisted.version !== 2 || !persisted.stores || !persisted.expectedCounts) {
        throw new Error('backup envelope invalid');
      }
      for (const storeName of storesToBackup) {
        const items = persisted.stores[storeName];
        if (!Array.isArray(items)) throw new Error(`${storeName} missing`);
        if (items.length !== expectedCounts[storeName]) {
          throw new Error(`${storeName} count mismatch`);
        }
      }
      // sync store 只要存在于数据库，就必须明确备份（即使为空数组）。
      for (const storeName of this._SYNC_STORES) {
        if (storeNames.includes(storeName) && !Array.isArray(persisted.stores[storeName])) {
          throw new Error(`${storeName} critical backup missing`);
        }
      }
    } catch (e) {
      localStorage.removeItem('ped_purge_backup');
      throw new Error(`备份回读校验失败: ${e.message}`);
    }
    return true;
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

  /** 从 localStorage 原子恢复污染清理前的备份；失败时保留备份供下次重试 */
  async _restoreBackupIfNeeded() {
    if (!localStorage.getItem('ped_purge_has_backup')) return;
    const raw = localStorage.getItem('ped_purge_backup');
    if (!raw) throw new Error('ped purge backup marker exists but payload is missing');

    const envelope = JSON.parse(raw);
    const backup = envelope?.version === 2 ? envelope.stores : envelope;
    const expectedCounts = envelope?.version === 2 ? envelope.expectedCounts :
      Object.fromEntries(Object.entries(backup || {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : -1]));
    if (!backup || typeof backup !== 'object') throw new Error('ped purge backup payload invalid');

    const entries = Object.entries(backup).filter(([storeName, items]) =>
      this.db.objectStoreNames.contains(storeName) && Array.isArray(items));
    const storeNames = entries.map(([storeName]) => storeName);
    if (storeNames.length > 0) {
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeNames, 'readwrite');
        for (const [storeName, items] of entries) {
          const store = tx.objectStore(storeName);
          for (const item of items) store.put(item);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('backup restore transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('backup restore transaction aborted'));
      });

      for (const [storeName] of entries) {
        const count = await new Promise((resolve, reject) => {
          const tx = this.db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error(`count failed: ${storeName}`));
        });
        if (count < Number(expectedCounts[storeName] || 0)) {
          throw new Error(`backup restore count mismatch: ${storeName}`);
        }
      }
    }

    console.log('[Storage] 用户数据已从备份恢复并通过条数校验');
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
        // v5: 同步基础设施
        if (!db.objectStoreNames.contains('sync_outbox')) {
          const outbox = db.createObjectStore('sync_outbox', { keyPath: 'op_id' });
          outbox.createIndex('user_module', ['user_id', 'module'], { unique: false });
          outbox.createIndex('user_id', 'user_id', { unique: false });
        }
        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
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

  async _putRaw(storeName, data) {
    if (this.useLocalStorage) return this._lsPut(storeName, data);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(data);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async put(storeName, data) {
    if (this._SYNCABLE_STORES.has(storeName) && data?.id) {
      const record = { ...data };
      if (!Number.isFinite(record.updated_at)) record.updated_at = Date.now();
      return this._commitLocalMutation(storeName, record.id, 'upsert', record);
    }
    return this._putRaw(storeName, data);
  },

  async _deleteRaw(storeName, key) {
    if (this.useLocalStorage) return this._lsDelete(storeName, key);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async delete(storeName, key) {
    if (this._SYNCABLE_STORES.has(storeName)) {
      return this._commitLocalMutation(storeName, key, 'delete', null);
    }
    return this._deleteRaw(storeName, key);
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
  async saveHorse(horse) {
    horse.updated_at = Date.now();
    return this._commitLocalMutation('horses', horse.id, 'upsert', horse);
  },
  async deleteHorse(id) {
    return this._commitLocalMutation('horses', id, 'delete', null);
  },
  async getAllHorses() { return this.getAll('horses'); },

  async getGroup(id) { return this.get('dam_groups', id); },
  async saveGroup(group) {
    group.updated_at = Date.now();
    return this._commitLocalMutation('dam_groups', group.id, 'upsert', group);
  },
  async deleteGroup(id) {
    return this._commitLocalMutation('dam_groups', id, 'delete', null);
  },
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
  async saveEntity(store, data) {
    data.updated_at = Date.now();
    return this._commitLocalMutation(store, data.id, 'upsert', data);
  },
  async deleteEntity(store, id) {
    return this._commitLocalMutation(store, id, 'delete', null);
  },
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
    if (!flag) {
      await this.migrateEntityReferences();
      await this.put('config', { key: 'migration_v2_done', value: true });
    }
    if (this._presetIdsReady) await this._migrateSyncRecordsV5();
  },

  _numericUpdatedAt(value, fallback = Date.now()) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  },

  /**
   * v4→v5 可恢复迁移：九个同步模块逐批补数值型 updated_at。
   * migration state/cursor 与当前批记录在同一 IDB 事务提交；事务覆盖全部九模块，
   * 因而多个标签页会被 IndexedDB 串行化，不会让 cursor 倒退。
   */
  async _migrateSyncRecordsV5({ batchSize = 100, maxBatches = Infinity } = {}) {
    if (this.useLocalStorage) return { status: 'skipped' };
    if (!this._presetIdsReady) {
      this._setSyncSafetyError('PRESET_FILTER_UNAVAILABLE', '预置数据清单未就绪，v5 迁移已暂停');
      return { status: 'blocked', code: 'PRESET_FILTER_UNAVAILABLE' };
    }

    const modules = [...this._SYNCABLE_STORES];
    const txStores = [...modules, 'sync_meta'];
    let batches = 0;
    let state = null;

    while (batches < maxBatches) {
      state = await new Promise((resolve, reject) => {
        const tx = this.db.transaction(txStores, 'readwrite');
        const meta = tx.objectStore('sync_meta');
        const stateReq = meta.get(this._v5MigrationKey);
        let nextState = null;

        stateReq.onsuccess = () => {
          const stored = stateReq.result?.value;
          const base = stored && stored.version === 5 ? stored : {
            version: 5,
            status: 'running',
            store_index: 0,
            cursor: null,
            processed_count: 0,
            updated_count: 0,
            started_at: Date.now(),
          };
          if (base.status === 'done' || base.store_index >= modules.length) {
            nextState = { ...base, status: 'done', store_index: modules.length,
              cursor: null, completed_at: base.completed_at || Date.now() };
            meta.put({ key: this._v5MigrationKey, value: nextState });
            return;
          }

          const module = modules[base.store_index];
          const store = tx.objectStore(module);
          const range = base.cursor == null ? null : IDBKeyRange.lowerBound(base.cursor, true);
          const cursorReq = store.openCursor(range);
          let processed = 0;
          let updated = 0;
          let lastKey = base.cursor;

          cursorReq.onsuccess = (event) => {
            const cursor = event.target.result;
            if (!cursor) {
              nextState = {
                ...base,
                status: base.store_index + 1 >= modules.length ? 'done' : 'running',
                store_index: base.store_index + 1,
                cursor: null,
                processed_count: (base.processed_count || 0) + processed,
                updated_count: (base.updated_count || 0) + updated,
                updated_at: Date.now(),
              };
              if (nextState.status === 'done') nextState.completed_at = Date.now();
              meta.put({ key: this._v5MigrationKey, value: nextState });
              return;
            }

            const record = cursor.value;
            lastKey = cursor.primaryKey;
            processed += 1;
            const isPreset = record?.source === 'preset' || this._getPresetIds().has(record?.id);
            if (!isPreset && record && typeof record === 'object') {
              const normalized = this._numericUpdatedAt(record.updated_at);
              if (record.updated_at !== normalized || !Number.isFinite(record.updated_at)) {
                store.put({ ...record, updated_at: normalized });
                updated += 1;
              }
            }

            if (processed >= batchSize) {
              nextState = {
                ...base,
                status: 'running',
                cursor: lastKey,
                processed_count: (base.processed_count || 0) + processed,
                updated_count: (base.updated_count || 0) + updated,
                updated_at: Date.now(),
              };
              meta.put({ key: this._v5MigrationKey, value: nextState });
              return;
            }
            cursor.continue();
          };
          cursorReq.onerror = () => tx.abort();
        };
        stateReq.onerror = () => tx.abort();
        tx.oncomplete = () => resolve(nextState);
        tx.onerror = () => reject(tx.error || new Error('v5 migration transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('v5 migration transaction aborted'));
      });

      batches += 1;
      if (state?.status === 'done') break;
    }
    return state;
  },

  _setSyncSafetyError(code, message, details = null) {
    const error = { code, message, details, nonRetryable: true };
    this._syncSafetyErrors.set(code, error);
    return error;
  },

  _clearSyncSafetyError(code) {
    this._syncSafetyErrors.delete(code);
  },

  assertSyncReadyForNetwork() {
    if (this.useLocalStorage) {
      const error = new Error('IndexedDB 不可用，无法启用云同步');
      error.code = 'SYNC_STORAGE_UNAVAILABLE';
      error.nonRetryable = true;
      throw error;
    }
    if (!this._presetIdsReady) {
      const error = new Error('预置数据清单未就绪，为防止误上传已停止同步');
      error.code = 'PRESET_FILTER_UNAVAILABLE';
      error.nonRetryable = true;
      throw error;
    }
    const owner = this.getWorkspaceOwner();
    if (owner && localStorage.getItem(`auto_backup_recovery_pending_${owner}`)) {
      const error = new Error('检测到待确认的本地数据恢复，云同步已暂停');
      error.code = 'LOCAL_RECOVERY_REQUIRED';
      error.nonRetryable = true;
      throw error;
    }
    const blocker = this._syncSafetyErrors.values().next().value;
    if (blocker) {
      const error = new Error(blocker.message);
      Object.assign(error, blocker);
      throw error;
    }
    return true;
  },

  async _reconcilePresetOutbox() {
    if (this.useLocalStorage || !this.db.objectStoreNames.contains('sync_outbox')) return 0;
    const presetIds = this._getPresetIds();
    let removed = 0;
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_outbox', 'readwrite');
      const store = tx.objectStore('sync_outbox');
      const req = store.openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const item = cursor.value;
        if (presetIds.has(item.record_id) || item.data?.source === 'preset') {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      req.onerror = () => tx.abort();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('preset outbox reconciliation failed'));
      tx.onabort = () => reject(tx.error || new Error('preset outbox reconciliation aborted'));
    });
    return removed;
  },

  /** 加载预置真实国数据，并始终重建稳定 preset ID 清单 */
  async _loadPresetData() {
    this._presetIdsReady = false;
    this._PRESET_IDS = null;
    let data;
    try {
      const resp = await fetch('/data/real_countries.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
      const countries = Array.isArray(data.countries) ? data.countries : (data.country ? [data.country] : []);
      const races = Array.isArray(data.races) ? data.races : [];
      const presetIds = [...countries, ...races].map(item => item?.id);
      if (countries.length === 0 || races.length === 0 || presetIds.some(id => typeof id !== 'string' || !id)) {
        throw new Error('preset schema invalid or empty');
      }
      const uniqueIds = [...new Set(presetIds)];
      if (uniqueIds.length !== presetIds.length) throw new Error('duplicate preset id');

      const serialized = JSON.stringify(uniqueIds);
      localStorage.setItem('_preset_record_ids', serialized);
      const persisted = JSON.parse(localStorage.getItem('_preset_record_ids') || 'null');
      if (!Array.isArray(persisted) || persisted.length !== uniqueIds.length) {
        throw new Error('preset id persistence verification failed');
      }
      this._PRESET_IDS = new Set(uniqueIds);
      this._presetIdsReady = true;
      this._clearSyncSafetyError('PRESET_FILTER_UNAVAILABLE');
      await this._reconcilePresetOutbox();
    } catch (e) {
      this._presetIdsReady = false;
      this._PRESET_IDS = null;
      this._setSyncSafetyError('PRESET_FILTER_UNAVAILABLE',
        '预置数据清单加载失败，为防止误上传已停止同步', { cause: e.message });
      console.warn('[Storage] 预置 ID 清单加载失败，同步保持关闭:', e.message);
      return false;
    }

    const flag = await this.get('config', 'preset_countries_loaded_v5');
    if (flag) return true;

    // 备份恢复后可能已有赛事，不重复写入，只补 flag 和稳定 ID 清单。
    const existingRaces = await this.getAll('races');
    if (existingRaces.length > 0) {
      await this.put('config', { key: 'preset_countries_loaded_v5', value: true });
      return true;
    }

    try {
      const countries = Array.isArray(data.countries) ? data.countries : [data.country];
      for (const country of countries) await this.put('countries', { ...country, source: 'preset' });
      for (const race of data.races) await this.put('races', { ...race, source: 'preset' });
      await this.put('config', { key: 'preset_countries_loaded_v5', value: true });
      console.log(`[Storage] 预置数据加载完成: ${data.races.length} 场赛事`);
      return true;
    } catch (e) {
      // ID 清单已验证，预置内容写入失败不允许误同步，但本地可在下次启动重试。
      console.warn('[Storage] 预置数据写入失败:', e.message);
      return false;
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
  },

  // === 自动备份机制 ===

  _autoBackupTimer: null,

  /** 每 5 分钟自动备份 horses 数据（去除 pedigree_cache 节省空间）*/
  _startAutoBackup() {
    // 首次延迟 30 秒备份（让页面加载完成）
    setTimeout(() => this._doAutoBackup(), 30000);
    // 之后每 5 分钟
    this._autoBackupTimer = setInterval(() => this._doAutoBackup(), 5 * 60 * 1000);
  },

  async _doAutoBackup() {
    try {
      const horses = await this.getAllHorses();
      if (!horses || horses.length === 0) return;

      // 去除 pedigree_cache 节省空间（可以重新生成）
      const stripped = horses.map(h => {
        const copy = Object.assign({}, h);
        delete copy.pedigree_cache;
        return copy;
      });

      const backupStr = JSON.stringify({
        ts: Date.now(),
        count: stripped.length,
        horses: stripped
      });

      // localStorage 限制约 5MB，horses 数据通常 < 2MB
      if (backupStr.length > 4 * 1024 * 1024) {
        // 超过 4MB，只保存基本字段
        const minimal = horses.map(h => ({
          id: h.id, name_en: h.name_en, name_ja: h.name_ja, name_cn: h.name_cn,
          type: h.type, sex: h.sex, birth_year: h.birth_year,
          sire_id: h.sire_id, dam_id: h.dam_id, color: h.color, country: h.country,
          role: h.role, tags: h.tags
        }));
        localStorage.setItem('auto_backup_horses', JSON.stringify({
          ts: Date.now(), count: minimal.length, horses: minimal, minimal: true
        }));
      } else {
        localStorage.setItem('auto_backup_horses', backupStr);
      }
    } catch (e) {
      // 静默失败，不影响正常使用
    }
  },

  /**
   * 数据丢失检测：匿名 workspace 可从自动备份恢复；已绑定 workspace 只写隔离 staging，
   * 防止恢复内容在没有用户确认时被当作新修改上传或覆盖云端。
   */
  async _detectAndRecoverDataLoss() {
    const horses = await this.getAllHorses();
    if (horses && horses.length > 0) return;

    const raw = localStorage.getItem('auto_backup_horses');
    if (!raw) return;

    try {
      const backup = JSON.parse(raw);
      if (!Array.isArray(backup.horses) || backup.horses.length === 0) return;
      if (Number(backup.count) !== backup.horses.length) {
        throw new Error('自动备份条数校验失败');
      }

      const owner = this.getWorkspaceOwner();
      if (owner) {
        const stagingKey = `auto_backup_recovery_pending_${owner}`;
        const staging = {
          version: 1,
          owner,
          staged_at: Date.now(),
          count: backup.horses.length,
          minimal: !!backup.minimal,
          horses: backup.horses,
        };
        const serialized = JSON.stringify(staging);
        localStorage.setItem(stagingKey, serialized);
        const persisted = JSON.parse(localStorage.getItem(stagingKey) || 'null');
        if (!persisted || persisted.owner !== owner || persisted.horses?.length !== staging.count) {
          throw new Error('隔离恢复 staging 校验失败');
        }
        this._setSyncSafetyError('LOCAL_RECOVERY_REQUIRED',
          '检测到待确认的本地数据恢复，云同步已暂停', { count: staging.count });
        console.warn('[Storage] 已绑定 workspace 数据恢复已隔离，等待用户确认', staging.count);
        return { staged: true, count: staging.count };
      }

      console.warn('[Storage] 匿名 workspace 从自动备份恢复', backup.count, '匹马');
      for (const horse of backup.horses) await this.put('horses', horse);
      console.log('[Storage] 匿名数据恢复完成');
      return { restored: true, count: backup.horses.length };
    } catch (e) {
      console.warn('[Storage] 自动恢复失败:', e.message);
      return { error: e.message };
    }
  },

  // === 同步基础设施（v5） ===

  /**
   * 用户业务写入的唯一事务入口。
   * 已绑定 workspace 时，业务记录、outbox、generation 和 sequence 必须一起提交，
   * 从而使 snapshot 最终事务不可能夹在“本地已改、outbox 尚未写”之间。
   */
  async _commitLocalMutation(store, recordId, action, data) {
    const owner = this.getWorkspaceOwner();
    const isKnownPreset = data?.source === 'preset' ||
      (this._presetIdsReady && this._getPresetIds().has(recordId));
    const shouldSync = !this.useLocalStorage && !!owner &&
      this._SYNCABLE_STORES.has(store) && !isKnownPreset;

    if (!shouldSync) {
      if (action === 'delete') return this._deleteRaw(store, recordId);
      return this._putRaw(store, data);
    }

    const opId = crypto.randomUUID();
    const payload = action === 'upsert' ? this._stripSyncMeta(data) : null;

    await new Promise((resolve, reject) => {
      const tx = this.db.transaction([store, 'sync_outbox', 'sync_meta'], 'readwrite');
      const businessStore = tx.objectStore(store);
      const outboxStore = tx.objectStore('sync_outbox');
      const metaStore = tx.objectStore('sync_meta');

      const enqueue = (knownRevision) => {
        const genKey = `gen_${owner}`;
        const seqKey = `outbox_seq_${owner}`;
        const genReq = metaStore.get(genKey);
        const seqReq = metaStore.get(seqKey);
        let currentGen = 0;
        let currentSeq = 0;
        let genReady = false;
        let seqReady = false;

        const finishQueue = () => {
          if (!genReady || !seqReady) return;
          const sequence = currentSeq + 1;
          metaStore.put({ key: genKey, value: currentGen + 1 });
          metaStore.put({ key: seqKey, value: sequence });
          outboxStore.put({
            op_id: opId,
            user_id: owner,
            module: store,
            record_id: recordId,
            action,
            data: payload,
            known_revision: knownRevision ?? null,
            local_updated_at: Date.now(),
            sequence,
          });
        };

        genReq.onsuccess = () => {
          currentGen = genReq.result ? Number(genReq.result.value) || 0 : 0;
          genReady = true;
          finishQueue();
        };
        seqReq.onsuccess = () => {
          currentSeq = seqReq.result ? Number(seqReq.result.value) || 0 : 0;
          seqReady = true;
          finishQueue();
        };
        genReq.onerror = seqReq.onerror = () => tx.abort();
      };

      if (action === 'delete') {
        const existingReq = businessStore.get(recordId);
        existingReq.onsuccess = () => {
          const knownRevision = existingReq.result?._server_revision ?? null;
          businessStore.delete(recordId);
          enqueue(knownRevision);
        };
        existingReq.onerror = () => tx.abort();
      } else {
        businessStore.put(data);
        enqueue(data?._server_revision ?? null);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('local mutation transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('local mutation transaction aborted'));
    });

    if (typeof Sync !== 'undefined') Sync.schedulePush();
  },

  /**
   * 去除本地同步内部字段，只保留业务数据
   */
  _stripSyncMeta(data) {
    const copy = { ...data };
    delete copy._server_revision;
    delete copy._deleted;
    return copy;
  },

  /**
   * 远端应用 upsert — 不产生 outbox，保留服务端 revision
   */
  async applyRemoteUpsert(module, id, data, serverRevision) {
    if (this.useLocalStorage) return; // 降级模式不同步
    const record = { ...data, id, _server_revision: serverRevision };
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(module, 'readwrite');
      tx.objectStore(module).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * 远端应用 delete — 不产生 outbox
   */
  async applyRemoteDelete(module, id) {
    if (this.useLocalStorage) return;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(module, 'readwrite');
      tx.objectStore(module).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /**
   * 写入 outbox（用户操作调用），同一事务内递增 workspace_mutation_generation
   * @param {string} userId - 当前 workspace owner 的 user_id
   * @param {string} module - 模块名
   * @param {string} recordId - 记录 ID
   * @param {string} action - 'upsert' | 'delete'
   * @param {object|null} data - 记录数据（delete 时可为 null）
   * @param {string} opId - 唯一操作 ID（UUID v4）
   * @param {number|null} knownRevision - 该记录上次已知的服务端 revision
   */
  async writeOutbox(userId, module, recordId, action, data, opId, knownRevision) {
    if (this.useLocalStorage) return;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sync_outbox', 'sync_meta'], 'readwrite');
      const outboxStore = tx.objectStore('sync_outbox');
      const metaStore = tx.objectStore('sync_meta');
      const genKey = `gen_${userId}`;
      const seqKey = `outbox_seq_${userId}`;
      const genReq = metaStore.get(genKey);
      const seqReq = metaStore.get(seqKey);
      let currentGen = 0;
      let currentSeq = 0;
      let genReady = false;
      let seqReady = false;

      const finishQueue = () => {
        if (!genReady || !seqReady) return;
        const sequence = currentSeq + 1;
        metaStore.put({ key: genKey, value: currentGen + 1 });
        metaStore.put({ key: seqKey, value: sequence });
        outboxStore.put({
          op_id: opId,
          user_id: userId,
          module,
          record_id: recordId,
          action,
          data,
          known_revision: knownRevision ?? null,
          local_updated_at: Date.now(),
          sequence,
        });
      };

      genReq.onsuccess = () => {
        currentGen = genReq.result ? Number(genReq.result.value) || 0 : 0;
        genReady = true;
        finishQueue();
      };
      seqReq.onsuccess = () => {
        currentSeq = seqReq.result ? Number(seqReq.result.value) || 0 : 0;
        seqReady = true;
        finishQueue();
      };
      genReq.onerror = seqReq.onerror = () => tx.abort();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('outbox transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('outbox transaction aborted'));
    });
  },

  /**
   * 获取指定用户的 outbox 待发送数量
   */
  async getOutboxCount(userId) {
    if (this.useLocalStorage) return 0;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_outbox', 'readonly');
      const index = tx.objectStore('sync_outbox').index('user_id');
      const req = index.count(IDBKeyRange.only(userId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * 获取指定用户的 outbox 批次：严格按 sequence 排序，且每批只含一个模块。
   * 旧版没有 sequence 的记录回退到 local_updated_at/op_id，保证可迁移。
   */
  async getOutboxBatch(userId, limit) {
    if (this.useLocalStorage) return [];
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_outbox', 'readonly');
      const index = tx.objectStore('sync_outbox').index('user_id');
      const req = index.getAll(IDBKeyRange.only(userId));
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => {
          const aSeq = Number.isFinite(a.sequence) ? a.sequence : 0;
          const bSeq = Number.isFinite(b.sequence) ? b.sequence : 0;
          if (aSeq !== bSeq) return aSeq - bSeq;
          const timeDiff = (a.local_updated_at || 0) - (b.local_updated_at || 0);
          return timeDiff || String(a.op_id).localeCompare(String(b.op_id));
        });
        if (items.length === 0) return resolve([]);
        const module = items[0].module;
        resolve(items.filter(item => item.module === module).slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  },

  /**
   * 从 outbox 中移除已确认的操作
   */
  async removeFromOutbox(userId, opId) {
    if (this.useLocalStorage) return;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_outbox', 'readwrite');
      tx.objectStore('sync_outbox').delete(opId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },



  /**
   * 删除云端账号后清理该 user_id 的本地同步队列与元数据。
   * 仅清 sync_outbox/sync_meta，不触碰九个业务 store、Press、preset 或其他账号状态。
   */
  async clearUserSyncState(userId) {
    const uid = String(userId || '');
    if (!uid) return;
    localStorage.removeItem(`sync_cursor_${uid}`);
    if (this.useLocalStorage) return;

    const metaKeys = [
      `cursor_${uid}`, `gen_${uid}`, `outbox_seq_${uid}`, `baseline_${uid}`,
      `last_error_${uid}`, `last_synced_at_${uid}`, this._initialUploadKey(uid),
      `initial_upload_completed_${uid}`,
    ];
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sync_outbox', 'sync_meta'], 'readwrite');
      const outboxIndex = tx.objectStore('sync_outbox').index('user_id');
      const cursorReq = outboxIndex.openCursor(IDBKeyRange.only(uid));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => tx.abort();
      const metaStore = tx.objectStore('sync_meta');
      for (const key of metaKeys) metaStore.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('user sync state cleanup failed'));
      tx.onabort = () => reject(tx.error || new Error('user sync state cleanup aborted'));
    });
  },
  // === Sync Meta 读写 ===

  /**
   * 获取同步 cursor（按 user_id，统一存储在 sync_meta）
   */
  async getSyncCursor(userId) {
    const legacyKey = `sync_cursor_${userId}`;
    if (this.useLocalStorage) {
      return parseInt(localStorage.getItem(legacyKey) || '0', 10);
    }
    const item = await this.get('sync_meta', `cursor_${userId}`);
    if (item) return Number(item.value) || 0;

    // v5 早期版本曾写入 localStorage；读取一次后迁移并删除旧值。
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      const cursor = parseInt(legacy || '0', 10) || 0;
      await this.setSyncCursor(userId, cursor);
      localStorage.removeItem(legacyKey);
      return cursor;
    }
    return 0;
  },

  /**
   * 设置同步 cursor（按 user_id，统一存储在 sync_meta）
   */
  async setSyncCursor(userId, cursor) {
    const value = Math.max(0, Number(cursor) || 0);
    if (this.useLocalStorage) {
      localStorage.setItem(`sync_cursor_${userId}`, String(value));
      return;
    }
    await this.put('sync_meta', { key: `cursor_${userId}`, value });
    localStorage.removeItem(`sync_cursor_${userId}`);
  },

  async setSyncError(userId, error) {
    if (this.useLocalStorage || !userId) return;
    await this.put('sync_meta', {
      key: `last_error_${userId}`,
      value: {
        code: error?.code || 'UNKNOWN',
        status: Number(error?.status) || 0,
        message: error?.message || 'Unknown sync error',
        request_id: error?.requestId || '',
        failed_operations: Array.isArray(error?.failedOperations)
          ? error.failedOperations.slice(0, 100).map(item => ({
              op_id: String(item.op_id || ''),
              module: String(item.module || ''),
              record_id: String(item.record_id || ''),
            }))
          : [],
        at: Date.now(),
      },
    });
  },

  async clearSyncError(userId) {
    if (this.useLocalStorage || !userId) return;
    await this.delete('sync_meta', `last_error_${userId}`);
  },

  /**
   * 读取持久化的最近同步错误（供 R5 同步详情展示）。
   * @returns {object|null} { code, status, message, request_id, failed_operations, at }
   */
  async getSyncError(userId) {
    if (this.useLocalStorage || !userId) return null;
    const item = await this.get('sync_meta', `last_error_${userId}`);
    return item ? item.value : null;
  },

  /**
   * 记录最近一次成功同步时间（毫秒）。成功分支调用。
   */
  async setLastSyncedAt(userId, timestampMs = Date.now()) {
    if (this.useLocalStorage || !userId) return;
    await this.put('sync_meta', { key: `last_synced_at_${userId}`, value: Number(timestampMs) || Date.now() });
  },

  /**
   * 读取最近一次成功同步时间（毫秒），无则返回 null。
   */
  async getLastSyncedAt(userId) {
    if (this.useLocalStorage || !userId) return null;
    const item = await this.get('sync_meta', `last_synced_at_${userId}`);
    return item && Number.isFinite(Number(item.value)) ? Number(item.value) : null;
  },

  /**
   * 获取 workspace mutation generation
   */
  async getWorkspaceGeneration(userId) {
    if (this.useLocalStorage) return 0;
    const item = await this.get('sync_meta', `gen_${userId}`);
    return item ? item.value : 0;
  },

  /** 从 sync_meta 加载 workspace owner，并一次性迁移旧 localStorage 值。 */
  async _loadWorkspaceOwner() {
    if (this.useLocalStorage) {
      this._workspaceOwner = localStorage.getItem('sync_workspace_owner') || null;
      return this._workspaceOwner;
    }
    const item = await this.get('sync_meta', 'workspace_owner');
    if (item) {
      this._workspaceOwner = item.value ? String(item.value) : null;
    } else {
      const legacy = localStorage.getItem('sync_workspace_owner');
      this._workspaceOwner = legacy || null;
      await this.put('sync_meta', { key: 'workspace_owner', value: this._workspaceOwner });
    }
    if (this._workspaceOwner) {
      localStorage.setItem('sync_workspace_owner', this._workspaceOwner);
    } else {
      localStorage.removeItem('sync_workspace_owner');
    }
    return this._workspaceOwner;
  },

  /** 获取内存中的 workspace owner（权威值来自 sync_meta）。 */
  getWorkspaceOwner() {
    if (!this._initDone && this._workspaceOwner === null) {
      return localStorage.getItem('sync_workspace_owner') || null;
    }
    return this._workspaceOwner;
  },

  /** 设置 workspace owner；调用方必须 await 持久化完成。 */
  async setWorkspaceOwner(userId) {
    const value = userId ? String(userId) : null;
    if (!this.useLocalStorage) {
      await this.put('sync_meta', { key: 'workspace_owner', value });
    }
    this._workspaceOwner = value;
    if (value) localStorage.setItem('sync_workspace_owner', value);
    else localStorage.removeItem('sync_workspace_owner');
  },

  // === Workspace 原子切换与回滚 ===

  _workspaceSwitchStateKey: 'workspace_switch_state',
  _workspaceBackupPrefix(switchId) { return `workspace_backup_${switchId}_`; },

  _workspaceChecksum(entries) {
    let hash = 2166136261;
    for (const entry of entries) {
      const text = `${entry.module}\u0000${JSON.stringify(entry.record)}`;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  },

  async getWorkspaceSwitchState() {
    if (this.useLocalStorage) return null;
    const item = await this.get('sync_meta', this._workspaceSwitchStateKey);
    return item ? item.value : null;
  },

  async beginWorkspaceSwitch(newUserId) {
    this.assertSyncReadyForAdoption();
    const uid = String(newUserId);
    const switchId = crypto.randomUUID();
    const backupPrefix = this._workspaceBackupPrefix(switchId);
    const storeNames = [...this._SYNCABLE_STORES, 'sync_meta'];
    let switchState = null;

    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeNames, 'readwrite');
      const metaStore = tx.objectStore('sync_meta');
      const recordsByModule = new Map();
      const readPromises = [];
      const toPromise = (req, label) => new Promise((done, fail) => {
        req.onsuccess = () => done(req.result || null);
        req.onerror = () => fail(req.error || new Error(`读取 ${label} 失败`));
      });

      for (const module of this._SYNCABLE_STORES) {
        const req = tx.objectStore(module).getAll();
        readPromises.push(toPromise(req, module).then(records => {
          recordsByModule.set(module, records || []);
        }));
      }
      const stateReq = metaStore.get(this._workspaceSwitchStateKey);
      const ownerReq = metaStore.get('workspace_owner');
      const cursorReq = metaStore.get(`cursor_${uid}`);
      const genReq = metaStore.get(`gen_${uid}`);
      const baselineReq = metaStore.get(`baseline_${uid}`);

      Promise.all([
        ...readPromises,
        toPromise(stateReq, 'switch state'),
        toPromise(ownerReq, 'workspace owner'),
        toPromise(cursorReq, 'target cursor'),
        toPromise(genReq, 'target generation'),
        toPromise(baselineReq, 'target baseline'),
      ]).then((values) => {
        const offset = readPromises.length;
        if (values[offset]) {
          tx.abort();
          return;
        }
        const previousOwner = values[offset + 1]?.value ? String(values[offset + 1].value) : null;
        const targetCursorItem = values[offset + 2];
        const targetGenItem = values[offset + 3];
        const targetBaselineItem = values[offset + 4];
        if (previousOwner === uid) {
          tx.abort();
          return;
        }

        const entries = [];
        const counts = {};
        for (const [module, records] of recordsByModule.entries()) {
          counts[module] = records.length;
          for (const record of records) entries.push({ module, record });
        }
        entries.forEach((entry, index) => {
          metaStore.put({
            key: `${backupPrefix}${String(index).padStart(8, '0')}`,
            value: entry,
          });
        });

        switchState = {
          status: 'prepared',
          switch_id: switchId,
          backup_prefix: backupPrefix,
          previous_owner: previousOwner,
          target_user: uid,
          total_items: entries.length,
          counts,
          checksum: this._workspaceChecksum(entries),
          target_meta: {
            cursor: targetCursorItem,
            generation: targetGenItem,
            baseline: targetBaselineItem,
          },
          created_at: Date.now(),
        };
        metaStore.put({ key: this._workspaceSwitchStateKey, value: switchState });

        // 清空九模块后仅放回 preset；Press/config 和所有 outbox 不在事务范围内，不受影响。
        const presetIds = this._getPresetIds();
        for (const [module, records] of recordsByModule.entries()) {
          const store = tx.objectStore(module);
          store.clear();
          if (module === 'countries' || module === 'races') {
            for (const record of records) {
              if (record?.source === 'preset' || presetIds.has(record?.id)) store.put(record);
            }
          }
        }

        const currentTargetGen = Number(targetGenItem?.value) || 0;
        metaStore.put({ key: 'workspace_owner', value: uid });
        metaStore.put({ key: `cursor_${uid}`, value: 0 });
        metaStore.put({ key: `gen_${uid}`, value: currentTargetGen + 1 });
        metaStore.put({ key: `baseline_${uid}`, value: false });
      }).catch(() => {
        try { tx.abort(); } catch (_) { /* inactive */ }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('workspace切换准备失败'));
      tx.onabort = () => reject(tx.error || new Error('workspace切换准备已中止'));
    });

    this._workspaceOwner = uid;
    localStorage.setItem('sync_workspace_owner', uid);
    return switchState;
  },

  async _readWorkspaceBackup(state) {
    const range = IDBKeyRange.bound(state.backup_prefix, `${state.backup_prefix}\uffff`);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_meta', 'readonly');
      const req = tx.objectStore('sync_meta').getAll(range);
      req.onsuccess = () => resolve((req.result || []).map(item => item.value));
      req.onerror = () => reject(req.error || new Error('读取workspace备份失败'));
    });
  },

  async commitWorkspaceSwitch(expectedUserId) {
    const state = await this.getWorkspaceSwitchState();
    if (!state || state.target_user !== String(expectedUserId)) return false;
    const range = IDBKeyRange.bound(state.backup_prefix, `${state.backup_prefix}\uffff`);
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('sync_meta', 'readwrite');
      const store = tx.objectStore('sync_meta');
      const req = store.openKeyCursor(range);
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
      };
      req.onerror = () => tx.abort();
      store.delete(this._workspaceSwitchStateKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('workspace切换提交失败'));
      tx.onabort = () => reject(tx.error || new Error('workspace切换提交中止'));
    });
    return true;
  },

  async rollbackWorkspaceSwitch() {
    const state = await this.getWorkspaceSwitchState();
    if (!state) return false;
    const entries = await this._readWorkspaceBackup(state);
    if (entries.length !== state.total_items || this._workspaceChecksum(entries) !== state.checksum) {
      const error = new Error('workspace备份校验失败，已停止回滚以避免进一步损坏');
      error.code = 'WORKSPACE_BACKUP_INVALID';
      throw error;
    }

    const range = IDBKeyRange.bound(state.backup_prefix, `${state.backup_prefix}\uffff`);
    const stores = [...this._SYNCABLE_STORES, 'sync_meta'];
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      const metaStore = tx.objectStore('sync_meta');
      for (const module of this._SYNCABLE_STORES) tx.objectStore(module).clear();
      for (const entry of entries) tx.objectStore(entry.module).put(entry.record);

      metaStore.put({ key: 'workspace_owner', value: state.previous_owner || null });
      const restoreMeta = (item, key) => {
        if (item) metaStore.put(item);
        else metaStore.delete(key);
      };
      restoreMeta(state.target_meta.cursor, `cursor_${state.target_user}`);
      restoreMeta(state.target_meta.generation, `gen_${state.target_user}`);
      restoreMeta(state.target_meta.baseline, `baseline_${state.target_user}`);

      const req = metaStore.openKeyCursor(range);
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) { metaStore.delete(cursor.primaryKey); cursor.continue(); }
      };
      req.onerror = () => tx.abort();
      metaStore.delete(this._workspaceSwitchStateKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('workspace回滚失败'));
      tx.onabort = () => reject(tx.error || new Error('workspace回滚中止'));
    });

    this._workspaceOwner = state.previous_owner || null;
    if (this._workspaceOwner) localStorage.setItem('sync_workspace_owner', this._workspaceOwner);
    else localStorage.removeItem('sync_workspace_owner');
    return true;
  },

  async _recoverInterruptedWorkspaceSwitch() {
    const state = await this.getWorkspaceSwitchState();
    if (!state) return false;
    console.warn('[Storage] 检测到未提交的workspace切换，自动回滚');
    return this.rollbackWorkspaceSwitch();
  },

  // === 首次上传 / workspace adoption ===

  _initialUploadKey(userId) { return `initial_upload_${userId}`; },

  assertSyncReadyForAdoption() {
    return this.assertSyncReadyForNetwork();
  },

  async getInitialUploadState(userId) {
    if (this.useLocalStorage) return null;
    const item = await this.get('sync_meta', this._initialUploadKey(userId));
    return item ? item.value : null;
  },

  /**
   * 原子收养匿名 workspace：扫描九模块，并在同一事务内写入持久 outbox、
   * pending 状态、cursor=0、generation 和 workspace_owner。
   */
  async beginInitialUpload(userId) {
    this.assertSyncReadyForAdoption();
    const uid = String(userId);
    const currentOwner = this.getWorkspaceOwner();
    if (currentOwner && currentOwner !== uid) {
      const error = new Error('当前 workspace 属于其他账号，禁止直接合并');
      error.code = 'WORKSPACE_OWNER_CONFLICT';
      throw error;
    }

    const existing = await this.getInitialUploadState(uid);
    if (existing?.status === 'pending') {
      // 上次原子准备已经成功，直接沿用原 op_id/outbox 续传。
      if (currentOwner !== uid) await this.setWorkspaceOwner(uid);
      return existing;
    }
    if (currentOwner === uid) {
      return { status: 'not_needed', total_items: 0, existing_workspace: true };
    }

    const stores = [...this._SYNCABLE_STORES, 'sync_outbox', 'sync_meta'];
    let preparedState = null;
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, 'readwrite');
      const outboxStore = tx.objectStore('sync_outbox');
      const metaStore = tx.objectStore('sync_meta');
      const recordsByModule = new Map();
      const requests = [];

      for (const module of this._SYNCABLE_STORES) {
        const req = tx.objectStore(module).getAll();
        requests.push(new Promise((done, fail) => {
          req.onsuccess = () => { recordsByModule.set(module, req.result || []); done(); };
          req.onerror = () => fail(req.error || new Error(`读取 ${module} 失败`));
        }));
      }

      const ownerReq = metaStore.get('workspace_owner');
      const genReq = metaStore.get(`gen_${uid}`);
      const seqReq = metaStore.get(`outbox_seq_${uid}`);
      const stateReq = metaStore.get(this._initialUploadKey(uid));
      const requestPromise = (req) => new Promise((done, fail) => {
        req.onsuccess = () => done(req.result || null);
        req.onerror = () => fail(req.error || new Error('读取同步元数据失败'));
      });

      Promise.all([
        ...requests,
        requestPromise(ownerReq),
        requestPromise(genReq),
        requestPromise(seqReq),
        requestPromise(stateReq),
      ]).then((values) => {
        const metaOffset = requests.length;
        const storedOwner = values[metaOffset]?.value ? String(values[metaOffset].value) : null;
        const currentGen = Number(values[metaOffset + 1]?.value) || 0;
        let sequence = Number(values[metaOffset + 2]?.value) || 0;
        const storedState = values[metaOffset + 3]?.value || null;

        if (storedState?.status === 'pending') {
          preparedState = storedState;
          return;
        }
        if (storedOwner && storedOwner !== uid) {
          tx.abort();
          return;
        }

        const adoptionId = crypto.randomUUID();
        let totalItems = 0;
        for (const [module, records] of recordsByModule.entries()) {
          for (const record of records) {
            if (!this.isSyncableRecord(module, record)) continue;
            sequence += 1;
            totalItems += 1;
            outboxStore.put({
              op_id: crypto.randomUUID(),
              user_id: uid,
              module,
              record_id: record.id,
              action: 'upsert',
              data: this._stripSyncMeta(record),
              known_revision: null,
              local_updated_at: Date.now(),
              sequence,
              adoption_id: adoptionId,
            });
          }
        }

        preparedState = {
          status: 'pending',
          adoption_id: adoptionId,
          total_items: totalItems,
          created_at: Date.now(),
          baseline_established: false,
        };
        metaStore.put({ key: this._initialUploadKey(uid), value: preparedState });
        metaStore.put({ key: `cursor_${uid}`, value: 0 });
        metaStore.put({ key: `gen_${uid}`, value: currentGen + 1 });
        metaStore.put({ key: `outbox_seq_${uid}`, value: sequence });
        metaStore.put({ key: 'workspace_owner', value: uid });
      }).catch(() => {
        try { tx.abort(); } catch (_) { /* inactive */ }
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('首次上传准备失败'));
      tx.onabort = () => reject(tx.error || new Error('首次上传准备已中止'));
    });

    this._workspaceOwner = uid;
    localStorage.setItem('sync_workspace_owner', uid);
    return preparedState;
  },

  async completeInitialUpload(userId) {
    const uid = String(userId);
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['sync_outbox', 'sync_meta'], 'readwrite');
      const outboxStore = tx.objectStore('sync_outbox');
      const metaStore = tx.objectStore('sync_meta');
      const countReq = outboxStore.index('user_id').count(IDBKeyRange.only(uid));
      const baselineReq = metaStore.get(`baseline_${uid}`);
      let canComplete = false;
      const check = () => {
        if (countReq.readyState !== 'done' || baselineReq.readyState !== 'done') return;
        const baseline = baselineReq.result?.value === true;
        if (countReq.result === 0 && baseline) {
          metaStore.delete(this._initialUploadKey(uid));
          metaStore.put({ key: `initial_upload_completed_${uid}`, value: Date.now() });
          canComplete = true;
        }
      };
      countReq.onsuccess = check;
      baselineReq.onsuccess = check;
      countReq.onerror = baselineReq.onerror = () => { try { tx.abort(); } catch (_) {} };
      tx.oncomplete = () => resolve(canComplete);
      tx.onerror = () => reject(tx.error || new Error('首次上传完成状态写入失败'));
      tx.onabort = () => reject(tx.error || new Error('首次上传完成状态中止'));
    });
  },

  // === Snapshot 原子替换 ===

  /**
   * 原子替换 9 个同步业务 store（snapshot 重建）。
   * 最终事务会再次检查 owner、generation 和当前用户 outbox；任何变化都中止。
   * preset 不属于云端工作区，替换时必须原样保留。
   */
  async atomicSnapshotReplace(
    userId, staging, snapshotRevision, startGeneration, expectedTotalItems = null
  ) {
    if (this.useLocalStorage || this.getWorkspaceOwner() !== String(userId)) return false;
    if (!Array.isArray(staging) || !Number.isFinite(Number(snapshotRevision))) return false;
    if (expectedTotalItems !== null && staging.length !== Number(expectedTotalItems)) return false;

    // 在开启最终事务前完成完整性校验；不完整/重复/非法模块的快照绝不落地。
    const seen = new Set();
    for (const item of staging) {
      if (!item || !this._SYNCABLE_STORES.has(item.module) ||
          typeof item.id !== 'string' || !item.data || typeof item.data !== 'object' ||
          !Number.isFinite(Number(item.revision))) return false;
      const key = `${item.module}\u0000${item.id}`;
      if (seen.has(key) || this._getPresetIds().has(item.id)) return false;
      seen.add(key);
    }

    // Snapshot 不含 preset；先读取静态预置记录，最终事务清库后原样放回。
    const presetIds = this._getPresetIds();
    const presetRecords = { countries: [], races: [] };
    for (const module of ['countries', 'races']) {
      const records = await this.getAll(module);
      presetRecords[module] = records.filter(
        record => record?.source === 'preset' || presetIds.has(record?.id)
      );
    }

    const storeNames = [...this._SYNCABLE_STORES, 'sync_outbox', 'sync_meta'];
    return new Promise((resolve) => {
      const tx = this.db.transaction(storeNames, 'readwrite');
      const metaStore = tx.objectStore('sync_meta');
      const outboxStore = tx.objectStore('sync_outbox');
      let accepted = false;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const abort = () => {
        try { tx.abort(); } catch (_) { /* already inactive */ }
      };

      const genReq = metaStore.get(`gen_${userId}`);
      genReq.onsuccess = () => {
        const currentGen = genReq.result ? Number(genReq.result.value) || 0 : 0;
        if (currentGen !== Number(startGeneration) ||
            this.getWorkspaceOwner() !== String(userId)) {
          abort();
          return;
        }

        const countReq = outboxStore.index('user_id').count(IDBKeyRange.only(userId));
        countReq.onsuccess = () => {
          if (countReq.result > 0 || this.getWorkspaceOwner() !== String(userId)) {
            abort();
            return;
          }

          // 所有 clear 先入队，再恢复 preset 和写入完整 staging；整个过程同一事务提交。
          for (const module of this._SYNCABLE_STORES) tx.objectStore(module).clear();
          for (const [module, records] of Object.entries(presetRecords)) {
            for (const record of records) tx.objectStore(module).put(record);
          }
          for (const item of staging) {
            tx.objectStore(item.module).put({
              ...item.data,
              id: item.id,
              _server_revision: Number(item.revision),
            });
          }
          metaStore.put({ key: `cursor_${userId}`, value: Number(snapshotRevision) });
          metaStore.put({ key: `baseline_${userId}`, value: true });
          accepted = true;
        };
        countReq.onerror = abort;
      };
      genReq.onerror = abort;

      tx.oncomplete = () => finish(accepted);
      tx.onerror = () => finish(false);
      tx.onabort = () => finish(false);
    });
  },

  // === 同步模块过滤 ===

  _PRESET_IDS: null,

  /**
   * 判断一条记录是否可同步（排除 Press/config/preset）
   */
  isSyncableRecord(storeName, record) {
    if (!this._SYNCABLE_STORES.has(storeName)) return false;
    if (!this._presetIdsReady) return false;
    if (record && record.source === 'preset') return false;
    if (record && this._getPresetIds().has(record.id)) return false;
    return true;
  },

  /** 获取已验证的预置 ID 集合；未就绪时仅返回空集，网络入口会先 fail-closed */
  _getPresetIds() {
    if (this._PRESET_IDS) return this._PRESET_IDS;
    const raw = localStorage.getItem('_preset_record_ids');
    if (raw) {
      try {
        const ids = JSON.parse(raw);
        if (Array.isArray(ids)) this._PRESET_IDS = new Set(ids);
      } catch (_) { /* assertSyncReadyForNetwork 会阻止同步 */ }
    }
    return this._PRESET_IDS || new Set();
  },
};

// 自动初始化
Storage.init();
