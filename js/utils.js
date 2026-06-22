/* utils.js — 通用工具函数 */
'use strict';

const Utils = {
  /** 生成 UUID（用于架空马 ID） */
  generateId() {
    return 'usr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  },

  /** 生成分组 ID */
  generateGroupId() {
    return 'grp_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  },

  /** 格式化日期为 ISO 字符串 */
  formatDate(date = new Date()) {
    return date.toISOString();
  },

  /** 格式化日期为显示用 YYYYMMDD */
  formatDateShort(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  },

  /** 展示用的马名：优先 name_en > name_ja > name_cn + *(架空马) + (country) */
  displayName(horse) {
    if (!horse) return '未指定';
    const pref = this._namePref();
    const name = horse[pref[0]] || horse[pref[1]] || horse[pref[2]] || '???';
    const country = horse.country ? `(${horse.country})` : '';
    const fictional = horse.type === 'fictional' ? '*' : '';
    return `${name}${fictional}${country}`;
  },

  /** 通用实体名字获取 */
  entityName(entity) {
    if (!entity) return '—';
    const pref = this._namePref();
    return entity[pref[0]] || entity[pref[1]] || entity[pref[2]] || entity.name || entity.code || entity.id || '—';
  },

  _namePref() {
    const lang = localStorage.getItem('uma_name_lang') || 'en';
    if (lang === 'ja') return ['name_ja', 'name_en', 'name_cn'];
    if (lang === 'cn') return ['name_cn', 'name_ja', 'name_en'];
    return ['name_en', 'name_ja', 'name_cn'];
  },

  /** 角色中文映射 */
  roleLabel(role) {
    const map = { active: I18N.t('active'), stallion: I18N.t('stallion'), broodmare: I18N.t('broodmare'), retired: I18N.t('retired') };
    return map[role] || role;
  },

  /** 性别中文映射 */
  sexLabel(sex) {
    const map = { male: I18N.t('male'), female: I18N.t('female'), gelding: I18N.t('gelding') };
    return map[sex] || sex;
  },

  /** 场地中文映射 */
  surfaceLabel(s) {
    const map = { turf: I18N.t('turf'), dirt: I18N.t('dirt') };
    return map[s] || s;
  },

  /** 毛色映射 */
  colorLabel(c) {
    const map = { bay:'bay', darkBay:'darkBay', brown:'brown', chestnut:'chestnut', darkChestnut:'darkChestnut', grey:'grey', black:'black', white:'white' };
    return map[c] ? I18N.t(map[c]) : c;
  },

  /** 距离适性中文映射 */
  distanceLabel(d) {
    const map = {
      sprint: '短途(~1400m)',
      mile: '一哩(1400-1800m)',
      intermediate: '中距离(1800-2200m)',
      long: '长途(2200m+)'
    };
    return map[d] || d;
  },

  /** 深拷贝 */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
};
