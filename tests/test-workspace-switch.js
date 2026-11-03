/** Workspace 原子切换与回滚测试。 */
'use strict';

const WorkspaceSwitchTestHelpers = {
  async clearOutbox(userId) {
    while (true) {
      const batch = await Storage.getOutboxBatch(userId, 1000);
      if (!batch.length) break;
      for (const item of batch) await Storage.removeFromOutbox(userId, item.op_id);
    }
  },
  async clearUserData() {
    for (const module of Storage._SYNCABLE_STORES) {
      for (const record of await Storage.getAll(module)) {
        if (Storage.isSyncableRecord(module, record)) await Storage.delete(module, record.id);
      }
    }
  },
  async reset(userA, userB) {
    const pending = await Storage.getWorkspaceSwitchState();
    if (pending) await Storage.rollbackWorkspaceSwitch();
    await this.clearOutbox(userA); await this.clearOutbox(userB);
    for (const user of [userA, userB]) {
      for (const prefix of ['cursor_', 'gen_', 'baseline_', 'outbox_seq_']) {
        await Storage.delete('sync_meta', `${prefix}${user}`);
      }
    }
    await Storage.setWorkspaceOwner(null);
    await this.clearUserData();
  },
};

TestRunner.suite('Storage Workspace Switch — 原子切换', (t) => {
  t.test('准备后失败回滚应恢复原owner/数据/cursor并保留Press、preset、其他outbox', async () => {
    const userA = `switch_a_${Date.now()}`, userB = `switch_b_${Date.now()}`;
    await WorkspaceSwitchTestHelpers.reset(userA, userB);
    await Storage.setWorkspaceOwner(userA);
    await Storage.setSyncCursor(userA, 42);
    await Storage._putRaw('horses', { id: 'switch_old_horse', name: 'A-local' });
    await Storage.put('press_articles', { id: 'switch_press', title: 'local-only' });
    await Storage.writeOutbox(userA, 'horses', 'switch_pending', 'upsert', { name: 'pending' }, crypto.randomUUID(), null);
    const presetId = [...Storage._getPresetIds()][0];
    const presetBefore = presetId ? (await Storage.get('countries', presetId) || await Storage.get('races', presetId)) : null;

    const state = await Storage.beginWorkspaceSwitch(userB);
    TestRunner.assert.equal(state.previous_owner, userA);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), userB);
    TestRunner.assert.equal(await Storage.get('horses', 'switch_old_horse'), null);
    TestRunner.assert.ok(await Storage.get('press_articles', 'switch_press'));
    TestRunner.assert.equal(await Storage.getOutboxCount(userA), 1);
    if (presetBefore) TestRunner.assert.ok(await Storage.get('countries', presetId) || await Storage.get('races', presetId));

    await Storage.applyRemoteUpsert('horses', 'switch_cloud_temp', { name: 'B-cloud' }, 90);
    await Storage.rollbackWorkspaceSwitch();
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), userA);
    TestRunner.assert.equal(await Storage.getSyncCursor(userA), 42);
    TestRunner.assert.equal((await Storage.get('horses', 'switch_old_horse')).name, 'A-local');
    TestRunner.assert.equal(await Storage.get('horses', 'switch_cloud_temp'), null);
    TestRunner.assert.ok(await Storage.get('press_articles', 'switch_press'));
    TestRunner.assert.equal(await Storage.getOutboxCount(userA), 1);
    TestRunner.assert.equal(await Storage.getWorkspaceSwitchState(), null);

    await WorkspaceSwitchTestHelpers.reset(userA, userB);
    await Storage.delete('press_articles', 'switch_press');
  });

  t.test('snapshot成功后提交应保留云端数据并清除持久备份', async () => {
    const userA = `commit_a_${Date.now()}`, userB = `commit_b_${Date.now()}`;
    await WorkspaceSwitchTestHelpers.reset(userA, userB);
    await Storage.setWorkspaceOwner(userA);
    await Storage._putRaw('horses', { id: 'commit_old', name: 'old-A' });
    const presetId = [...Storage._getPresetIds()][0];

    await Storage.beginWorkspaceSwitch(userB);
    const generation = await Storage.getWorkspaceGeneration(userB);
    const replaced = await Storage.atomicSnapshotReplace(userB, [
      { module: 'horses', id: 'commit_cloud', data: { name: 'cloud-B' }, revision: 500 },
    ], 500, generation, 1);
    TestRunner.assert.ok(replaced);
    TestRunner.assert.ok(await Storage.commitWorkspaceSwitch(userB));
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), userB);
    TestRunner.assert.equal(await Storage.getWorkspaceSwitchState(), null);
    TestRunner.assert.equal(await Storage.get('horses', 'commit_old'), null);
    TestRunner.assert.equal((await Storage.get('horses', 'commit_cloud')).name, 'cloud-B');
    TestRunner.assert.equal(await Storage.getSyncCursor(userB), 500);
    if (presetId) TestRunner.assert.ok(await Storage.get('countries', presetId) || await Storage.get('races', presetId));

    await WorkspaceSwitchTestHelpers.reset(userA, userB);
  });

  t.test('启动检测到prepared状态应自动回滚', async () => {
    const userA = `recover_a_${Date.now()}`, userB = `recover_b_${Date.now()}`;
    await WorkspaceSwitchTestHelpers.reset(userA, userB);
    await Storage.setWorkspaceOwner(userA);
    await Storage._putRaw('horses', { id: 'recover_old', name: 'recover-A' });
    await Storage.beginWorkspaceSwitch(userB);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), userB);

    await Storage._recoverInterruptedWorkspaceSwitch();
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), userA);
    TestRunner.assert.equal((await Storage.get('horses', 'recover_old')).name, 'recover-A');
    TestRunner.assert.equal(await Storage.getWorkspaceSwitchState(), null);

    await WorkspaceSwitchTestHelpers.reset(userA, userB);
  });
});
