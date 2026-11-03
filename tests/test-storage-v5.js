/**
 * Storage v5 单元测试
 * 测试同步基础设施：outbox、remote apply、generation、过滤
 */
'use strict';

// 等待 Storage 初始化完成后运行测试
const _waitStorageReady = () => new Promise(resolve => {
  const check = () => {
    if (Storage.db || Storage.useLocalStorage) resolve();
    else setTimeout(check, 50);
  };
  check();
});

TestRunner.suite('Storage v5 — 基础', (t) => {
  t.test('DB_VERSION 应为 5', async () => {
    TestRunner.assert.equal(Storage.DB_VERSION, 5);
  });

  t.test('_SYNCABLE_STORES 应包含 9 个模块', async () => {
    TestRunner.assert.equal(Storage._SYNCABLE_STORES.size, 9);
    TestRunner.assert.ok(Storage._SYNCABLE_STORES.has('horses'));
    TestRunner.assert.ok(Storage._SYNCABLE_STORES.has('races'));
    TestRunner.assert.ok(!Storage._SYNCABLE_STORES.has('press_articles'));
    TestRunner.assert.ok(!Storage._SYNCABLE_STORES.has('config'));
  });

  t.test('_SYNC_STORES 应包含 outbox 和 meta', async () => {
    TestRunner.assert.equal(Storage._SYNC_STORES.length, 2);
    TestRunner.assert.ok(Storage._SYNC_STORES.includes('sync_outbox'));
    TestRunner.assert.ok(Storage._SYNC_STORES.includes('sync_meta'));
  });

  t.test('IndexedDB 应包含 sync_outbox 和 sync_meta store', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return; // 跳过降级模式
    TestRunner.assert.ok(Storage.db.objectStoreNames.contains('sync_outbox'), 'sync_outbox store 存在');
    TestRunner.assert.ok(Storage.db.objectStoreNames.contains('sync_meta'), 'sync_meta store 存在');
  });
});

TestRunner.suite('Storage v5 — 模块过滤', (t) => {
  t.test('horses 记录应可同步', async () => {
    await Storage.init();
    const result = Storage.isSyncableRecord('horses', { id: 'h_001', name_en: 'Test' });
    TestRunner.assert.ok(result);
  });

  t.test('press_articles 不可同步', async () => {
    const result = Storage.isSyncableRecord('press_articles', { id: 'art_1' });
    TestRunner.assert.ok(!result);
  });

  t.test('config 不可同步', async () => {
    const result = Storage.isSyncableRecord('config', { key: 'some_flag' });
    TestRunner.assert.ok(!result);
  });

  t.test('source=preset 的记录不可同步', async () => {
    const result = Storage.isSyncableRecord('races', { id: 'race_001', source: 'preset' });
    TestRunner.assert.ok(!result);
  });

  t.test('source=user 的记录可同步', async () => {
    const result = Storage.isSyncableRecord('races', { id: 'my_race_001', source: 'user' });
    TestRunner.assert.ok(result);
  });
});

TestRunner.suite('Storage v5 — Remote Apply', (t) => {
  const TEST_MODULE = 'horses';
  const TEST_ID = '_test_remote_' + Date.now();

  t.test('applyRemoteUpsert 应写入记录', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;

    await Storage.applyRemoteUpsert(TEST_MODULE, TEST_ID, { name_en: 'RemoteHorse' }, 42);
    const record = await Storage.get(TEST_MODULE, TEST_ID);
    TestRunner.assert.ok(record, '记录应存在');
    TestRunner.assert.equal(record.name_en, 'RemoteHorse');
    TestRunner.assert.equal(record._server_revision, 42);
  });

  t.test('applyRemoteDelete 应删除记录', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;

    await Storage.applyRemoteDelete(TEST_MODULE, TEST_ID);
    const record = await Storage.get(TEST_MODULE, TEST_ID);
    TestRunner.assert.ok(!record, '记录应已被删除');
  });
});

TestRunner.suite('Storage v5 — Outbox', (t) => {
  const TEST_USER = 'test_user_001';
  const TEST_OP = 'op_' + Date.now();

  t.test('writeOutbox 应写入 outbox 项', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;

    await Storage.writeOutbox(TEST_USER, 'horses', 'h_001', 'upsert', { name_en: 'New' }, TEST_OP, null);
    const count = await Storage.getOutboxCount(TEST_USER);
    TestRunner.assert.ok(count >= 1, `outbox count should be >= 1, got ${count}`);
  });

  t.test('getOutboxBatch 应返回刚写入的项', async () => {
    if (Storage.useLocalStorage) return;

    const batch = await Storage.getOutboxBatch(TEST_USER, 10);
    const found = batch.find(item => item.op_id === TEST_OP);
    TestRunner.assert.ok(found, 'batch 中应包含测试项');
    TestRunner.assert.equal(found.module, 'horses');
    TestRunner.assert.equal(found.record_id, 'h_001');
    TestRunner.assert.equal(found.action, 'upsert');
  });

  t.test('writeOutbox 应递增 generation', async () => {
    if (Storage.useLocalStorage) return;

    const genBefore = await Storage.getWorkspaceGeneration(TEST_USER);
    const newOp = 'op_gen_' + Date.now();
    await Storage.writeOutbox(TEST_USER, 'horses', 'h_002', 'upsert', {}, newOp, null);
    const genAfter = await Storage.getWorkspaceGeneration(TEST_USER);
    TestRunner.assert.ok(genAfter > genBefore, `generation should increase: ${genBefore} → ${genAfter}`);
  });

  t.test('removeFromOutbox 应移除指定项', async () => {
    if (Storage.useLocalStorage) return;

    await Storage.removeFromOutbox(TEST_USER, TEST_OP);
    const batch = await Storage.getOutboxBatch(TEST_USER, 100);
    const found = batch.find(item => item.op_id === TEST_OP);
    TestRunner.assert.ok(!found, 'op_id 应已被移除');
  });

  t.test('getOutboxBatch 应按 sequence 返回单一模块', async () => {
    if (Storage.useLocalStorage) return;
    const user = `batch_user_${Date.now()}`;
    const ops = [`race_a_${Date.now()}`, `horse_${Date.now()}`, `race_b_${Date.now()}`];
    await Storage.writeOutbox(user, 'races', 'race_a', 'upsert', {}, ops[0], null);
    await Storage.writeOutbox(user, 'horses', 'horse_a', 'upsert', {}, ops[1], null);
    await Storage.writeOutbox(user, 'races', 'race_b', 'upsert', {}, ops[2], null);

    const batch = await Storage.getOutboxBatch(user, 100);
    TestRunner.assert.equal(batch.length, 2);
    TestRunner.assert.ok(batch.every(item => item.module === 'races'));
    TestRunner.assert.ok(batch[0].sequence < batch[1].sequence);
    TestRunner.assert.equal(batch[0].op_id, ops[0]);
    TestRunner.assert.equal(batch[1].op_id, ops[2]);

    for (const op of ops) await Storage.removeFromOutbox(user, op);
  });

  t.test('不同 user 的 outbox 互相隔离', async () => {
    if (Storage.useLocalStorage) return;

    const otherUser = 'other_user_999';
    const otherOp = 'op_other_' + Date.now();
    await Storage.writeOutbox(otherUser, 'horses', 'h_other', 'upsert', {}, otherOp, null);

    const myBatch = await Storage.getOutboxBatch(TEST_USER, 100);
    const leaked = myBatch.find(item => item.op_id === otherOp);
    TestRunner.assert.ok(!leaked, '不应看到其他用户的 outbox');

    // 清理
    await Storage.removeFromOutbox(otherUser, otherOp);
  });
});

TestRunner.suite('Storage v5 — Workspace Meta', (t) => {
  t.test('getWorkspaceOwner 默认为 null', async () => {
    // 清理可能存在的旧值
    localStorage.removeItem('sync_workspace_owner');
    const owner = Storage.getWorkspaceOwner();
    TestRunner.assert.equal(owner, null);
  });

  t.test('setWorkspaceOwner 和 getWorkspaceOwner 应一致', async () => {
    await Storage.setWorkspaceOwner('user_123');
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), 'user_123');
    // 清理
    await Storage.setWorkspaceOwner(null);
  });

  t.test('getSyncCursor 默认为 0', async () => {
    const cursor = await Storage.getSyncCursor('nonexistent_user');
    TestRunner.assert.equal(cursor, 0);
  });

  t.test('setSyncCursor 和 getSyncCursor 应一致且不再写 localStorage', async () => {
    await Storage.setSyncCursor('user_cursor_test', 12345);
    TestRunner.assert.equal(await Storage.getSyncCursor('user_cursor_test'), 12345);
    TestRunner.assert.equal(localStorage.getItem('sync_cursor_user_cursor_test'), null);
    await Storage.delete('sync_meta', 'cursor_user_cursor_test');
  });
});

TestRunner.suite('Storage v5 — 防重复初始化', (t) => {
  t.test('_initPromise 应存在且初始化完成', async () => {
    TestRunner.assert.ok(Storage._initPromise instanceof Promise);
    await Storage._initPromise;
    TestRunner.assert.equal(Storage._initDone, true);
  });

  t.test('并发重复调用 init() 应返回同一个 Promise', async () => {
    const first = Storage.init();
    const second = Storage.init();
    TestRunner.assert.equal(first, second);
    await first;
  });
});

TestRunner.suite('Storage v5 — 可恢复记录迁移', (t) => {
  t.test('分批中断后可续跑，多标签并发幂等，且跳过 preset/Press', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;

    const migrationBefore = await Storage.get('sync_meta', Storage._v5MigrationKey);
    const presetReadyBefore = Storage._presetIdsReady;
    const presetIdsBefore = Storage._PRESET_IDS;
    const ids = [];
    const presetId = `_mig_preset_${Date.now()}`;
    const pressId = `_mig_press_${Date.now()}`;

    try {
      await Storage.setWorkspaceOwner(null);
      Storage._presetIdsReady = true;
      Storage._PRESET_IDS = new Set([presetId]);
      await Storage._deleteRaw('sync_meta', Storage._v5MigrationKey);

      let i = 0;
      for (const module of Storage._SYNCABLE_STORES) {
        const id = `_mig_${module}_${Date.now()}_${i++}`;
        ids.push([module, id]);
        await Storage._putRaw(module, { id, name: id, updated_at: '2026-08-21T00:00:00Z' });
      }
      await Storage._putRaw('races', { id: presetId, name: 'preset without source' });
      await Storage._putRaw('press_articles', { id: pressId, title: 'press', markdown: '' });

      const interrupted = await Storage._migrateSyncRecordsV5({ batchSize: 1, maxBatches: 2 });
      TestRunner.assert.equal(interrupted.status, 'running', '首次只跑两批应保留 running 状态');
      TestRunner.assert.ok(interrupted.cursor != null || interrupted.store_index > 0, '应持久化 cursor/store_index');

      await Promise.all([
        Storage._migrateSyncRecordsV5({ batchSize: 2 }),
        Storage._migrateSyncRecordsV5({ batchSize: 3 })
      ]);
      const done = await Storage.get('sync_meta', Storage._v5MigrationKey);
      TestRunner.assert.equal(done.value.status, 'done');
      TestRunner.assert.equal(done.value.store_index, Storage._SYNCABLE_STORES.size);

      for (const [module, id] of ids) {
        const record = await Storage.get(module, id);
        TestRunner.assert.ok(Number.isFinite(record.updated_at), `${module} updated_at 应为数值`);
      }
      TestRunner.assert.equal((await Storage.get('races', presetId)).updated_at, undefined, '旧 preset 不应迁移');
      TestRunner.assert.equal((await Storage.get('press_articles', pressId)).updated_at, undefined, 'Press 不应迁移');
    } finally {
      for (const [module, id] of ids) await Storage._deleteRaw(module, id);
      await Storage._deleteRaw('races', presetId);
      await Storage._deleteRaw('press_articles', pressId);
      if (migrationBefore) await Storage._putRaw('sync_meta', migrationBefore);
      else await Storage._deleteRaw('sync_meta', Storage._v5MigrationKey);
      Storage._presetIdsReady = presetReadyBefore;
      Storage._PRESET_IDS = presetIdsBefore;
    }
  });
});

TestRunner.suite('Storage v5 — 九模块通用写入口原子性', (t) => {
  t.test('直接 put/delete 也应原子产生 outbox、generation、sequence', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;
    const user = `_generic_writer_${Date.now()}`;
    const presetReadyBefore = Storage._presetIdsReady;
    const presetIdsBefore = Storage._PRESET_IDS;
    const written = [];

    try {
      Storage._presetIdsReady = true;
      Storage._PRESET_IDS = new Set();
      await Storage.setWorkspaceOwner(user);
      const genBefore = await Storage.getWorkspaceGeneration(user);
      let i = 0;
      for (const module of Storage._SYNCABLE_STORES) {
        const id = `_generic_${module}_${Date.now()}_${i++}`;
        written.push([module, id]);
        await Storage.put(module, { id, name: id, code: `${i}_${Date.now()}`, source: 'user' });
      }
      const afterPut = await Storage.getAll('sync_outbox');
      const putItems = afterPut.filter(item => item.user_id === user && item.action === 'upsert');
      TestRunner.assert.equal(putItems.length, Storage._SYNCABLE_STORES.size);
      TestRunner.assert.ok(putItems.every(item => Number.isFinite(item.sequence)));
      TestRunner.assert.equal(new Set(putItems.map(item => item.sequence)).size, putItems.length);
      TestRunner.assert.ok((await Storage.getWorkspaceGeneration(user)) >= genBefore + putItems.length);
      for (const [module, id] of written) {
        TestRunner.assert.ok(Number.isFinite((await Storage.get(module, id)).updated_at));
        await Storage.delete(module, id);
      }
      const afterDelete = await Storage.getAll('sync_outbox');
      const deletes = afterDelete.filter(item => item.user_id === user && item.action === 'delete');
      TestRunner.assert.equal(deletes.length, Storage._SYNCABLE_STORES.size);
      for (const [module, id] of written) {
        TestRunner.assert.equal(await Storage.get(module, id), null, `${module} 应已删除`);
      }
    } finally {
      const items = (await Storage.getAll('sync_outbox')).filter(item => item.user_id === user);
      for (const item of items) await Storage.removeFromOutbox(user, item.op_id);
      for (const [module, id] of written) await Storage._deleteRaw(module, id);
      await Storage.setWorkspaceOwner(null);
      Storage._presetIdsReady = presetReadyBefore;
      Storage._PRESET_IDS = presetIdsBefore;
    }
  });
});

TestRunner.suite('Storage v5 — 恢复与同步 fail-closed', (t) => {
  t.test('已绑定 workspace 的自动备份只进入隔离 staging，不静默恢复或产生 outbox', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;
    const user = `_recovery_${Date.now()}`;
    const horseId = `_recovery_horse_${Date.now()}`;
    const existing = await Storage.getAllHorses();
    for (const h of existing) await Storage._deleteRaw('horses', h.id);
    localStorage.setItem('auto_backup_horses', JSON.stringify({
      ts: Date.now(), count: 1, horses: [{ id: horseId, name_en: 'Recovered' }]
    }));

    try {
      await Storage.setWorkspaceOwner(user);
      const result = await Storage._detectAndRecoverDataLoss();
      TestRunner.assert.ok(result?.staged);
      TestRunner.assert.equal(await Storage.getHorse(horseId), null);
      TestRunner.assert.ok(localStorage.getItem(`auto_backup_recovery_pending_${user}`));
      const outbox = (await Storage.getAll('sync_outbox')).filter(item => item.user_id === user && item.record_id === horseId);
      TestRunner.assert.equal(outbox.length, 0);
      let code = null;
      try { Storage.assertSyncReadyForNetwork(); } catch (e) { code = e.code; }
      TestRunner.assert.equal(code, 'LOCAL_RECOVERY_REQUIRED');
    } finally {
      localStorage.removeItem('auto_backup_horses');
      localStorage.removeItem(`auto_backup_recovery_pending_${user}`);
      Storage._clearSyncSafetyError('LOCAL_RECOVERY_REQUIRED');
      await Storage.setWorkspaceOwner(null);
      for (const h of existing) await Storage._putRaw('horses', h);
    }
  });

  t.test('preset 清单失败时 syncNow 不得发起任何网络请求', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;
    const user = `_preset_block_${Date.now()}`;
    const readyBefore = Storage._presetIdsReady;
    const idsBefore = Storage._PRESET_IDS;
    const fetchBefore = Auth._fetch;
    const authUserBefore = Auth._userId;
    let requests = 0;
    try {
      await Storage.setWorkspaceOwner(user);
      Auth._userId = user;
      Auth._fetch = async () => { requests += 1; throw new Error('network must not be called'); };
      Storage._presetIdsReady = false;
      Storage._PRESET_IDS = null;
      Storage._setSyncSafetyError('PRESET_FILTER_UNAVAILABLE', 'preset unavailable');
      Sync._stopped = false;
      Sync._syncLock = false;
      await Sync.syncNow();
      TestRunner.assert.equal(requests, 0);
      TestRunner.assert.equal(Sync._status, Sync.STATUS.ERROR);
    } finally {
      Storage._clearSyncSafetyError('PRESET_FILTER_UNAVAILABLE');
      Storage._presetIdsReady = readyBefore;
      Storage._PRESET_IDS = idsBefore;
      Auth._fetch = fetchBefore;
      Auth._userId = authUserBefore;
      Sync._syncLock = false;
      await Storage.setWorkspaceOwner(null);
      await Storage.clearSyncError(user);
    }
  });

  t.test('Safari quick-open 失败必须保留数据库，禁止 deleteDatabase', async () => {
    const quickBefore = Storage._quickOpen;
    const deleteBefore = Storage._deleteDB;
    const marker = localStorage.getItem('ped_purge_done');
    let deleted = false;
    try {
      localStorage.removeItem('ped_purge_done');
      Storage._quickOpen = async () => { throw new Error('simulated timeout'); };
      Storage._deleteDB = async () => { deleted = true; };
      await Storage._nukeIfContaminated();
      TestRunner.assert.equal(deleted, false);
      TestRunner.assert.equal(localStorage.getItem('ped_purge_done'), null);
    } finally {
      Storage._quickOpen = quickBefore;
      Storage._deleteDB = deleteBefore;
      Storage._clearSyncSafetyError('SAFARI_BACKUP_UNAVAILABLE');
      if (marker) localStorage.setItem('ped_purge_done', marker);
      else localStorage.removeItem('ped_purge_done');
    }
  });

  t.test('sync_outbox 读取失败时备份必须拒绝，不能返回成功', async () => {
    const fakeDb = {
      objectStoreNames: ['sync_outbox', 'sync_meta'],
      transaction(storeName) {
        const tx = { error: null };
        tx.objectStore = () => ({
          getAll() {
            const req = { error: new Error(`read failed: ${storeName}`) };
            setTimeout(() => req.onerror && req.onerror(), 0);
            return req;
          }
        });
        return tx;
      }
    };
    await TestRunner.assert.rejects(() => Storage._backupUserData(fakeDb));
  });

  t.test('完整 Safari 备份必须包含并核对两个同步 store', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;
    try {
      const ok = await Storage._backupUserData(Storage.db);
      TestRunner.assert.ok(ok);
      const envelope = JSON.parse(localStorage.getItem('ped_purge_backup'));
      TestRunner.assert.equal(envelope.version, 2);
      TestRunner.assert.ok(Array.isArray(envelope.stores.sync_outbox));
      TestRunner.assert.ok(Array.isArray(envelope.stores.sync_meta));
      TestRunner.assert.equal(envelope.stores.sync_outbox.length, envelope.expectedCounts.sync_outbox);
      TestRunner.assert.equal(envelope.stores.sync_meta.length, envelope.expectedCounts.sync_meta);
    } finally {
      localStorage.removeItem('ped_purge_backup');
    }
  });
});

TestRunner.suite('Storage v5 — fail-closed 补充边界', (t) => {
  t.test('静态 preset 请求失败时即使存在旧缓存也必须保持阻断', async () => {
    const fetchBefore = window.fetch;
    const readyBefore = Storage._presetIdsReady;
    const idsBefore = Storage._PRESET_IDS;
    const rawBefore = localStorage.getItem('_preset_record_ids');
    try {
      localStorage.setItem('_preset_record_ids', JSON.stringify(['stale_cached_preset']));
      window.fetch = async () => { throw new Error('offline'); };
      const loaded = await Storage._loadPresetData();
      TestRunner.assert.equal(loaded, false);
      TestRunner.assert.equal(Storage._presetIdsReady, false);
      let code = null;
      try { Storage.assertSyncReadyForNetwork(); } catch (e) { code = e.code; }
      TestRunner.assert.equal(code, 'PRESET_FILTER_UNAVAILABLE');
    } finally {
      window.fetch = fetchBefore;
      Storage._presetIdsReady = readyBefore;
      Storage._PRESET_IDS = idsBefore;
      Storage._clearSyncSafetyError('PRESET_FILTER_UNAVAILABLE');
      if (rawBefore == null) localStorage.removeItem('_preset_record_ids');
      else localStorage.setItem('_preset_record_ids', rawBefore);
    }
  });

  t.test('sync_meta 读取失败同样必须拒绝备份', async () => {
    const fakeDb = {
      objectStoreNames: ['sync_meta'],
      transaction(storeName) {
        const tx = { error: null };
        tx.objectStore = () => ({
          getAll() {
            const req = { error: new Error(`read failed: ${storeName}`) };
            setTimeout(() => req.onerror && req.onerror(), 0);
            return req;
          }
        });
        return tx;
      }
    };
    await TestRunner.assert.rejects(() => Storage._backupUserData(fakeDb));
  });

  t.test('localStorage 容量不足时必须拒绝备份且不得留下伪成功数据', async () => {
    await _waitStorageReady();
    if (Storage.useLocalStorage) return;
    const proto = Object.getPrototypeOf(localStorage);
    const setItemBefore = proto.setItem;
    try {
      proto.setItem = function(key, value) {
        if (key === 'ped_purge_backup') throw new DOMException('quota', 'QuotaExceededError');
        return setItemBefore.call(this, key, value);
      };
      await TestRunner.assert.rejects(() => Storage._backupUserData(Storage.db));
    } finally {
      proto.setItem = setItemBefore;
      localStorage.removeItem('ped_purge_backup');
    }
  });
});
