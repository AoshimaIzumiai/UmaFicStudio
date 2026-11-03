/**
 * test-r5-i18n.js — R5 i18n 键完整性
 *
 * 校验：所有 R5 新增键在 zh / en 两套都存在且非空，且两套键集合一致。
 * 双环境：Node（自带 runner）/ 浏览器（TestRunner）。
 */
'use strict';

(function () {
  const isNode = typeof module !== 'undefined' && module.exports;

  let I18N_REF;
  if (isNode) {
    // 在 Node 下最小 shim：i18n.js 顶层读取 localStorage
    if (typeof globalThis.localStorage === 'undefined') {
      const _store = {};
      globalThis.localStorage = {
        getItem: (k) => (k in _store ? _store[k] : null),
        setItem: (k, v) => { _store[k] = String(v); },
        removeItem: (k) => { delete _store[k]; },
      };
    }
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../js/i18n.js'), 'utf8');
    // i18n.js 用 `const I18N = {...}`，用 Function 包一层取出
    const factory = new Function('localStorage', src + '\nreturn I18N;');
    I18N_REF = factory(globalThis.localStorage);
  } else {
    I18N_REF = typeof I18N !== 'undefined' ? I18N : window.I18N;
  }

  const A = {
    ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); },
    equal(a, b, msg) { if (a !== b) throw new Error(`${msg || 'equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
  };

  // R5 新增键清单（实现与测试同源，防止漏翻）
  const R5_KEYS = [
    // 账号设置
    'settings_title', 'account_info', 'reg_time', 'change_password_title',
    'old_password', 'new_password', 'change_password_btn', 'password_changed',
    'logout_btn', 'delete_account_title', 'delete_account_warning',
    'delete_account_confirm_label', 'delete_account_btn', 'delete_account_local_kept',
    'confirm_delete_account', 'username_mismatch',
    // 同步状态详情
    'sync_detail_title', 'last_synced', 'never_synced', 'outbox_pending',
    'failed_items', 'cloud_usage', 'no_failed_items', 'request_id_label',
    // 回收站
    'trash_title', 'trash_empty', 'trash_module', 'trash_all_modules',
    'restore_btn', 'confirm_restore', 'restore_success', 'restore_conflict',
    'restore_not_found', 'restore_quota', 'load_more', 'remaining_time',
    'restore_impact_note', 'deleted_at',
    // 云端导出
    'cloud_export_title', 'cloud_export_btn', 'exporting', 'export_progress',
    'export_count_ok', 'export_count_mismatch', 'export_reimport_note',
    'export_done', 'export_failed',
    // Press 本地提示
    'press_local_only',
    // 通用/离线
    'offline_hint', 'not_logged_in_hint', 'close', 'processing', 'loading',
  ];

  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  test('zh 中所有 R5 键存在且非空', () => {
    for (const k of R5_KEYS) {
      A.ok(typeof I18N_REF.zh[k] === 'string' && I18N_REF.zh[k].length > 0, `zh 缺键: ${k}`);
    }
  });
  test('en 中所有 R5 键存在且非空', () => {
    for (const k of R5_KEYS) {
      A.ok(typeof I18N_REF.en[k] === 'string' && I18N_REF.en[k].length > 0, `en 缺键: ${k}`);
    }
  });
  test('zh / en 键集合完全一致（无单侧遗漏）', () => {
    const zhKeys = new Set(Object.keys(I18N_REF.zh));
    const enKeys = new Set(Object.keys(I18N_REF.en));
    const missingInEn = [...zhKeys].filter(k => !enKeys.has(k));
    const missingInZh = [...enKeys].filter(k => !zhKeys.has(k));
    A.equal(missingInEn.length, 0, `en 缺少: ${missingInEn.join(', ')}`);
    A.equal(missingInZh.length, 0, `zh 缺少: ${missingInZh.join(', ')}`);
  });
  test('t() 回退逻辑：缺失键返回 fallback', () => {
    A.equal(I18N_REF.t('__nonexistent__', 'fb'), 'fb');
  });

  if (typeof TestRunner !== 'undefined') {
    TestRunner.suite('R5 i18n — 键完整性', (t) => {
      for (const c of cases) t.test(c.name, c.fn);
    });
  } else if (isNode) {
    let pass = 0, fail = 0;
    for (const c of cases) {
      try { c.fn(); pass++; console.log(`  ✓ ${c.name}`); }
      catch (e) { fail++; console.error(`  ✗ ${c.name}\n      ${e.message}`); }
    }
    console.log(`\nR5 i18n: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  }
})();
