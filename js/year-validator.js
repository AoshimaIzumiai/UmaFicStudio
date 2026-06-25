/* year-validator.js — 年份算法约束 */
'use strict';

const YearValidator = {
  /**
   * 获取当前模式：'strict' 或 'free'
   */
  async getMode() {
    const config = await Storage.get('config', 'mode');
    return config ? config.value : 'free';
  },

  async setMode(mode) {
    await Storage.put('config', { key: 'mode', value: mode });
  },

  /**
   * 校验一匹马的年份约束
   * @param {object} horse - 马匹数据
   * @param {object} [options] - 选项
   * @param {string} [options.forceMode] - 强制使用指定模式（'strict'|'free'），不读取全局
   * @returns {{warnings: string[], errors: string[]}}
   */
  async validate(horse, options = {}) {
    const mode = options.forceMode || await this.getMode();
    const issues = [];
    const freeWarnings = []; // 架空模式下的弹窗警告

    // 出生年为空时跳过所有校验
    if (!horse.birth_year) return { warnings: [], errors: [] };

    // 规则3：种马/繁殖牝马最早配种年龄（stud_year_start ≥ birth_year + 3）
    if ((horse.role === 'stallion' || horse.role === 'broodmare') && horse.stud_year_start) {
      if (horse.stud_year_start < horse.birth_year + 3) {
        issues.push(`最早3岁开始配种/繁殖：配种开始年(${horse.stud_year_start})应 ≥ 出生年(${horse.birth_year}) + 3`);
      }
    }

    // 规则7：严谨模式下种牡马/繁殖牝马必须填 stud_year_start
    if (mode === 'strict' && (horse.role === 'stallion' || horse.role === 'broodmare') && !horse.stud_year_start) {
      issues.push('严谨模式下种牡马/繁殖牝马必须填写配种开始年份');
    }

    // 规则6：后代晚于父母（需要查父母数据）
    if (horse.sire_id) {
      const sire = await this._findHorse(horse.sire_id);
      if (sire) {
        if (sire.birth_year && horse.birth_year < sire.birth_year + 3) {
          issues.push(`后代出生年(${horse.birth_year})应 ≥ 父亲出生年(${sire.birth_year}) + 3`);
        }
        // 规则2：种马配种范围（unverified 只提醒不拦截）
        if (sire.stud_year_start && horse.birth_year < sire.stud_year_start + 1) {
          const msg = `后代出生年(${horse.birth_year})应 ≥ 父亲配种开始年(${sire.stud_year_start}) + 1`;
          if (sire.stud_year_source === 'unverified') {
            freeWarnings.push(`父亲${sire.name_en}的配种年份未验证，建议自行搜寻资料确认。`);
          } else {
            issues.push(msg);
          }
        }
        // 规则5：种马引退后（unverified 只提醒不拦截）
        if (sire.stud_year_end && horse.birth_year > sire.stud_year_end + 1) {
          const msg = `父亲${sire.name_en}已于${sire.stud_year_end}年停止配种，后代出生年(${horse.birth_year})超出范围`;
          if (sire.stud_year_source === 'unverified') {
            freeWarnings.push(`父亲${sire.name_en}的配种年份未验证，建议自行搜寻资料确认。`);
          } else if (mode === 'free') {
            freeWarnings.push(msg);
          } else {
            issues.push(msg);
          }
        }
      }
    }

    if (horse.dam_id) {
      const dam = await this._findHorse(horse.dam_id);
      if (dam && dam.birth_year) {
        // 规则1：牝马产驹年龄
        if (horse.birth_year < dam.birth_year + 4) {
          issues.push(`后代出生年(${horse.birth_year})应 ≥ 母亲出生年(${dam.birth_year}) + 4`);
        }
        // 规则4：母马产驹间隔（检查同母的其他后代）
        // birth_year 为整数，< 1 等同于 === 0（同年出生）
        const siblings = await this._findSiblings(horse.dam_id, horse.id);
        for (const sib of siblings) {
          if (sib.birth_year && Math.abs(horse.birth_year - sib.birth_year) < 1) {
            issues.push(`同母马${dam.name_en}在${sib.birth_year}年已有产驹(${sib.name_en})，需间隔至少1年`);
            break;
          }
        }
      }
    }

    if (mode === 'strict') {
      return { warnings: freeWarnings, errors: issues };
    } else {
      return { warnings: freeWarnings, errors: [] };
    }
  },

  async _findHorse(id) {
    const userHorse = await Storage.getHorse(id);
    if (userHorse) return userHorse;
    return DataLoader.getHorseFromIndex(id);
  },

  async _findSiblings(damId, excludeId) {
    const all = await Storage.getAllHorses();
    return all.filter(h => h.dam_id === damId && h.id !== excludeId);
  },

  /**
   * Cross 浓度警告：如果有 3×3 或更近的 Cross，弹出警告
   */
  checkCrossIntensity(crossResult) {
    if (!crossResult || crossResult.total_crosses === 0) return [];
    const warnings = [];
    for (const c of crossResult.crosses) {
      const minS = Math.min(...c.positions.sire_side);
      const minM = Math.min(...c.positions.dam_side);
      if (minS + minM <= 6) {
        warnings.push(`⚠️ 高浓度 Cross: ${c.notation}（血量 ${c.blood_percentage}%）`);
      }
    }
    return warnings;
  }
};
