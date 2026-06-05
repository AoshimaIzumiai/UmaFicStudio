/* year-validator.js — 年份算法约束（仅严谨现实模式下生效） */
'use strict';

const YearValidator = {
  /**
   * 获取当前模式：'strict' 或 'free'
   */
  async getMode() {
    const config = await Storage.get('config', 'mode');
    return config ? config.value : 'free'; // 默认架空模式
  },

  async setMode(mode) {
    await Storage.put('config', { key: 'mode', value: mode });
  },

  /**
   * 校验一匹马的年份约束
   * @returns {warnings: string[], errors: string[]}
   * warnings: 架空模式下弹窗提示的内容
   * errors: 严谨模式下阻止保存的内容
   */
  async validate(horse) {
    const mode = await this.getMode();
    const issues = [];

    // 出生年为空时跳过所有校验
    if (!horse.birth_year) return { warnings: [], errors: [] };

    // 规则3：种马最早配种年龄（stud_year_start ≥ birth_year + 3）
    if (horse.role === 'stallion' && horse.stud_year_start) {
      if (horse.stud_year_start < horse.birth_year + 3) {
        issues.push(`种马最早3岁配种：配种开始年(${horse.stud_year_start})应 ≥ 出生年(${horse.birth_year}) + 3`);
      }
    }

    // 规则10：严谨模式下种牡马必须填 stud_year_start
    if (mode === 'strict' && horse.role === 'stallion' && !horse.stud_year_start) {
      issues.push('严谨模式下种牡马必须填写配种开始年份');
    }

    // 规则6：后代晚于父母（需要查父母数据）
    if (horse.sire_id) {
      const sire = await this._findHorse(horse.sire_id);
      if (sire && sire.birth_year) {
        if (horse.birth_year < sire.birth_year + 3) {
          issues.push(`后代出生年(${horse.birth_year})应 ≥ 父亲出生年(${sire.birth_year}) + 3`);
        }
        // 规则2：种马配种范围
        if (sire.stud_year_start && horse.birth_year < sire.stud_year_start + 1) {
          issues.push(`后代出生年(${horse.birth_year})应 ≥ 父亲配种开始年(${sire.stud_year_start}) + 1`);
        }
        // 规则5：种马引退后
        if (sire.stud_year_end && horse.birth_year > sire.stud_year_end + 1) {
          const msg = `父亲${sire.name_en}已于${sire.stud_year_end}年停止配种，后代出生年(${horse.birth_year})超出范围`;
          if (mode === 'free') {
            // 架空模式：只作为 warning 弹窗提示
            return { warnings: [msg], errors: [] };
          }
          issues.push(msg);
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
      return { warnings: [], errors: issues };
    } else {
      // 架空模式下只有种马引退后的才作为 warning，其余忽略
      return { warnings: [], errors: [] };
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
  }
};
