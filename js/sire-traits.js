/* sire-traits.js — 父系血统特征查找与后代推测 */
'use strict';

const SireTraits = {
  _data: null,    // traits map: id -> trait object
  _loaded: false,

  /** 加载特征数据 */
  async load() {
    if (this._loaded) return;
    try {
      const resp = await fetch('data/sire_line_traits.json?t=' + Date.now());
      const json = await resp.json();
      this._data = json.traits || {};
      this._loaded = true;
    } catch (e) {
      console.warn('[SireTraits] 加载失败:', e.message);
      this._data = {};
      this._loaded = true;
    }
  },

  /**
   * 沿 sire_id 链向上查找最近的特征标注
   * @param {string} horseId - 马匹 ID
   * @returns {object|null} - 找到的特征数据，或 null
   */
  async findTraits(horseId) {
    await this.load();
    return this._findTraitsSync(horseId);
  },

  /**
   * 同步版本：仅在 index 中查找（适用于列表批量渲染）
   * 调用前需确保已 load()
   */
  _findTraitsSync(horseId) {
    if (!this._data) return null;
    if (this._data[horseId]) return this._data[horseId];

    let currentId = horseId;
    for (let depth = 0; depth < 20; depth++) {
      const horse = DataLoader.getHorseFromIndex(currentId);
      if (!horse || !horse.sire_id) break;
      currentId = horse.sire_id;
      if (this._data[currentId]) return this._data[currentId];
    }
    return null;
  },

  /**
   * 获取一匹马所属的 sire line 名称（同步）
   */
  _getLineNameSync(horseId) {
    if (!this._data) return null;
    if (this._data[horseId]) return this._data[horseId].name;

    let currentId = horseId;
    for (let depth = 0; depth < 20; depth++) {
      const horse = DataLoader.getHorseFromIndex(currentId);
      if (!horse || !horse.sire_id) break;
      currentId = horse.sire_id;
      if (this._data[currentId]) return this._data[currentId].name;
    }
    return null;
  },

  /**
   * 推测后代特征：父系 × 母父系加权
   * 父系权重 0.6，母父系权重 0.4（父系对产驹影响更直接）
   * @param {string} sireId - 父 ID
   * @param {string} damSireId - 母父 ID（如有）
   * @returns {object} - 推测特征
   */
  async predict(sireId, damSireId) {
    await this.load();

    const sireTraits = await this.findTraits(sireId);
    const damSireTraits = damSireId ? await this.findTraits(damSireId) : null;

    // 如果两者都没有，返回默认值
    if (!sireTraits && !damSireTraits) {
      return this._defaultTraits();
    }

    // 只有一方有数据
    if (!sireTraits) return this._cloneTraits(damSireTraits);
    if (!damSireTraits) return this._cloneTraits(sireTraits);

    // 双方加权
    const W_SIRE = 0.6;
    const W_DAM_SIRE = 0.4;

    return {
      surface: sireTraits.surface * W_SIRE + damSireTraits.surface * W_DAM_SIRE,
      distance: [
        Math.round(sireTraits.distance[0] * W_SIRE + damSireTraits.distance[0] * W_DAM_SIRE),
        Math.round(sireTraits.distance[1] * W_SIRE + damSireTraits.distance[1] * W_DAM_SIRE)
      ],
      maturity: [
        sireTraits.maturity[0] * W_SIRE + damSireTraits.maturity[0] * W_DAM_SIRE,
        sireTraits.maturity[1] * W_SIRE + damSireTraits.maturity[1] * W_DAM_SIRE
      ],
      temperament: sireTraits.temperament * W_SIRE + damSireTraits.temperament * W_DAM_SIRE,
      power: sireTraits.power * W_SIRE + damSireTraits.power * W_DAM_SIRE
    };
  },

  /**
   * 从配种模拟的父×母模式中推测后代特征
   * 母系特征优先级：1.母马所属牝系分组特征 → 2.母父 sire line 特征
   */
  async predictFromMating(sireId, damId) {
    const sireTraits = await this.findTraits(sireId);

    // 尝试找母系分组特征
    let damTraits = await this._findDamFamilyTraits(damId);

    // fallback: 母父的 sire line 特征
    if (!damTraits) {
      const dam = DataLoader.getHorseFromIndex(damId) || await Storage.getHorse(damId);
      const damSireId = dam ? dam.sire_id : null;
      damTraits = damSireId ? await this.findTraits(damSireId) : null;
    }

    // 合并
    if (!sireTraits && !damTraits) return this._defaultTraits();
    if (!sireTraits) return this._cloneTraits(damTraits);
    if (!damTraits) return this._cloneTraits(sireTraits);

    const W_SIRE = 0.6, W_DAM = 0.4;
    return {
      surface: sireTraits.surface * W_SIRE + damTraits.surface * W_DAM,
      distance: [
        Math.round(sireTraits.distance[0] * W_SIRE + damTraits.distance[0] * W_DAM),
        Math.round(sireTraits.distance[1] * W_SIRE + damTraits.distance[1] * W_DAM)
      ],
      maturity: [
        sireTraits.maturity[0] * W_SIRE + damTraits.maturity[0] * W_DAM,
        sireTraits.maturity[1] * W_SIRE + damTraits.maturity[1] * W_DAM
      ],
      temperament: sireTraits.temperament * W_SIRE + damTraits.temperament * W_DAM,
      power: sireTraits.power * W_SIRE + damTraits.power * W_DAM
    };
  },

  /**
   * 查找一匹母马所属牝系分组的特征
   * 沿 dam_id 链向上找，看她或她的母系祖先是否在某个分组中
   */
  async _findDamFamilyTraits(damId) {
    if (!damId) return null;
    const groups = await Storage.getAllGroups();
    if (!groups || groups.length === 0) return null;

    // 建立 horse_ids → groupId 的快速映射
    const horseToGroup = {};
    for (const g of groups) {
      for (const hid of g.horse_ids) {
        horseToGroup[hid] = g.id;
      }
    }

    // 沿 dam_id 链向上查找（母马自己 → 母母 → 母母母...）
    let currentId = damId;
    for (let depth = 0; depth < 15; depth++) {
      if (horseToGroup[currentId]) {
        const groupId = horseToGroup[currentId];
        const record = await Storage.get('config', `damline_traits_${groupId}`);
        if (record && record.value) return record.value;
        return null; // 找到分组但没设特征
      }
      // 向上找母亲
      const horse = await Storage.getHorse(currentId);
      if (!horse || !horse.dam_id) break;
      currentId = horse.dam_id;
    }
    return null;
  },

  // === 渲染工具 ===

  /**
   * 将推测结果渲染为 HTML 展示面板
   * @param {object} traits - 推测特征对象
   * @returns {string} HTML
   */
  renderPanel(traits) {
    if (!traits) return '';

    const surfaceLabel = this._surfaceLabel(traits.surface);
    const distLabel = this._distanceLabel(traits.distance);
    const matLabel = this._maturityLabel(traits.maturity);
    const tempLabel = this._temperamentLabel(traits.temperament);
    const powerLabel = this._powerLabel(traits.power);

    return `
      <div class="card sire-traits-panel" style="margin-top:12px">
        <h4 style="margin:0 0 8px">后代特征推测</h4>
        <div class="traits-grid">
          <div class="trait-row">
            <span class="trait-label">场地</span>
            <div class="trait-bar-wrap">
              <span class="trait-end">草</span>
              ${this._renderBar(traits.surface)}
              <span class="trait-end">泥</span>
            </div>
            <span class="trait-value">${surfaceLabel}</span>
          </div>
          <div class="trait-row">
            <span class="trait-label">距离</span>
            <div class="trait-bar-wrap">
              <span class="trait-end">短</span>
              ${this._renderRangeBar(traits.distance, 1000, 3200)}
              <span class="trait-end">长</span>
            </div>
            <span class="trait-value">${distLabel}</span>
          </div>
          <div class="trait-row">
            <span class="trait-label">成长</span>
            <div class="trait-bar-wrap">
              <span class="trait-end">早</span>
              ${this._renderRangeBar01(traits.maturity)}
              <span class="trait-end">晚</span>
            </div>
            <span class="trait-value">${matLabel}</span>
          </div>
          <div class="trait-row">
            <span class="trait-label">气性</span>
            <div class="trait-bar-wrap">
              <span class="trait-end">燥</span>
              ${this._renderBar(traits.temperament)}
              <span class="trait-end">稳</span>
            </div>
            <span class="trait-value">${tempLabel}</span>
          </div>
          <div class="trait-row">
            <span class="trait-label">类型</span>
            <div class="trait-bar-wrap">
              <span class="trait-end">速</span>
              ${this._renderBar(traits.power)}
              <span class="trait-end">耐</span>
            </div>
            <span class="trait-value">${powerLabel}</span>
          </div>
        </div>
        <p class="traits-note" style="font-size:11px;color:#888;margin:8px 0 0">※ 基于父系/母父系血统线特征推测，仅供参考</p>
      </div>
    `;
  },

  // === 内部方法 ===

  _renderBar(value) {
    const pct = Math.round(value * 100);
    return `<div class="trait-bar"><div class="trait-bar-fill" style="left:0;width:${pct}%"></div><div class="trait-bar-marker" style="left:${pct}%"></div></div>`;
  },

  _renderRangeBar(range, min, max) {
    const span = max - min;
    const left = Math.round(((range[0] - min) / span) * 100);
    const right = Math.round(((range[1] - min) / span) * 100);
    return `<div class="trait-bar"><div class="trait-bar-range" style="left:${left}%;width:${right - left}%"></div></div>`;
  },

  _renderRangeBar01(range) {
    const left = Math.round(range[0] * 100);
    const right = Math.round(range[1] * 100);
    return `<div class="trait-bar"><div class="trait-bar-range" style="left:${left}%;width:${right - left}%"></div></div>`;
  },

  _surfaceLabel(v) {
    if (v <= 0.2) return '草地';
    if (v <= 0.35) return '草地（泥地△）';
    if (v <= 0.55) return '草地 泥地';
    if (v <= 0.7) return '泥地（草地△）';
    return '泥地';
  },

  _distanceLabel(range) {
    const tags = this._distanceTags(range);
    return `${range[0]}~${range[1]}m（${tags.join('・')}）`;
  },

  _maturityLabel(range) {
    const mid = (range[0] + range[1]) / 2;
    if (mid <= 0.2) return '早熟';
    if (mid <= 0.35) return '稍早';
    if (mid <= 0.5) return '普通';
    if (mid <= 0.65) return '稍晚';
    return '晚成';
  },

  _temperamentLabel(v) {
    if (v <= 0.25) return '暴躁';
    if (v <= 0.4) return '偏躁';
    if (v <= 0.6) return '普通';
    if (v <= 0.75) return '偏稳';
    return '沉稳';
  },

  _powerLabel(v) {
    if (v <= 0.25) return '速力型';
    if (v <= 0.4) return '速力偏';
    if (v <= 0.6) return '均衡';
    if (v <= 0.75) return '耐力偏';
    return '耐力型';
  },

  /**
   * 渲染紧凑的单行标签（用于列表、树节点等空间有限的地方）
   * @param {object} traits - 特征对象
   * @returns {string} HTML 小标签行
   */
  renderTags(traits) {
    if (!traits) return '';
    const tags = [];

    // 场地（拆分为独立标签）
    if (traits.surface <= 0.55) {
      tags.push(`<span class="stag tag-turf">草地</span>`);
    }
    if (traits.surface >= 0.35) {
      tags.push(`<span class="stag tag-dirt">泥地</span>`);
    }

    // 距离（拆分为独立标签）
    const distTags = this._distanceTags(traits.distance);
    distTags.forEach(d => tags.push(`<span class="stag tag-dist">${d}</span>`));

    // 成长
    const mLabel = this._maturityLabel(traits.maturity);
    tags.push(`<span class="stag tag-mat">${mLabel}</span>`);

    // 气性（只在非普通时显示）
    if (traits.temperament <= 0.35 || traits.temperament >= 0.65) {
      const tLabel = traits.temperament <= 0.35 ? '暴躁' : '沉稳';
      const tClass = traits.temperament <= 0.35 ? 'tag-hot' : 'tag-calm';
      tags.push(`<span class="stag ${tClass}">${tLabel}</span>`);
    }

    // 速耐（只在非均衡时显示）
    if (traits.power <= 0.35 || traits.power >= 0.65) {
      const pLabel = traits.power <= 0.35 ? '速力' : '耐力';
      tags.push(`<span class="stag tag-power">${pLabel}</span>`);
    }

    return `<span class="stags">${tags.join('')}</span>`;
  },

  /** 距离范围拆分为独立标签 */
  _distanceTags(range) {
    const tags = [];
    if (range[0] <= 1300) tags.push('短途');
    if (range[0] <= 1800 && range[1] >= 1400) tags.push('英里');
    if (range[0] <= 2200 && range[1] >= 1900) tags.push('中距离');
    if (range[0] <= 2600 && range[1] >= 2300) tags.push('长距离');
    if (range[1] > 2600) tags.push('超长距离');
    if (tags.length === 0) tags.push(`${range[0]}~${range[1]}m`);
    return tags;
  },

  _defaultTraits() {
    return { surface: 0.5, distance: [1600, 2200], maturity: [0.3, 0.6], temperament: 0.5, power: 0.5 };
  },

  _cloneTraits(t) {
    return { surface: t.surface, distance: [...t.distance], maturity: [...t.maturity], temperament: t.temperament, power: t.power };
  }
};
