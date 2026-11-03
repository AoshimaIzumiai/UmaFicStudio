/**
 * 首次上传 adoption 测试：owner/pending/outbox 原子准备、重入幂等、响应丢失续传。
 */
'use strict';

const InitialUploadTestHelpers = {
  async clearOutbox(userId) {
    while (true) {
      const batch = await Storage.getOutboxBatch(userId, 1000);
      if (!batch.length) break;
      for (const item of batch) await Storage.removeFromOutbox(userId, item.op_id);
    }
  },

  async clearUserData() {
    for (const module of Storage._SYNCABLE_STORES) {
      const records = await Storage.getAll(module);
      for (const record of records) {
        if (Storage.isSyncableRecord(module, record)) await Storage.delete(module, record.id);
      }
    }
  },

  async reset(userId) {
    await this.clearOutbox(userId);
    await Storage.delete('sync_meta', Storage._initialUploadKey(userId));
    await Storage.delete('sync_meta', `initial_upload_completed_${userId}`);
    await Storage.delete('sync_meta', `baseline_${userId}`);
    await Storage.delete('sync_meta', `cursor_${userId}`);
    await Storage.delete('sync_meta', `gen_${userId}`);
    await Storage.delete('sync_meta', `outbox_seq_${userId}`);
    await Storage.setWorkspaceOwner(null);
    Auth._userId = null;
    Sync._stopped = false;
    Sync._retryCount = 0;
    if (Sync._debounceTimer) clearTimeout(Sync._debounceTimer);
    Sync._debounceTimer = null;
  },
};

TestRunner.suite('Sync Initial Upload — 原子首次收养', (t) => {
  t.test('同一事务准备pending/outbox/cursor/owner且重入不生成新op_id', async () => {
    await Storage.init();
    if (Storage.useLocalStorage) return;
    const user = `adopt_atomic_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);

    await Storage.put('horses', {
      id: 'adopt_horse', name: 'local-horse', _server_revision: 999, _deleted: false,
    });
    await Storage.put('owners', { id: 'adopt_owner', name: 'local-owner' });

    const state = await Storage.beginInitialUpload(user);
    TestRunner.assert.equal(state.status, 'pending');
    TestRunner.assert.equal(state.total_items, 2);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), user);
    TestRunner.assert.equal(await Storage.getSyncCursor(user), 0);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 2);

    const firstBatch = [];
    while (true) {
      const batch = await Storage.getOutboxBatch(user, 100);
      if (!batch.length) break;
      firstBatch.push(...batch);
      for (const item of batch) await Storage.removeFromOutbox(user, item.op_id);
    }
    // 为验证重入，恢复原始 outbox 项而不改变 pending。
    for (const item of firstBatch) {
      await Storage.writeOutbox(
        user, item.module, item.record_id, item.action, item.data, item.op_id, item.known_revision
      );
    }
    const idsBefore = [];
    while (true) {
      const batch = await Storage.getOutboxBatch(user, 100);
      if (!batch.length) break;
      idsBefore.push(...batch.map(item => item.op_id));
      // getOutboxBatch只返回单模块；临时移除后继续读取另一模块，稍后恢复。
      for (const item of batch) await Storage.removeFromOutbox(user, item.op_id);
    }
    for (const item of firstBatch) {
      await Storage.writeOutbox(
        user, item.module, item.record_id, item.action, item.data, item.op_id, item.known_revision
      );
    }

    const resumed = await Storage.beginInitialUpload(user);
    TestRunner.assert.equal(resumed.adoption_id, state.adoption_id);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 2);
    const idsAfter = [];
    while (true) {
      const batch = await Storage.getOutboxBatch(user, 100);
      if (!batch.length) break;
      idsAfter.push(...batch.map(item => item.op_id));
      for (const item of batch) await Storage.removeFromOutbox(user, item.op_id);
    }
    idsBefore.sort(); idsAfter.sort();
    TestRunner.assert.deepEqual(idsAfter, idsBefore);

    const horsePayload = firstBatch.find(item => item.record_id === 'adopt_horse').data;
    TestRunner.assert.equal(horsePayload._server_revision, undefined);
    TestRunner.assert.equal(horsePayload._deleted, undefined);

    // 模拟刷新后从sync_meta恢复owner和pending。
    Storage._workspaceOwner = null;
    localStorage.removeItem('sync_workspace_owner');
    await Storage._loadWorkspaceOwner();
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), user);
    TestRunner.assert.equal((await Storage.getInitialUploadState(user)).adoption_id, state.adoption_id);

    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });

  t.test('pending首传完成push→snapshot→pull后才清除', async () => {
    const user = `adopt_complete_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);
    await Storage.put('horses', { id: 'adopt_complete_horse', name: 'keep-local' });
    const state = await Storage.beginInitialUpload(user);
    TestRunner.assert.equal(state.total_items, 1);
    Auth._userId = user;

    const cloud = new Map();
    let revision = 300;
    Auth._fetch = async (path, method, body) => {
      if (path === '/api/sync/push') {
        const results = body.changes.map(change => {
          revision += 1;
          cloud.set(change.id, { ...change.data });
          return { op_id: change.op_id, status: 'accepted', revision };
        });
        return { results, request_id: 'adopt_push' };
      }
      if (path === '/api/sync/snapshot') {
        const items = [...cloud.entries()].map(([id, data]) => ({
          module: 'horses', id, data, revision,
        }));
        return {
          snapshot_token: 'adopt_snapshot_token_123456789',
          snapshot_revision: revision,
          total_items: items.length,
          items,
          next_cursor: items.length ? items.length - 1 : null,
          has_more: false,
          request_id: 'adopt_snapshot',
        };
      }
      if (path.startsWith('/api/sync/pull')) {
        return {
          changes: [], next_cursor: revision, has_more: false,
          min_available_revision: revision, reset_required: false,
          request_id: 'adopt_pull',
        };
      }
      throw new Error(`unexpected request ${method} ${path}`);
    };

    await Sync.syncNow();
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 0);
    TestRunner.assert.equal(await Storage.getInitialUploadState(user), null);
    TestRunner.assert.equal((await Storage.get('sync_meta', `baseline_${user}`)).value, true);
    TestRunner.assert.ok(await Storage.getSyncCursor(user) >= revision);
    TestRunner.assert.equal((await Storage.getHorse('adopt_complete_horse')).name, 'keep-local');
    TestRunner.assert.equal(Sync._status, Sync.STATUS.SYNCED);

    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });

  t.test('push响应丢失后保留原op_id并以duplicate确认续传', async () => {
    const user = `adopt_retry_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);
    await Storage.put('horses', { id: 'adopt_retry_horse', name: 'retry-local' });
    await Storage.beginInitialUpload(user);
    Auth._userId = user;
    const original = (await Storage.getOutboxBatch(user, 10))[0];
    let calls = 0;
    Auth._fetch = async (path, method, body) => {
      if (path !== '/api/sync/push') throw new Error('unexpected request');
      calls += 1;
      TestRunner.assert.equal(body.changes[0].op_id, original.op_id);
      if (calls === 1) {
        const error = new Error('response lost');
        error.status = 0;
        error.code = 'NETWORK_ERROR';
        throw error;
      }
      return {
        results: [{ op_id: original.op_id, status: 'duplicate', revision: 401 }],
        request_id: 'retry_duplicate',
      };
    };

    let failed = false;
    try { await Sync._pushOutbox(); } catch (_) { failed = true; }
    TestRunner.assert.ok(failed);
    TestRunner.assert.equal((await Storage.getOutboxBatch(user, 10))[0].op_id, original.op_id);
    await Sync._pushOutbox();
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 0);
    TestRunner.assert.equal(calls, 2);
    TestRunner.assert.ok(await Storage.getInitialUploadState(user), 'baseline前pending仍应保留');

    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });
  t.test('扫描约30%中断必须整笔回滚，刷新重入后完整且无重复', async () => {
    const user = `adopt_scan_crash_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);
    for (let i = 0; i < 10; i++) {
      await Storage._putRaw('horses', { id: `scan_crash_${i}`, name: `horse-${i}` });
    }

    const originalCheck = Storage.isSyncableRecord;
    let scanned = 0;
    Storage.isSyncableRecord = function(module, record) {
      scanned += 1;
      if (scanned === 4) throw new Error('simulated scan crash at 30%');
      return originalCheck.call(this, module, record);
    };
    let failed = false;
    try { await Storage.beginInitialUpload(user); } catch (_) { failed = true; }
    finally { Storage.isSyncableRecord = originalCheck; }

    TestRunner.assert.ok(failed);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), null);
    TestRunner.assert.equal(await Storage.getInitialUploadState(user), null);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 0);
    TestRunner.assert.equal((await Storage.getAll('horses')).filter(h => h.id.startsWith('scan_crash_')).length, 10);

    const resumed = await Storage.beginInitialUpload(user);
    TestRunner.assert.equal(resumed.status, 'pending');
    TestRunner.assert.equal(resumed.total_items, 10);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 10);
    const ops = (await Storage.getAll('sync_outbox')).filter(item => item.user_id === user);
    TestRunner.assert.equal(new Set(ops.map(item => item.op_id)).size, 10);
    TestRunner.assert.equal(new Set(ops.map(item => item.record_id)).size, 10);

    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });

  t.test('outbox刚清空但baseline未建立时刷新仍保留pending且不重建op', async () => {
    const user = `adopt_prebaseline_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);
    await Storage._putRaw('horses', { id: 'prebaseline_horse', name: 'accepted-remotely' });
    const state = await Storage.beginInitialUpload(user);
    const queued = (await Storage.getOutboxBatch(user, 10))[0];
    await Storage.removeFromOutbox(user, queued.op_id); // 模拟服务端已接受，响应处理刚清队列。

    Storage._workspaceOwner = null;
    localStorage.removeItem('sync_workspace_owner');
    await Storage._loadWorkspaceOwner();
    const resumed = await Storage.beginInitialUpload(user);

    TestRunner.assert.equal(resumed.adoption_id, state.adoption_id);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 0);
    TestRunner.assert.equal(await Storage.completeInitialUpload(user), false);
    TestRunner.assert.ok(await Storage.getInitialUploadState(user));
    await Storage.put('sync_meta', { key: `baseline_${user}`, value: true });
    TestRunner.assert.equal(await Storage.completeInitialUpload(user), true);
    TestRunner.assert.equal(await Storage.getInitialUploadState(user), null);

    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });
});


TestRunner.suite('Sync Push — 协议错误终止', (t) => {
  t.test('响应缺少请求op_id时应立即终止且保留队首', async () => {
    const user = `poison_push_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);
    await Storage.put('horses', { id: 'poison_horse', name: 'keep-in-outbox' });
    await Storage.beginInitialUpload(user);
    Auth._userId = user;
    let calls = 0;
    Auth._fetch = async () => { calls += 1; return { results: [], request_id: 'missing_result' }; };

    let error = null;
    try { await Sync._pushOutbox(); } catch (caught) { error = caught; }
    TestRunner.assert.ok(error);
    TestRunner.assert.equal(error.code, 'PUSH_RESULT_OP_MISSING');
    TestRunner.assert.equal(error.nonRetryable, true);
    TestRunner.assert.equal(error.failedOperations.length, 1);
    TestRunner.assert.equal(error.failedOperations[0].record_id, 'poison_horse');
    TestRunner.assert.equal(calls, 1);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 1);

    error.requestId = 'missing_result';
    await Storage.setSyncError(user, error);
    const savedError = await Storage.get('sync_meta', `last_error_${user}`);
    TestRunner.assert.equal(savedError.value.request_id, 'missing_result');
    TestRunner.assert.equal(savedError.value.failed_operations[0].record_id, 'poison_horse');
    let statusEl = document.getElementById('menu-sync-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'menu-sync-status';
      document.body.appendChild(statusEl);
    }
    UIAuth.updateSyncStatus(Sync.STATUS.ERROR, error);
    const statusText = statusEl.textContent || '';
    TestRunner.assert.ok(statusText.includes('horses:poison_horse'));
    TestRunner.assert.ok(statusText.includes('missing_result'));

    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });
});


TestRunner.suite('Sync Kill Switch — 本地优先', (t) => {
  t.test('429应遵守Retry-After并限制最长等待', async () => {
    TestRunner.assert.equal(Sync._getRetryDelay({ status: 429, retryAfter: '7' }), 7000);
    TestRunner.assert.equal(Sync._getRetryDelay({ status: 429, retryAfter: '120' }), 60000);
    Sync._retryCount = 2;
    TestRunner.assert.equal(Sync._getRetryDelay({ status: 500 }), 10000);
    Sync._retryCount = 0;
  });

  t.test('关闭时零请求且保留CRUD/outbox/cursor，重开沿原op_id续传', async () => {
    const user = `kill_switch_${Date.now()}`;
    await InitialUploadTestHelpers.clearUserData();
    await InitialUploadTestHelpers.reset(user);
    await Storage.setWorkspaceOwner(user);
    await Storage.setSyncCursor(user, 77);
    Auth._userId = user;
    Sync._stopped = false;

    let calls = 0;
    let pushedOpId = null;
    Auth._fetch = async (path, method, body) => {
      calls += 1;
      if (path === '/api/sync/push') {
        pushedOpId = body.changes[0].op_id;
        return {
          results: body.changes.map(change => ({
            op_id: change.op_id, status: 'accepted', revision: 88,
          })),
          request_id: 'kill_switch_push',
        };
      }
      if (path.startsWith('/api/sync/pull')) {
        return {
          changes: [], next_cursor: 88, has_more: false,
          min_available_revision: 88, reset_required: false,
          request_id: 'kill_switch_pull',
        };
      }
      throw new Error(`unexpected request ${method} ${path}`);
    };

    Sync.setEnabled(false);
    await Storage.saveHorse({ id: 'kill_switch_horse', name: 'saved-locally' });
    const queued = (await Storage.getOutboxBatch(user, 10))[0];
    TestRunner.assert.ok(queued?.op_id);
    await Sync.syncNow();

    TestRunner.assert.equal(calls, 0);
    TestRunner.assert.equal(Sync._status, Sync.STATUS.DISABLED);
    TestRunner.assert.equal(Storage.getWorkspaceOwner(), user);
    TestRunner.assert.equal(await Storage.getSyncCursor(user), 77);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 1);
    TestRunner.assert.equal((await Storage.getHorse('kill_switch_horse')).name, 'saved-locally');

    Sync.setEnabled(true);
    await Sync.syncNow();
    TestRunner.assert.equal(pushedOpId, queued.op_id);
    TestRunner.assert.equal(calls, 2);
    TestRunner.assert.equal(await Storage.getOutboxCount(user), 0);
    TestRunner.assert.equal(await Storage.getSyncCursor(user), 88);
    TestRunner.assert.equal(Sync._status, Sync.STATUS.SYNCED);

    Sync.setEnabled(true);
    await InitialUploadTestHelpers.reset(user);
    await InitialUploadTestHelpers.clearUserData();
  });
});


TestRunner.suite('Auth UI — 可见性与翻译', (t) => {
  t.test('中文登录、注册和横幅按钮应显示可操作UI而非翻译键', async () => {
    const originalLang = I18N.getLang();
    const fixture = document.createElement('div');
    fixture.innerHTML = '<nav id="main-nav"></nav><div id="nav-user-btn"></div>';
    document.body.appendChild(fixture);
    localStorage.removeItem('sync_banner_dismissed');

    try {
      I18N.setLang('zh');
      Auth._userId = null;
      UIAuth.renderNavButton();
      const loginButton = document.querySelector('#nav-user-btn button');
      TestRunner.assert.equal(loginButton.textContent.trim(), '登录');

      loginButton.click();
      let modal = document.getElementById('auth-modal');
      TestRunner.assert.ok(modal, '点击登录应创建Modal');
      TestRunner.assert.equal(modal.style.display, 'flex');
      TestRunner.assert.equal(modal.getAttribute('role'), 'dialog');
      TestRunner.assert.equal(modal.getAttribute('aria-modal'), 'true');
      TestRunner.assert.equal(modal.getAttribute('aria-labelledby'), 'auth-modal-title');
      TestRunner.assert.equal(modal.querySelector('h3').textContent.trim(), '登录');
      TestRunner.assert.equal(modal.querySelector('#auth-username').placeholder, '用户名');
      modal.querySelector('#auth-submit').click();
      TestRunner.assert.equal(document.getElementById('auth-error').textContent, '请填写所有字段');

      modal.querySelector('.auth-switch a').click();
      modal = document.getElementById('auth-modal');
      TestRunner.assert.equal(modal.querySelector('h3').textContent.trim(), '注册');
      TestRunner.assert.equal(modal.style.display, 'flex');
      UIAuth._closeAuthModal();

      UIAuth._showBanner();
      const banner = document.getElementById('sync-banner');
      TestRunner.assert.ok(banner.textContent.includes('注册账号可将数据同步到云端，多设备使用'));
      TestRunner.assert.ok(!banner.textContent.includes('banner_msg'));
      const buttons = banner.querySelectorAll('button');
      TestRunner.assert.equal(buttons[0].textContent.trim(), '注册');
      TestRunner.assert.equal(buttons[1].textContent.trim(), '不再提示');
      buttons[0].click();
      TestRunner.assert.equal(document.getElementById('auth-modal').style.display, 'flex');
      UIAuth._closeAuthModal();
      buttons[1].click();
      TestRunner.assert.equal(document.getElementById('sync-banner'), null);
    } finally {
      UIAuth._closeAuthModal();
      document.getElementById('sync-banner')?.remove();
      fixture.remove();
      localStorage.removeItem('sync_banner_dismissed');
      I18N.setLang(originalLang);
    }
  });
});
