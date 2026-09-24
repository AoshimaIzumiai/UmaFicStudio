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

  /** 解析赛事日程，供战绩排序和马体重增减计算复用 */
  parseRaceSchedule(schedule) {
    const match = String(schedule || '').match(/(\d+)月第(\d+)周第(\d+)/);
    return match ? [+match[1], +match[2], +match[3]] : [99, 99, 99];
  },

  /** 按年份、月份、周和比赛日升序比较赛事 */
  compareRaceChronology(a, b) {
    if ((a?.year || 0) !== (b?.year || 0)) return (a?.year || 0) - (b?.year || 0);
    const [am, aw, ad] = this.parseRaceSchedule(a?.schedule);
    const [bm, bw, bd] = this.parseRaceSchedule(b?.schedule);
    return am - bm || aw - bw || ad - bd;
  },

  /** 为已按时间升序排列的单马战绩附加动态马体重与增减值 */
  annotateBodyWeightChanges(records) {
    let previous = null;
    for (const record of records || []) {
      const raw = record?._entry?.body_weight;
      const value = raw === '' || raw == null ? null : Number(raw);
      if (!Number.isFinite(value)) {
        record._body_weight = null;
        record._body_weight_change = null;
        continue;
      }
      record._body_weight = value;
      record._body_weight_change = previous == null ? 0 : value - previous;
      previous = value;
    }
    return records;
  },

  /** 体重显示示例：480(0)、490(+10)、488(-2) */
  formatBodyWeight(value, change) {
    const numeric = value === '' || value == null ? null : Number(value);
    if (!Number.isFinite(numeric)) return '';
    const delta = Number(change);
    const changeText = !Number.isFinite(delta) || delta === 0 ? '0' : delta > 0 ? `+${delta}` : String(delta);
    return `${numeric}(${changeText})`;
  },

  /** 深拷贝 */
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  /** HTML 实体转义 — 防 XSS，用于 innerHTML 中的用户数据 */
  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** 安全版 displayName — 输出已 HTML 转义，可直接用于 innerHTML */
  safeDisplayName(horse) {
    return this.escapeHtml(this.displayName(horse));
  },

  /** 安全版 entityName — 输出已 HTML 转义 */
  safeEntityName(entity) {
    return this.escapeHtml(this.entityName(entity));
  }
};
