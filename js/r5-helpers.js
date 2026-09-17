/**
 * r5-helpers.js — R5 纯逻辑工具（无 DOM 依赖，可在 Node 下单测）
 *
 * 提供：
 *  - 回收站剩余恢复时间计算与格式化
 *  - 云端导出条数校验（status 口径 vs 导出文件口径）
 *  - 云端导出格式（version 1.0 modules{}）→ 本地导入格式（export_version 1.3）转换
 *  - 同步状态详情解析（last_error / outbox / 用量）
 *  - 云端用量百分比与人类可读体积
 */
'use strict';

const R5Helpers = {
  // === 回收站剩余恢复时间 ===

  /**
   * 计算剩余恢复毫秒数。
   * @param {number|string} expiresAt - 过期时间：数字视为毫秒时间戳；字符串视为 ISO 8601。
   *   服务端 expires_at 来自 datetime.utcnow().isoformat()（无时区后缀的 UTC），
   *   这里对无时区标记的 ISO 字符串补 'Z' 按 UTC 解析，避免被 JS 当本地时间。
   * @param {number} [nowMs] - 当前时间（默认 Date.now()）
   * @returns {number} 剩余毫秒，最小为 0（已过期）
   */
  remainingMs(expiresAt, nowMs = Date.now()) {
    let expires;
    if (typeof expiresAt === 'number') {
      expires = expiresAt;
    } else if (typeof expiresAt === 'string') {
      // 无时区标记（无 Z、无 ±HH:MM）的 ISO 视为 UTC
      const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(expiresAt);
      expires = Date.parse(hasTz ? expiresAt : expiresAt + 'Z');
    } else {
      return 0;
    }
    if (!Number.isFinite(expires)) return 0;
    const diff = expires - nowMs;
    return diff > 0 ? diff : 0;
  },

  /**
   * 把剩余毫秒格式化为「N天M小时 / M小时 / 不足1小时 / 已过期」。
   * @param {number} ms
   * @param {'zh'|'en'} [lang]
   * @returns {string}
   */
  formatRemaining(ms, lang = 'zh') {
    const isZh = lang !== 'en';
    if (!Number.isFinite(ms) || ms <= 0) return isZh ? '已过期' : 'Expired';
    const totalMinutes = Math.floor(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    if (days > 0) {
      return isZh ? `剩 ${days} 天 ${hours} 小时` : `${days}d ${hours}h left`;
    }
    if (hours > 0) {
      return isZh ? `剩 ${hours} 小时` : `${hours}h left`;
    }
    return isZh ? '不足 1 小时' : '< 1h left';
  },

  // === 云端用量 ===

  /**
   * 计算用量百分比（0~100，保留 1 位小数）。quota 为 0 或缺失时返回 0。
   */
  usagePercent(usedBytes, quotaBytes) {
    const used = Number(usedBytes) || 0;
    const quota = Number(quotaBytes) || 0;
    if (quota <= 0) return 0;
    const pct = (used / quota) * 100;
    return Math.min(100, Math.round(pct * 10) / 10);
  },

  /** 人类可读体积。 */
  formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  },

  // === 同步状态详情解析 ===

  /**
   * 汇总同步状态详情，供 UI 渲染。
   * @param {object} opts
   * @param {string} opts.status - Sync.STATUS 值
   * @param {number|null} opts.lastSyncedAt - 持久化最后成功时间（毫秒）
   * @param {number} opts.outboxCount - 待发送 outbox 数
   * @param {object|null} opts.lastError - Storage.getSyncError 返回值
   * @returns {{status, lastSyncedAt, outboxCount, failedOperations:Array, errorCode:string|null, requestId:string|null, hasError:boolean}}
   */
  parseSyncDetail({ status, lastSyncedAt = null, outboxCount = 0, lastError = null } = {}) {
    const failedOperations = Array.isArray(lastError?.failed_operations)
      ? lastError.failed_operations
      : [];
    const hasError = !!lastError && (status === 'error' || status === 'partial' || failedOperations.length > 0);
    return {
      status: status || 'idle',
      lastSyncedAt: Number.isFinite(Number(lastSyncedAt)) && Number(lastSyncedAt) > 0
        ? Number(lastSyncedAt) : null,
      outboxCount: Math.max(0, Number(outboxCount) || 0),
      failedOperations,
      errorCode: lastError?.code || null,
      requestId: lastError?.request_id || null,
      hasError,
    };
  },

  // === 导出条数校验 ===

  /**
   * 统计 status.modules[*].count 之和（服务端认定的可导出条数）。
   */
  sumStatusCount(statusModules) {
    if (!statusModules || typeof statusModules !== 'object') return 0;
    let total = 0;
    for (const key of Object.keys(statusModules)) {
      const mod = statusModules[key];
      const c = Number(mod?.count);
      if (Number.isFinite(c) && c >= 0) total += c;
    }
    return total;
  },

  /**
   * 统计导出文件 modules[*].length 之和（实际导出条数）。
   */
  sumExportCount(exportModules) {
    if (!exportModules || typeof exportModules !== 'object') return 0;
    let total = 0;
    for (const key of Object.keys(exportModules)) {
      const arr = exportModules[key];
      if (Array.isArray(arr)) total += arr.length;
    }
    return total;
  },

  /**
   * 校验导出条数是否与 status 口径一致。
   * @returns {{ok:boolean, expected:number, actual:number}}
   */
  verifyExportCount(statusModules, exportModules) {
    const expected = this.sumStatusCount(statusModules);
    const actual = this.sumExportCount(exportModules);
    return { ok: expected === actual, expected, actual };
  },

  // === 云端导出格式 → 本地导入格式 ===

  /** 本地导入器支持的模块清单（与 export-import.js arrayFields 对齐）。 */
  LOCAL_ARRAY_FIELDS: ['horses', 'dam_groups', 'farms', 'trainers', 'owners', 'countries', 'jockeys', 'races', 'results'],

  /**
   * 把云端导出（{version:'1.0', exported_at, modules:{mod:[{id,data}]}}）
   * 转换为本地导入器可吃的格式（{export_version:'1.3', horses:[...], ...}）。
   *
   * 云端每条为 {id, data}，本地记录期望是扁平对象且带 id，因此把 data 展开并补 id。
   * 未知模块被丢弃（本地导入器不认识）。
   *
   * @param {object} cloudExport
   * @param {string} [exportVersion] - 生成的本地 export_version
   * @returns {object} 本地格式对象
   */
  cloudExportToLocal(cloudExport, exportVersion = '1.3') {
    const modules = cloudExport?.modules && typeof cloudExport.modules === 'object'
      ? cloudExport.modules : {};
    const out = {
      export_version: exportVersion,
      exported_at: cloudExport?.exported_at || new Date().toISOString(),
      source: 'cloud',
      config: {},
    };
    for (const field of this.LOCAL_ARRAY_FIELDS) {
      const items = Array.isArray(modules[field]) ? modules[field] : [];
      out[field] = items.map(entry => {
        if (!entry || typeof entry !== 'object') return null;
        // 云端为 {id, data}；本地要扁平对象带 id
        if (entry.data && typeof entry.data === 'object') {
          return { ...entry.data, id: entry.id != null ? String(entry.id) : entry.data.id };
        }
        // 已经是扁平对象（兜底兼容）
        return entry.id != null ? { ...entry } : null;
      }).filter(Boolean);
    }
    return out;
  },
};

// 双环境导出：浏览器挂到 window，Node 用 module.exports
if (typeof module !== 'undefined' && module.exports) {
  module.exports = R5Helpers;
}
if (typeof window !== 'undefined') {
  window.R5Helpers = R5Helpers;
}
