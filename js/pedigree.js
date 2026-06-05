/* pedigree.js — 血统树展开与缓存 */
'use strict';

const Pedigree = {
  MAX_DEPTH: 5,

  /**
   * 获取一匹马的五代血统树
   * @param {string} horseId
   * @returns {Promise<{sire: object|null, dam: object|null}>}
   */
  async getPedigreeTree(horseId) {
    // 先查用户数据
    const userHorse = await Storage.getHorse(horseId);
    if (userHorse) {
      if (userHorse.pedigree_cache) return userHorse.pedigree_cache;
      // 架空马：递归构建
      const tree = {
        sire: await this._buildNode(userHorse.sire_id, this.MAX_DEPTH),
        dam: await this._buildNode(userHorse.dam_id, this.MAX_DEPTH)
      };
      // 写入缓存
      userHorse.pedigree_cache = tree;
      await Storage.saveHorse(userHorse);
      return tree;
    }

    // 真实马：从 pedigree 文件加载
    const realHorse = DataLoader.getHorseFromIndex(horseId);
    if (realHorse) {
      return await DataLoader.loadPedigree(horseId);
    }

    return null;
  },

  /**
   * 构建单个血统节点（递归）
   */
  async _buildNode(id, remainingDepth) {
    if (!id || remainingDepth <= 0) return null;

    // 查找目标马
    const horse = await this._findHorse(id);
    if (!horse) return null;

    // 如果是真实马，从 pedigree 文件截取
    if (horse.type === 'real') {
      const fullTree = await DataLoader.loadPedigree(id);
      if (!fullTree) {
        return this._makeNodeFromHorse(horse);
      }
      // 返回一个包含该马自身信息 + 其血统树（裁剪到指定深度）的节点
      const node = this._makeNodeFromHorse(horse);
      if (remainingDepth > 1 && fullTree) {
        node.sire = this._trimTree(fullTree.sire, remainingDepth - 1);
        node.dam = this._trimTree(fullTree.dam, remainingDepth - 1);
      }
      return node;
    }

    // 架空马：继续递归
    const node = this._makeNodeFromHorse(horse);
    if (remainingDepth > 1) {
      node.sire = await this._buildNode(horse.sire_id, remainingDepth - 1);
      node.dam = await this._buildNode(horse.dam_id, remainingDepth - 1);
    }
    return node;
  },

  /**
   * 从马匹数据创建节点（不含子代）
   */
  _makeNodeFromHorse(horse) {
    return {
      id: horse.id,
      name_en: horse.name_en,
      name_ja: horse.name_ja || '',
      birth_year: horse.birth_year || null,
      color: horse.color || '',
      country: horse.country || '',
      type: horse.type || '',
      sire: null,
      dam: null
    };
  },

  /**
   * 裁剪树到指定深度
   */
  _trimTree(node, maxDepth) {
    if (!node || maxDepth <= 0) return null;
    const result = {
      id: node.id || null,
      name_en: node.name_en || '',
      name_ja: node.name_ja || '',
      birth_year: node.birth_year || null,
      color: node.color || '',
      country: node.country || ''
    };
    if (maxDepth > 1) {
      result.sire = this._trimTree(node.sire, maxDepth - 1);
      result.dam = this._trimTree(node.dam, maxDepth - 1);
    } else {
      result.sire = null;
      result.dam = null;
    }
    return result;
  },

  /**
   * 查找马匹（先用户数据，再真实马 index）
   */
  async _findHorse(id) {
    const userHorse = await Storage.getHorse(id);
    if (userHorse) return userHorse;
    return DataLoader.getHorseFromIndex(id);
  },

  /**
   * 缓存失效：当一匹马被修改时，清除所有引用它的后代的缓存
   */
  async onHorseUpdated(horseId) {
    const dependents = await Storage.findHorsesReferencing(horseId);
    for (const dep of dependents) {
      if (dep.pedigree_cache) {
        dep.pedigree_cache = null;
        await Storage.saveHorse(dep);
        // 递归清除下游
        await this.onHorseUpdated(dep.id);
      }
    }
  },

  /**
   * 检查血统完整度
   * @returns {{ gen1: {filled, total}, gen2: ..., ... }}
   */
  checkCompleteness(tree) {
    const result = {};
    for (let gen = 1; gen <= 5; gen++) {
      const total = Math.pow(2, gen);
      const nodes = this._getNodesAtDepth(tree, gen);
      const filled = nodes.filter(n => n !== null).length;
      result[`gen${gen}`] = { filled, total, percent: Math.round(filled / total * 100) };
    }
    return result;
  },

  /**
   * 获取指定深度的所有节点
   */
  _getNodesAtDepth(tree, targetDepth) {
    if (!tree) return Array(Math.pow(2, targetDepth)).fill(null);
    if (targetDepth === 1) return [tree.sire, tree.dam];

    const parentNodes = this._getNodesAtDepth(tree, targetDepth - 1);
    const result = [];
    for (const node of parentNodes) {
      if (node) {
        result.push(node.sire || null);
        result.push(node.dam || null);
      } else {
        result.push(null);
        result.push(null);
      }
    }
    return result;
  }
};
