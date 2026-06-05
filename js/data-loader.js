/* data-loader.js — 加载真实马数据 */
'use strict';

const DataLoader = {
  index: null,
  pedigreeCache: {},

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
    if (this.pedigreeCache[horseId]) return this.pedigreeCache[horseId];
    const shardIndex = this._getShardIndex(horseId);
    const shardFile = `data/pedigree/pedigree_${String(shardIndex).padStart(2, '0')}.json`;
    try {
      const resp = await fetch(shardFile);
      const shard = await resp.json();
      Object.assign(this.pedigreeCache, shard);
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
  }
};
