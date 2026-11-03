/* 真实 IndexedDB v4 fixture → Storage v5 升级验证 */
'use strict';

TestRunner.suite('Storage v4→v5 真实旧库 fixture', (t) => {
  t.test('升级后创建同步 stores 并完成可恢复记录迁移', async () => {
    await Storage.init();
    TestRunner.assert.equal(Storage.db.version, 5);
    TestRunner.assert.ok(Storage.db.objectStoreNames.contains('sync_outbox'));
    TestRunner.assert.ok(Storage.db.objectStoreNames.contains('sync_meta'));
    const state = await Storage.get('sync_meta', Storage._v5MigrationKey);
    TestRunner.assert.equal(state.value.status, 'done');
    TestRunner.assert.equal(state.value.store_index, Storage._SYNCABLE_STORES.size);
  });

  t.test('九模块旧用户记录均补数值 updated_at', async () => {
    for (const [module, id] of Object.entries(window.__V4_FIXTURE_IDS__)) {
      const record = await Storage.get(module, id);
      TestRunner.assert.ok(record, `${module} fixture 应存在`);
      TestRunner.assert.ok(Number.isFinite(record.updated_at), `${module} updated_at 应为数值`);
    }
  });

  t.test('无 source 的真实 preset 和 Press 均保持未迁移', async () => {
    const preset = await Storage.get('races', 'race_2927e593ea87');
    const press = await Storage.get('press_articles', '_v4_press');
    TestRunner.assert.ok(preset);
    TestRunner.assert.equal(preset.updated_at, undefined);
    TestRunner.assert.equal(press.updated_at, undefined);
  });
});
