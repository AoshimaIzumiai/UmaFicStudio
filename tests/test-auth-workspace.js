/** Auth 候选会话与 workspace 决策测试。 */
'use strict';

const AuthWorkspaceHelpers = {
  async clearUserData() {
    for (const module of Storage._SYNCABLE_STORES) {
      for (const record of await Storage.getAll(module)) {
        if (Storage.isSyncableRecord(module, record)) {
          await Storage._deleteRaw(module, record.id);
        }
      }
    }
  },
  async clearOutbox() {
    for (const item of await Storage.getAll('sync_outbox')) {
      await Storage._deleteRaw('sync_outbox', item.op_id);
    }
  },
  async reset() {
    const state = await Storage.getWorkspaceSwitchState();
    if (state) await Storage.rollbackWorkspaceSwitch();
    await this.clearUserData();
    await this.clearOutbox();
    await Storage.setWorkspaceOwner(null);
    localStorage.removeItem(Auth.TOKEN_KEY);
    localStorage.removeItem(Auth.USER_KEY);
    sessionStorage.removeItem(Auth.SESSION_TRANSITION_KEY);
    Auth._candidateSession = null;
    Sync._stopped = false;
  },
  setSession(id, name) { Auth._saveSession(`token-${id}`, { id, username: name }); },
};

TestRunner.suite('Auth Workspace — 候选会话', (t) => {
  t.test('登录冲突和取消不得覆盖当前会话', async () => {
    await Storage.init();
    await AuthWorkspaceHelpers.reset();
    await Storage.setWorkspaceOwner('user_a');
    await Storage._putRaw('horses', { id: 'candidate_local', name: 'A-local' });
    AuthWorkspaceHelpers.setSession('user_a', 'accountA');
    Auth._fetch = async () => ({ token: 'token-user_b', user: { id: 'user_b', username: 'accountB' } });

    const result = await Auth.login('accountB', 'Password7');
    TestRunner.assert.equal(result.workspaceConflict, 'other_account');
    TestRunner.assert.equal(Auth.getUserId(), 'user_a');
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), 'user_a');
    Auth.cancelLogin();
    TestRunner.assert.equal(Auth.getUserId(), 'user_a');

    await AuthWorkspaceHelpers.reset();
  });

  t.test('snapshot失败应恢复原会话、owner和本地数据', async () => {
    await AuthWorkspaceHelpers.reset();
    await Storage.setWorkspaceOwner('rollback_a');
    await Storage._putRaw('horses', { id: 'rollback_local', name: 'restore-me' });
    AuthWorkspaceHelpers.setSession('rollback_a', 'rollbackA');
    Auth._fetch = async () => ({ token: 'token-rollback_b', user: { id: 'rollback_b', username: 'rollbackB' } });
    await Auth.login('rollbackB', 'Password7');

    const originalExport = Auth._exportLocalBackup;
    const originalInit = Sync.init;
    const originalStop = Sync.stop;
    Auth._exportLocalBackup = async () => {};
    Sync.init = async () => { throw new Error('snapshot failed'); };
    Sync.stop = () => {};
    let failed = false;
    try { await Auth.switchToCloudWorkspace(); } catch (_) { failed = true; }
    finally {
      Auth._exportLocalBackup = originalExport;
      Sync.init = originalInit;
      Sync.stop = originalStop;
    }

    TestRunner.assert.ok(failed);
    TestRunner.assert.equal(Auth.getUserId(), 'rollback_a');
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), 'rollback_a');
    TestRunner.assert.equal((await Storage.getHorse('rollback_local')).name, 'restore-me');
    TestRunner.assert.equal(await Storage.getWorkspaceSwitchState(), null);

    await AuthWorkspaceHelpers.reset();
  });

  t.test('snapshot成功后才提交B会话和workspace', async () => {
    await AuthWorkspaceHelpers.reset();
    await Storage.setWorkspaceOwner('commit_a');
    await Storage._putRaw('horses', { id: 'auth_old_a', name: 'old-A' });
    AuthWorkspaceHelpers.setSession('commit_a', 'commitA');
    Auth._fetch = async () => ({ token: 'token-commit_b', user: { id: 'commit_b', username: 'commitB' } });
    await Auth.login('commitB', 'Password7');

    const originalExport = Auth._exportLocalBackup;
    const originalInit = Sync.init;
    Auth._exportLocalBackup = async () => {};
    Sync.init = async () => {
      const generation = await Storage.getWorkspaceGeneration('commit_b');
      const ok = await Storage.atomicSnapshotReplace('commit_b', [
        { module: 'horses', id: 'auth_cloud_b', data: { name: 'cloud-B' }, revision: 700 },
      ], 700, generation, 1);
      if (!ok) throw new Error('atomic snapshot failed');
      Sync._status = Sync.STATUS.SYNCED;
    };
    try { await Auth.switchToCloudWorkspace(); }
    finally { Auth._exportLocalBackup = originalExport; Sync.init = originalInit; }

    TestRunner.assert.equal(Auth.getUserId(), 'commit_b');
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), 'commit_b');
    TestRunner.assert.equal(await Storage.getHorse('auth_old_a'), null);
    TestRunner.assert.equal((await Storage.getHorse('auth_cloud_b')).name, 'cloud-B');
    TestRunner.assert.equal(await Storage.getWorkspaceSwitchState(), null);
    TestRunner.assert.equal(sessionStorage.getItem(Auth.SESSION_TRANSITION_KEY), null);

    await AuthWorkspaceHelpers.reset();
  });
  t.test('删号后清理该账号同步状态但保留本地业务数据与其他账号队列', async () => {
    await AuthWorkspaceHelpers.reset();
    const userId = 'deleted_account_user';
    const otherUser = 'other_preserved_user';
    await Storage.setWorkspaceOwner(userId);
    await Storage._putRaw('horses', { id: 'delete_account_local_horse', name: 'keep-local' });
    AuthWorkspaceHelpers.setSession(userId, 'deleteMe');
    await Storage.writeOutbox(userId, 'horses', 'delete_account_local_horse', 'upsert', { id: 'delete_account_local_horse', name: 'keep-local' }, 'delete-user-op', null);
    await Storage.writeOutbox(otherUser, 'horses', 'other-horse', 'upsert', { id: 'other-horse', name: 'other' }, 'other-user-op', null);
    await Storage.setSyncCursor(userId, 44);
    await Storage.setSyncCursor(otherUser, 55);
    await Storage.put('sync_meta', { key: `baseline_${userId}`, value: true });
    await Storage.setLastSyncedAt(userId, 123456);
    await Storage.setSyncError(userId, { code: 'TEST' });

    const originalFetch = Auth._fetch;
    const originalStop = Sync.stop;
    let request = null;
    let stopped = false;
    Auth._fetch = async (path, method, body) => {
      request = { path, method, body };
      return { success: true };
    };
    Sync.stop = () => { stopped = true; };
    try {
      await Auth.deleteAccount('deleteMe');
    } finally {
      Auth._fetch = originalFetch;
      Sync.stop = originalStop;
    }

    TestRunner.assert.deepEqual(request, {
      path: '/api/auth/account', method: 'DELETE', body: { confirm_username: 'deleteMe' },
    });
    TestRunner.assert.equal(stopped, true);
    TestRunner.assert.equal(Auth.isLoggedIn(), false);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), null);
    TestRunner.assert.equal((await Storage.getHorse('delete_account_local_horse')).name, 'keep-local');
    TestRunner.assert.equal(await Storage.getOutboxCount(userId), 0);
    TestRunner.assert.equal(await Storage.getOutboxCount(otherUser), 1);
    TestRunner.assert.equal(await Storage.get('sync_meta', `cursor_${userId}`), null);
    TestRunner.assert.equal(await Storage.get('sync_meta', `baseline_${userId}`), null);
    TestRunner.assert.equal(await Storage.get('sync_meta', `last_error_${userId}`), null);
    TestRunner.assert.equal(await Storage.get('sync_meta', `last_synced_at_${userId}`), null);
    TestRunner.assert.equal(await Storage.getSyncCursor(otherUser), 55);

    await AuthWorkspaceHelpers.reset();
    await Storage.delete('sync_meta', `cursor_${otherUser}`);
  });
});


TestRunner.suite('Auth Register — 崩溃恢复', (t) => {
  t.test('adoption提交后会话保存中断，同账号登录应沿用pending和原op_id', async () => {
    await AuthWorkspaceHelpers.reset();
    await Storage._putRaw('horses', { id: 'register_crash_local', name: 'keep-local' });
    const response = {
      token: 'token-register-crash',
      user: { id: 'register_crash_user', username: 'registerCrash' },
    };
    Auth._fetch = async () => response;

    const originalSave = Auth._saveSession;
    Auth._saveSession = () => { throw new Error('simulated crash after adoption commit'); };
    let failed = false;
    try { await Auth.register('registerCrash', 'Password7'); } catch (_) { failed = true; }
    finally { Auth._saveSession = originalSave; }

    TestRunner.assert.ok(failed);
    TestRunner.assert.equal(Auth.isLoggedIn(), false);
    TestRunner.assert.equal(Auth.getUserId(), null);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), 'register_crash_user');
    const pending = await Storage.getInitialUploadState('register_crash_user');
    TestRunner.assert.equal(pending.status, 'pending');
    TestRunner.assert.equal(await Storage.getOutboxCount('register_crash_user'), 1);
    const originalOp = (await Storage.getOutboxBatch('register_crash_user', 10))[0].op_id;

    const login = await Auth.login('registerCrash', 'Password7');
    TestRunner.assert.equal(login.workspaceConflict, null);
    TestRunner.assert.equal(Auth.getUserId(), 'register_crash_user');
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), 'register_crash_user');
    TestRunner.assert.equal((await Storage.getOutboxBatch('register_crash_user', 10))[0].op_id, originalOp);
    TestRunner.assert.equal((await Storage.getInitialUploadState('register_crash_user')).adoption_id, pending.adoption_id);

    await AuthWorkspaceHelpers.reset();
  });
});
