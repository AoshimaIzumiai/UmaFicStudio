/* data-loader.js — 加载真实马数据（按需加载分片，纯内存缓存） */
'use strict';

const DataLoader = {
  index: null,
  pedigreeCache: {},
  _loadedShards: new Set(),
  _baseUrl: '',

  async loadIndex() {
    if (this.index) return this.index;
    try {
      const resp = await fetch(`${this._baseUrl}data/stallions_index.json?t=${Date.now()}`);
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

    // 2. 尝试按索引位置加载分片
    const shardIndex = this._getShardIndex(horseId);
    if (!this._loadedShards.has(shardIndex)) {
      const shardFile = `${this._baseUrl}data/pedigree/pedigree_${String(shardIndex).padStart(2, '0')}.json?v=${this.index?.version || ''}`;
      try {
        const resp = await fetch(shardFile);
        const shard = await resp.json();
        Object.assign(this.pedigreeCache, shard);
        this._loadedShards.add(shardIndex);
      } catch (e) {}
    }
    if (this.pedigreeCache[horseId]) return this.pedigreeCache[horseId];

    // 3. 索引位置不准时，遍历所有分片查找
    for (let i = 0; i <= 30; i++) {
      if (this._loadedShards.has(i)) continue;
      const file = `${this._baseUrl}data/pedigree/pedigree_${String(i).padStart(2, '0')}.json?v=${this.index?.version || ''}`;
      try {
        const resp = await fetch(file);
        const shard = await resp.json();
        Object.assign(this.pedigreeCache, shard);
        this._loadedShards.add(i);
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
  }
};
