/**
 * 前端 snapshot 重建测试：分页、preset 保留、generation/outbox 竞态。
 */
'use strict';

const SnapshotTestHelpers = {
  async ready() { await Storage.init(); },

  async clearOutbox(userId) {
    while (true) {
      const batch = await Storage.getOutboxBatch(userId, 1000);
      if (!batch.length) break;
      for (const item of batch) await Storage.removeFromOutbox(userId, item.op_id);
    }
  },

  async resetMeta(userId, cursor) {
    await this.clearOutbox(userId);
    await Storage.delete('sync_meta', `gen_${userId}`);
    await Storage.delete('sync_meta', `outbox_seq_${userId}`);
    await Storage.setSyncCursor(userId, cursor);
    await Storage.setWorkspaceOwner(userId);
    Auth._userId = userId;
    Sync._stopped = false;
  },

  page(token, revision, total, items, hasMore, nextCursor) {
    return {
      snapshot_token: token,
      snapshot_revision: revision,
      total_items: total,
      items,
      has_more: hasMore,
      next_cursor: nextCursor,
      request_id: 'snapshot_test',
    };
  },
};

TestRunner.suite('Sync Snapshot — 原子重建', (t) => {
  t.test('完整分页后原子替换、推进cursor并保留preset', async () => {
    await SnapshotTestHelpers.ready();
    if (Storage.useLocalStorage) return;
    const user = `snapshot_ok_${Date.now()}`;
    await SnapshotTestHelpers.resetMeta(user, 77);
    await Storage._putRaw('horses', { id: 'snapshot_old', name: 'old-local' });

    const presetId = [...Storage._getPresetIds()][0];
    let presetBefore = null;
    if (presetId) {
      presetBefore = await Storage.get('countries', presetId) || await Storage.get('races', presetId);
    }

    let call = 0;
    Auth._fetch = async () => {
      call++;
      if (call === 1) {
        return SnapshotTestHelpers.page('token_snapshot_ok_1234567890', 100, 2, [
          { module: 'horses', id: 'snapshot_new_1', data: { name: 'cloud-1' }, revision: 90 },
        ], true, 0);
      }
      return SnapshotTestHelpers.page('token_snapshot_ok_1234567890', 100, 2, [
        { module: 'owners', id: 'snapshot_new_2', data: { name: 'cloud-2' }, revision: 95 },
      ], false, 1);
    };

    const replaced = await Sync._rebuildFromSnapshot(user);
    TestRunner.assert.ok(replaced);
    TestRunner.assert.equal(call, 2);
    TestRunner.assert.equal(await Storage.getSyncCursor(user), 100);
    TestRunner.assert.equal(await Storage.get('horses', 'snapshot_old'), null);
    TestRunner.assert.equal((await Storage.get('horses', 'snapshot_new_1')).name, 'cloud-1');
    TestRunner.assert.equal((await Storage.get('owners', 'snapshot_new_2')).name, 'cloud-2');
    if (presetBefore) {
      const presetAfter = await Storage.get('countries', presetId) || await Storage.get('races', presetId);
      TestRunner.assert.ok(presetAfter, 'snapshot替换后preset必须保留');
    }
  });

  t.test('下载期间本地编辑必须中止替换并保留记录/outbox/cursor', async () => {
    const user = `snapshot_edit_${Date.now()}`;
    await SnapshotTestHelpers.resetMeta(user, 55);
    await Storage._putRaw('horses', { id: 'edit_baseline', name: 'baseline' });
    const originalSchedule = Sync.schedulePush;
    Sync.schedulePush = () => {};
    Auth._fetch = async () => {
      await Storage.saveHorse({ id: 'local_during_snapshot', name: 'local-edit' });
      return SnapshotTestHelpers.page('token_snapshot_edit_123456', 120, 1, [
        { module: 'horses', id: 'cloud_edit', data: { name: 'cloud' }, revision: 120 },
      ], false, 0);
    };

    try {
      const replaced = await Sync._rebuildFromSnapshot(user);
      TestRunner.assert.ok(!replaced, 'generation变化后必须中止');
      TestRunner.assert.equal(await Storage.getSyncCursor(user), 55);
      TestRunner.assert.ok(await Storage.get('horses', 'edit_baseline'));
      TestRunner.assert.equal((await Storage.get('horses', 'local_during_snapshot')).name, 'local-edit');
      TestRunner.assert.equal(await Storage.get('horses', 'cloud_edit'), null);
      TestRunner.assert.equal(await Storage.getOutboxCount(user), 1);
    } finally {
      Sync.schedulePush = originalSchedule;
      await SnapshotTestHelpers.clearOutbox(user);
    }
  });

  t.test('下载期间本地删除必须中止替换并保留delete outbox和原cursor', async () => {
    const user = `snapshot_delete_${Date.now()}`;
    await SnapshotTestHelpers.resetMeta(user, 66);
    await Storage._putRaw('horses', { id: 'victim_during_snapshot', name: 'victim', _server_revision: 12 });
    const originalSchedule = Sync.schedulePush;
    Sync.schedulePush = () => {};
    Auth._fetch = async () => {
      await Storage.deleteHorse('victim_during_snapshot');
      return SnapshotTestHelpers.page('token_snapshot_delete_1234', 130, 1, [
        { module: 'horses', id: 'cloud_delete', data: { name: 'cloud' }, revision: 130 },
      ], false, 0);
    };

    try {
      const replaced = await Sync._rebuildFromSnapshot(user);
      TestRunner.assert.ok(!replaced, 'delete产生generation/outbox后必须中止');
      TestRunner.assert.equal(await Storage.getSyncCursor(user), 66);
      TestRunner.assert.equal(await Storage.get('horses', 'victim_during_snapshot'), null);
      TestRunner.assert.equal(await Storage.get('horses', 'cloud_delete'), null);
      const batch = await Storage.getOutboxBatch(user, 10);
      TestRunner.assert.equal(batch.length, 1);
      TestRunner.assert.equal(batch[0].action, 'delete');
      TestRunner.assert.equal(batch[0].known_revision, 12);
    } finally {
      Sync.schedulePush = originalSchedule;
      await SnapshotTestHelpers.clearOutbox(user);
    }
  });

  t.test('SNAPSHOT_EXPIRED 应重新物化一次', async () => {
    const user = `snapshot_expired_${Date.now()}`;
    await SnapshotTestHelpers.resetMeta(user, 88);
    let calls = 0;
    Auth._fetch = async () => {
      calls++;
      if (calls === 1) {
        const error = new Error('expired');
        error.status = 410;
        error.code = 'SNAPSHOT_EXPIRED';
        throw error;
      }
      return SnapshotTestHelpers.page('token_snapshot_retry_12345', 200, 0, [], false, null);
    };

    const replaced = await Sync._rebuildFromSnapshot(user);
    TestRunner.assert.ok(replaced);
    TestRunner.assert.equal(calls, 2);
    TestRunner.assert.equal(await Storage.getSyncCursor(user), 200);
  });

  t.test('第20页瞬时失败应重试同一token/cursor并保留已下载staging', async () => {
    const user = `snapshot_page20_${Date.now()}`;
    await SnapshotTestHelpers.resetMeta(user, 101);
    const oldBaseDelay = Sync._snapshotRetryBaseMs;
    const oldMaxAttempts = Sync._snapshotPageMaxAttempts;
    Sync._snapshotRetryBaseMs = 0;
    Sync._snapshotPageMaxAttempts = 3;
    const token = 'token_snapshot_page20_resume_123456';
    const requestedBodies = [];
    let calls = 0;

    Auth._fetch = async (path, method, body) => {
      TestRunner.assert.equal(path, '/api/sync/snapshot');
      calls += 1;
      requestedBodies.push(JSON.parse(JSON.stringify(body || {})));
      if (calls === 20) {
        const error = new Error('transient page 20 failure');
        error.status = 0;
        error.code = 'NETWORK_ERROR';
        throw error;
      }
      const pageIndex = body?.snapshot_token ? Number(body.cursor) + 1 : 0;
      return SnapshotTestHelpers.page(token, 300, 21, [
        {
          module: 'horses', id: `snapshot_page_${String(pageIndex).padStart(2, '0')}`,
          data: { ordinal: pageIndex }, revision: 250 + pageIndex,
        },
      ], pageIndex < 20, pageIndex);
    };

    try {
      const replaced = await Sync._rebuildFromSnapshot(user);
      TestRunner.assert.ok(replaced);
      TestRunner.assert.equal(calls, 22);
      TestRunner.assert.deepEqual(requestedBodies[19], {
        snapshot_token: token, cursor: 18,
      });
      TestRunner.assert.deepEqual(requestedBodies[20], requestedBodies[19]);
      TestRunner.assert.equal(await Storage.getSyncCursor(user), 300);
      TestRunner.assert.equal((await Storage.get('horses', 'snapshot_page_00')).ordinal, 0);
      TestRunner.assert.equal((await Storage.get('horses', 'snapshot_page_20')).ordinal, 20);
    } finally {
      Sync._snapshotRetryBaseMs = oldBaseDelay;
      Sync._snapshotPageMaxAttempts = oldMaxAttempts;
    }
  });

  t.test('不完整或重复snapshot不得替换现有workspace', async () => {
    const user = `snapshot_invalid_${Date.now()}`;
    await SnapshotTestHelpers.resetMeta(user, 99);
    await Storage._putRaw('horses', { id: 'invalid_baseline', name: 'keep-me' });
    Auth._fetch = async () => SnapshotTestHelpers.page(
      'token_snapshot_invalid_1234', 220, 2,
      [{ module: 'horses', id: 'only_one', data: { name: 'one' }, revision: 220 }],
      false, null
    );

    let rejected = false;
    try { await Sync._rebuildFromSnapshot(user); } catch (_) { rejected = true; }
    // 长度不符由_rebuild返回false；协议错误也允许抛出，但都不得落地。
    TestRunner.assert.ok(rejected || await Storage.getSyncCursor(user) === 99);
    TestRunner.assert.equal(await Storage.getSyncCursor(user), 99);
    TestRunner.assert.ok(await Storage.get('horses', 'invalid_baseline'));
  });
});
