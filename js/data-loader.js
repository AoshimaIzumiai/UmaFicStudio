/* data-loader.js — 加载真实马数据（按需加载 + IndexedDB 持久缓存） */
'use strict';

const DataLoader = {
  index: null,
  pedigreeCache: {},
  _loadedShards: new Set(),

  async loadIndex() {
    if (this.index) return this.index;
    try {
      const resp = await fetch('data/stallions_index.json');
      this.index = await resp.json();
      console.log(`[DataLoader] 加载完成: ${this.index.count} 匹种马`);
    } catch (e) {
      console.warn('[DataLoader] 无法加载 stallions_index.json:', e.message);
      this.index = { version: '0', count: 0, horses: [] };
    }
    return this.index;
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

    // 3. 网络加载分片
    const shardIndex = this._getShardIndex(horseId);
    if (this._loadedShards.has(shardIndex)) return null; // 已加载过该分片但没有这匹马

    const shardFile = `data/pedigree/pedigree_${String(shardIndex).padStart(2, '0')}.json`;
    try {
      const resp = await fetch(shardFile);
      const shard = await resp.json();
      Object.assign(this.pedigreeCache, shard);
      this._loadedShards.add(shardIndex);
      // 写入 IndexedDB 持久缓存
      this._saveToIDB(shard);
      return shard[horseId] || null;
    } catch (e) {
      console.warn(`[DataLoader] 无法加载分片 ${shardFile}:`, e.message);
      return null;
    }
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
