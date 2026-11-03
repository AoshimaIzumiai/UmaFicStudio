/**
 * test-r5-helpers.js — R5 纯逻辑单测
 *
 * 双环境：
 *  - Node: `node tests/test-r5-helpers.js`（自带轻量 runner，进程退出码反映结果）
 *  - 浏览器: 通过 tests/index.html 的 TestRunner 注册（存在 TestRunner 时走浏览器分支）
 */
'use strict';

(function () {
  const isNode = typeof module !== 'undefined' && module.exports;
  const R5 = isNode ? require('../js/r5-helpers.js') : window.R5Helpers;

  // 统一断言
  const A = {
    equal(actual, expected, msg) {
      if (actual !== expected) throw new Error(`${msg || 'equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); },
    deepEqual(a, b, msg) {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'deepEqual'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    },
  };

  const cases = [];
  const test = (name, fn) => cases.push({ name, fn });

  // === remainingMs / formatRemaining ===
  test('remainingMs: 未过期返回正数', () => {
    const now = 1_000_000_000_000;
    A.equal(R5.remainingMs(now + 3600_000, now), 3600_000);
  });
  test('remainingMs: 已过期返回 0', () => {
    const now = 1_000_000_000_000;
    A.equal(R5.remainingMs(now - 1, now), 0);
  });
  test('remainingMs: 毫秒时间戳直接使用', () => {
    const now = 1_700_000_000_000;
    A.equal(R5.remainingMs(now + 60_000, now), 60_000);
  });
  test('remainingMs: 非法输入返回 0', () => {
    A.equal(R5.remainingMs('not-a-date', 0), 0);
    A.equal(R5.remainingMs(undefined, 0), 0);
  });
  test('remainingMs: 无时区 ISO 按 UTC 解析（服务端口径）', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    // 服务端 datetime.utcnow().isoformat() 无 Z 后缀
    A.equal(R5.remainingMs('2026-01-02T00:00:00', now), 86400_000);
  });
  test('remainingMs: 带 Z 的 ISO 字符串可解析', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    A.equal(R5.remainingMs('2026-01-02T00:00:00Z', now), 86400_000);
  });

  test('formatRemaining: 天+小时', () => {
    A.equal(R5.formatRemaining((2 * 24 + 3) * 3600_000, 'zh'), '剩 2 天 3 小时');
    A.equal(R5.formatRemaining((2 * 24 + 3) * 3600_000, 'en'), '2d 3h left');
  });
  test('formatRemaining: 仅小时', () => {
    A.equal(R5.formatRemaining(5 * 3600_000, 'zh'), '剩 5 小时');
  });
  test('formatRemaining: 不足一小时', () => {
    A.equal(R5.formatRemaining(30 * 60_000, 'zh'), '不足 1 小时');
    A.equal(R5.formatRemaining(30 * 60_000, 'en'), '< 1h left');
  });
  test('formatRemaining: 已过期', () => {
    A.equal(R5.formatRemaining(0, 'zh'), '已过期');
    A.equal(R5.formatRemaining(-5, 'en'), 'Expired');
  });

  // === usagePercent / formatBytes ===
  test('usagePercent: 正常计算', () => {
    A.equal(R5.usagePercent(50, 100), 50);
    A.equal(R5.usagePercent(1, 3), 33.3);
  });
  test('usagePercent: 上限封顶 100', () => {
    A.equal(R5.usagePercent(200, 100), 100);
  });
  test('usagePercent: quota=0 返回 0（不崩）', () => {
    A.equal(R5.usagePercent(10, 0), 0);
    A.equal(R5.usagePercent(10, undefined), 0);
  });
  test('formatBytes: 分级', () => {
    A.equal(R5.formatBytes(512), '512 B');
    A.equal(R5.formatBytes(1536), '1.5 KB');
    A.equal(R5.formatBytes(5 * 1024 * 1024), '5.0 MB');
  });

  // === parseSyncDetail ===
  test('parseSyncDetail: 汇总失败项与错误码', () => {
    const d = R5.parseSyncDetail({
      status: 'error',
      lastSyncedAt: 123456,
      outboxCount: 3,
      lastError: { code: 'CONFLICT', request_id: 'req-1', failed_operations: [{ module: 'horses', record_id: 'h1' }] },
    });
    A.equal(d.status, 'error');
    A.equal(d.lastSyncedAt, 123456);
    A.equal(d.outboxCount, 3);
    A.equal(d.errorCode, 'CONFLICT');
    A.equal(d.requestId, 'req-1');
    A.equal(d.failedOperations.length, 1);
    A.equal(d.hasError, true);
  });
  test('parseSyncDetail: 无错误时 hasError=false，lastSyncedAt 归一', () => {
    const d = R5.parseSyncDetail({ status: 'synced', lastSyncedAt: 0, outboxCount: 0, lastError: null });
    A.equal(d.hasError, false);
    A.equal(d.lastSyncedAt, null);
    A.equal(d.failedOperations.length, 0);
  });
  test('parseSyncDetail: 缺省参数不崩', () => {
    const d = R5.parseSyncDetail();
    A.equal(d.status, 'idle');
    A.equal(d.outboxCount, 0);
  });

  // === 条数校验 ===
  test('verifyExportCount: 口径一致 ok=true', () => {
    const status = { horses: { count: 2 }, races: { count: 1 } };
    const exp = { horses: [{}, {}], races: [{}] };
    A.deepEqual(R5.verifyExportCount(status, exp), { ok: true, expected: 3, actual: 3 });
  });
  test('verifyExportCount: 不一致 ok=false', () => {
    const status = { horses: { count: 5 } };
    const exp = { horses: [{}, {}] };
    A.deepEqual(R5.verifyExportCount(status, exp), { ok: false, expected: 5, actual: 2 });
  });
  test('verifyExportCount: 空输入安全', () => {
    A.deepEqual(R5.verifyExportCount(null, null), { ok: true, expected: 0, actual: 0 });
  });

  // === 云端格式 → 本地格式 ===
  test('cloudExportToLocal: {id,data} 展开为扁平对象带 id', () => {
    const cloud = {
      version: '1.0',
      exported_at: '2026-08-30T00:00:00Z',
      modules: {
        horses: [{ id: 'h1', data: { name_en: 'Alpha', sex: 'male' } }],
        races: [{ id: 'r1', data: { year: 2026 } }],
        unknown_mod: [{ id: 'x', data: {} }],
      },
    };
    const local = R5.cloudExportToLocal(cloud);
    A.equal(local.export_version, '1.3');
    A.equal(local.exported_at, '2026-08-30T00:00:00Z');
    A.equal(local.source, 'cloud');
    A.equal(local.horses.length, 1);
    A.equal(local.horses[0].id, 'h1');
    A.equal(local.horses[0].name_en, 'Alpha');
    A.equal(local.races[0].id, 'r1');
    A.equal(local.races[0].year, 2026);
    // 未知模块被丢弃
    A.equal(local.unknown_mod, undefined);
    // 所有本地字段都存在（哪怕空数组）
    A.ok(Array.isArray(local.dam_groups));
    A.ok(Array.isArray(local.jockeys));
  });
  test('cloudExportToLocal: 空/缺 modules 生成全空数组结构', () => {
    const local = R5.cloudExportToLocal({ version: '1.0' });
    for (const f of R5.LOCAL_ARRAY_FIELDS) {
      A.ok(Array.isArray(local[f]) && local[f].length === 0, `field ${f} should be empty array`);
    }
  });
  test('cloudExportToLocal: 转换结果可通过本地导入字段前置校验（有 id + name）', () => {
    const cloud = { modules: { horses: [{ id: 'h9', data: { name_en: 'Bravo' } }] } };
    const local = R5.cloudExportToLocal(cloud);
    const h = local.horses[0];
    A.ok(typeof h.id === 'string' && (h.name_en || h.name_ja || h.name_cn));
  });

  // 运行
  if (typeof TestRunner !== 'undefined') {
    TestRunner.suite('R5 Helpers — 纯逻辑', (t) => {
      for (const c of cases) t.test(c.name, c.fn);
    });
  } else if (isNode) {
    let pass = 0, fail = 0;
    for (const c of cases) {
      try { c.fn(); pass++; console.log(`  ✓ ${c.name}`); }
      catch (e) { fail++; console.error(`  ✗ ${c.name}\n      ${e.message}`); }
    }
    console.log(`\nR5 Helpers: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
  }
})();
