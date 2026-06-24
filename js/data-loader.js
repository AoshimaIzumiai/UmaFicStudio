/* data-loader.js — 加载真实马数据（按需加载 + IndexedDB 持久缓存） */
'use strict';

const DataLoader = {
  index: null,
  pedigreeCache: {},
  _loadedShards: new Set(),

  async loadIndex() {
    if (this.index) return this.index;
    try {
      const resp = await fetch(`data/stallions_index.json?t=${Date.now()}`);
      this.index = await resp.json();
      // 版本变化时清除 IndexedDB 血统缓存
      const vKey = 'ped_cache_version';
      const cached = await Storage.get('config', vKey);
      if (!cached || cached.value !== this.index.version) {
        await this._clearIDBCache();
        await Storage.put('config', { key: vKey, value: this.index.version });
      }
      console.log(`[DataLoader] 加载完成: ${this.index.count} 匹种马`);
    } catch (e) {
      console.warn('[DataLoader] 无法加载 stallions_index.json:', e.message);
      this.index = { version: '0', count: 0, horses: [] };
    }
    return this.index;
  },

  async _clearIDBCache() {
    try {
      const all = await Storage.getAll('config');
      for (const item of all) {
        if (item.key && item.key.startsWith('ped_') && item.key !== 'ped_cache_version') {
          await Storage.delete('config', item.key);
        }
      }
      // 同时清除所有架空马的 pedigree_cache（防止引用旧数据）
      const horses = await Storage.getAll('horses');
      for (const h of horses) {
        if (h.pedigree_cache) {
          h.pedigree_cache = null;
          await Storage.saveHorse(h);
        }
      }
    } catch (e) {}
  },

  async loadPedigree(horseId) {
    // 1. 内存缓存
    if (this.pedigreeCache[horseId]) return this.pedigreeCache[horseId];

    // 2. IndexedDB 缓存
    const cached = await this._getFromIDB(horseId);
    if (cached) {
      this.pedigreeCache[horseId] = cached;
      return cached;
    }

    // 3. 尝试按索引位置加载分片
    const shardIndex = this._getShardIndex(horseId);
    if (!this._loadedShards.has(shardIndex)) {
      const shardFile = `data/pedigree/pedigree_${String(shardIndex).padStart(2, '0')}.json?v=${this.index?.version || ''}`;
      try {
        const resp = await fetch(shardFile);
        const shard = await resp.json();
        Object.assign(this.pedigreeCache, shard);
        this._loadedShards.add(shardIndex);
        this._saveToIDB(shard);
      } catch (e) {}
    }
    if (this.pedigreeCache[horseId]) return this.pedigreeCache[horseId];

    // 4. 索引位置不准时，遍历所有分片查找
    for (let i = 0; i <= 30; i++) {
      if (this._loadedShards.has(i)) continue;
      const file = `data/pedigree/pedigree_${String(i).padStart(2, '0')}.json?v=${this.index?.version || ''}`;
      try {
        const resp = await fetch(file);
        const shard = await resp.json();
        Object.assign(this.pedigreeCache, shard);
        this._loadedShards.add(i);
        this._saveToIDB(shard);
        if (this.pedigreeCache[horseId]) return this.pedigreeCache[horseId];
      } catch (e) {}
    }
    return null;
  },

  _getShardIndex(horseId) {
    const horses = this.index ? this.index.horses : [];
    const idx = horses.findIndex(h => h.id === horseId);
    return idx >= 0 ? Math.floor(idx / 100) : 0;
  },

  getHorseFromIndex(id) {
    if (!this.index) return null;
    return this.index.horses.find(h => h.id === id) || null;
  },

  // IndexedDB 持久缓存（使用 config store 存分片数据）
  async _getFromIDB(horseId) {
    try {
      const key = `ped_${horseId}`;
      const record = await Storage.get('config', key);
      return record ? record.value : null;
    } catch (e) { return null; }
  },

  async _saveToIDB(shard) {
    try {
      for (const [id, ped] of Object.entries(shard)) {
        await Storage.put('config', { key: `ped_${id}`, value: ped });
      }
    } catch (e) {
      console.warn('[DataLoader] IndexedDB 缓存写入失败:', e.message);
    }
  }
};
