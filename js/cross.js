/* cross.js — Cross 计算算法（日本式简化血量计算） */
'use strict';

const Cross = {
  /**
   * 计算一匹马的 Cross
   * 规则1：重复祖先中止追溯（不再向上层计算）
   * 规则2：全兄弟（同父同母）视为同一匹
   */
  calculateCross(pedigreeTree, maxGen = 5) {
    if (!pedigreeTree) return { crosses: [], total_crosses: 0, inbreeding_coefficient: 0 };

    // 第一步：收集所有祖先（带中止规则）
    const ancestors = {}; // key -> { positions: [], name, sireId, damId }
    const crossedKeys = new Set(); // 已确认为 Cross 的 key（用于中止追溯）

    this._collectWithStop(pedigreeTree.sire, 'S', 1, ancestors, crossedKeys, maxGen);
    this._collectWithStop(pedigreeTree.dam, 'M', 1, ancestors, crossedKeys, maxGen);

    // 第二步：识别全兄弟并合并
    const siblingGroups = this._findSiblingGroups(ancestors);

    // 第三步：筛选 Cross 并生成结果
    const crosses = [];
    const processed = new Set();

    for (const [key, data] of Object.entries(ancestors)) {
      if (processed.has(key)) continue;

      // 检查是否属于某个兄弟组
      const group = siblingGroups.get(key);
      let sPositions, mPositions, displayName;

      if (group) {
        // 合并兄弟组的所有 positions
        sPositions = [];
        mPositions = [];
        const names = [];
        for (const sibKey of group) {
          processed.add(sibKey);
          const sibData = ancestors[sibKey];
          if (!sibData) continue;
          sPositions.push(...sibData.positions.filter(p => p.side === 'S').map(p => p.generation));
          mPositions.push(...sibData.positions.filter(p => p.side === 'M').map(p => p.generation));
          if (!names.includes(sibData.name)) names.push(sibData.name);
        }
        displayName = names.join(' / ');
      } else {
        processed.add(key);
        sPositions = data.positions.filter(p => p.side === 'S').map(p => p.generation);
        mPositions = data.positions.filter(p => p.side === 'M').map(p => p.generation);
        displayName = data.name;
      }

      if (sPositions.length > 0 && mPositions.length > 0) {
        let blood = 0;
        for (const g of sPositions) blood += Math.pow(0.5, g);
        for (const g of mPositions) blood += Math.pow(0.5, g);

        const allGens = [...sPositions, ...mPositions].sort((a, b) => a - b);
        const notation = `${displayName} ${allGens.join('×')}`;

        crosses.push({
          ancestor_key: key,
          ancestor_name: displayName,
          sibling_keys: group ? group.filter(k => k !== key) : [],
          positions: { sire_side: sPositions, dam_side: mPositions },
          notation,
          blood_percentage: Math.round(blood * 100 * 1000) / 1000
        });
      }
    }

    crosses.sort((a, b) => b.blood_percentage - a.blood_percentage);
    const totalCoefficient = crosses.reduce((sum, c) => sum + c.blood_percentage, 0);

    return {
      crosses,
      total_crosses: crosses.length,
      inbreeding_coefficient: Math.round(totalCoefficient * 1000) / 1000
    };
  },

  /**
   * 收集祖先（遇到已 Cross 的祖先则中止追溯其上层）
   * 关键：一旦某节点形成 Cross，它的所有上层祖先都被"污染"，
   * 即使从其他路径到达也不计入 Cross
   */
  _collectWithStop(node, side, generation, result, crossedKeys, maxGen) {
    if (!node || generation > maxGen) return;

    const key = node.id || node.name_en;

    // 无 key 的节点（如匿名母马）：不记录自身，但继续遍历子节点
    if (!key) {
      this._collectWithStop(node.sire, side, generation + 1, result, crossedKeys, maxGen);
      this._collectWithStop(node.dam, side, generation + 1, result, crossedKeys, maxGen);
      return;
    }

    // 如果该节点是某个已 Cross 祖先的上层，跳过
    if (this._isAncestorOfCrossed(key, node, result, crossedKeys)) return;

    // 记录该节点
    if (!result[key]) {
      result[key] = { positions: [], name: node.name_en || key, sireId: null, damId: null };
    }
    // 只有当 sire 和 dam 都存在时才更新父母信息（避免截断层的不完整数据覆盖）
    if (node.sire && node.dam && !result[key].sireId) {
      result[key].sireId = node.sire.id || node.sire.name_en || null;
      result[key].damId = node.dam.id || node.dam.name_en || null;
    }
    result[key].positions.push({ side, generation });

    // 检查该节点是否已在双侧出现（Cross）
    const hasBothSides = result[key].positions.some(p => p.side === 'S') &&
                         result[key].positions.some(p => p.side === 'M');
    if (hasBothSides) {
      crossedKeys.add(key);
      // 规则1：中止追溯，标记其所有上层祖先
      this._markAncestorsAsCrossed(node, crossedKeys);
      return;
    }

    // 继续向上追溯
    this._collectWithStop(node.sire, side, generation + 1, result, crossedKeys, maxGen);
    this._collectWithStop(node.dam, side, generation + 1, result, crossedKeys, maxGen);
  },

  /**
   * 标记一个节点的所有上层祖先为"已被 Cross 覆盖"
   */
  _markAncestorsAsCrossed(node, crossedKeys) {
    if (!node) return;
    if (node.sire) {
      const sKey = node.sire.id || node.sire.name_en;
      if (sKey) crossedKeys.add(sKey);
      this._markAncestorsAsCrossed(node.sire, crossedKeys);
    }
    if (node.dam) {
      const dKey = node.dam.id || node.dam.name_en;
      if (dKey) crossedKeys.add(dKey);
      this._markAncestorsAsCrossed(node.dam, crossedKeys);
    }
  },

  /**
   * 检查某个 key 是否已被标记为 Cross 祖先的上层
   */
  _isAncestorOfCrossed(key, node, result, crossedKeys) {
    return crossedKeys.has(key);
  },

  /**
   * 识别全兄弟组（同父同母的不同马，且都实际出现在血统表中）
   */
  _findSiblingGroups(ancestors) {
    // 全兄弟合并暂时禁用（数据中深层祖先的父母信息不够可靠）
    return new Map();

    // 只保留有多匹马且都有位置记录的组（即全兄弟都在表中出现）
    const siblingGroups = new Map();
    for (const group of Object.values(parentMap)) {
      // 过滤掉没有实际 position 的（被标记为 crossed 的上层）
      const validGroup = group.filter(k => ancestors[k] && ancestors[k].positions.length > 0);
      if (validGroup.length > 1) {
        for (const key of validGroup) {
          siblingGroups.set(key, validGroup);
        }
      }
    }
    return siblingGroups;
  },

  /**
   * 配种模拟
   */
  async simulateMating(sireId, damId) {
    const sireTree = await Pedigree.getPedigreeTree(sireId);
    const damTree = await Pedigree.getPedigreeTree(damId);
    const sireInfo = await Pedigree._findHorse(sireId);
    const damInfo = await Pedigree._findHorse(damId);

    const virtualTree = {
      sire: {
        id: sireId,
        name_en: sireInfo ? sireInfo.name_en : '???',
        country: sireInfo ? sireInfo.country : '',
        type: sireInfo ? sireInfo.type : '',
        sire: sireTree ? sireTree.sire : null,
        dam: sireTree ? sireTree.dam : null
      },
      dam: {
        id: damId,
        name_en: damInfo ? damInfo.name_en : '???',
        country: damInfo ? damInfo.country : '',
        type: damInfo ? damInfo.type : '',
        sire: damTree ? damTree.sire : null,
        dam: damTree ? damTree.dam : null
      }
    };

    const crossResult = this.calculateCross(virtualTree);
    return { tree: virtualTree, crossResult };
  }
};
