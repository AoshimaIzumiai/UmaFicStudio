/**
 * R5 账号与云同步管理 UI 浏览器回归。
 * 所有云端调用均使用本地 mock，不连接生产 API。
 */
'use strict';

TestRunner.suite('R5 Account & Sync UI', (t) => {
  const delay = () => new Promise(resolve => setTimeout(resolve, 0));

  function saveMethods(target, names) {
    const saved = {};
    for (const name of names) saved[name] = target[name];
    return () => { for (const [name, value] of Object.entries(saved)) target[name] = value; };
  }

  t.test('账号设置使用可访问Modal并转义账号文本', async () => {
    const restore = saveMethods(Auth, ['isLoggedIn', 'fetchAccountInfo']);
    Auth.isLoggedIn = () => true;
    Auth.fetchAccountInfo = async () => ({
      id: 'local-r5-user',
      username: '<img src=x onerror=alert(1)>',
      created_at: '2026-08-30T00:00:00',
    });
    try {
      await UIAuth.showSettings();
      const modal = document.getElementById('account-settings-modal');
      TestRunner.assert.ok(modal);
      TestRunner.assert.equal(modal.style.display, 'flex');
      TestRunner.assert.equal(modal.getAttribute('role'), 'dialog');
      TestRunner.assert.equal(modal.getAttribute('aria-modal'), 'true');
      TestRunner.assert.equal(modal.querySelector('#account-username img'), null);
      TestRunner.assert.ok(modal.querySelector('#account-username').textContent.includes('<img'));
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled])')]
        .filter(element => element.getClientRects().length > 0);
      focusable[focusable.length - 1].focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      TestRunner.assert.equal(document.activeElement, focusable[0]);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      TestRunner.assert.equal(document.getElementById('account-settings-modal'), null);
    } finally {
      UIAuth._closeR5Modal('account-settings-modal');
      restore();
    }
  });

  t.test('修改密码执行本地校验并调用Auth封装', async () => {
    const restore = saveMethods(Auth, ['isLoggedIn', 'fetchAccountInfo', 'changePassword']);
    let called = null;
    Auth.isLoggedIn = () => true;
    Auth.fetchAccountInfo = async () => ({ username: 'r5-user', created_at: '2026-08-30T00:00:00Z' });
    Auth.changePassword = async (oldPassword, newPassword) => { called = { oldPassword, newPassword }; };
    try {
      await UIAuth.showSettings();
      document.getElementById('account-old-password').value = 'old123';
      document.getElementById('account-new-password').value = 'weak';
      document.getElementById('account-confirm-password').value = 'weak';
      await UIAuth._changePassword();
      TestRunner.assert.equal(called, null);
      TestRunner.assert.ok(document.getElementById('account-password-status').textContent.length > 0);

      document.getElementById('account-new-password').value = 'newPass123';
      document.getElementById('account-confirm-password').value = 'newPass123';
      await UIAuth._changePassword();
      TestRunner.assert.deepEqual(called, { oldPassword: 'old123', newPassword: 'newPass123' });
      TestRunner.assert.ok(document.getElementById('account-password-status').textContent.includes(I18N.t('password_changed')));
    } finally {
      UIAuth._closeR5Modal('account-settings-modal');
      restore();
    }
  });

  t.test('同步详情汇总本地队列、错误与云端用量且不注入HTML', async () => {
    const restoreAuth = saveMethods(Auth, ['isLoggedIn', 'getUserId', 'fetchSyncStatus']);
    const restoreStorage = saveMethods(Storage, ['getLastSyncedAt', 'getOutboxCount', 'getSyncError']);
    Auth.isLoggedIn = () => true;
    Auth.getUserId = () => 'r5-sync-user';
    Auth.fetchSyncStatus = async () => ({ total_size_bytes: 512, quota_bytes: 1024, modules: {} });
    Storage.getLastSyncedAt = async () => 1700000000000;
    Storage.getOutboxCount = async () => 2;
    Storage.getSyncError = async () => ({
      code: 'CONFLICT', request_id: 'req-r5',
      failed_operations: [{ module: 'horses', record_id: '<img src=x onerror=alert(1)>' }],
    });
    const previousStatus = Sync._status;
    Sync._status = Sync.STATUS.ERROR;
    try {
      await UIAuth.showSyncDetail();
      const modal = document.getElementById('sync-detail-modal');
      TestRunner.assert.ok(modal.textContent.includes('2'));
      TestRunner.assert.ok(modal.textContent.includes('50'));
      TestRunner.assert.ok(modal.textContent.includes('req-r5'));
      TestRunner.assert.equal(modal.querySelector('.r5-failed-list img'), null);
    } finally {
      Sync._status = previousStatus;
      UIAuth._closeR5Modal('sync-detail-modal');
      restoreStorage();
      restoreAuth();
    }
  });

  t.test('回收站分页、剩余时间与恢复使用服务端delete_revision', async () => {
    const restoreAuth = saveMethods(Auth, ['isLoggedIn', 'fetchTrash', 'restoreRecord']);
    const restoreSync = saveMethods(Sync, ['syncNow']);
    const originalConfirm = window.confirm;
    let trashCalls = 0;
    let restored = null;
    Auth.isLoggedIn = () => true;
    Auth.fetchTrash = async (_module, cursor) => {
      trashCalls += 1;
      if (!cursor) return {
        items: [{
          id: 'trash-1', module: 'horses', delete_revision: 77,
          deleted_at: '2026-08-30T00:00:00', expires_at: '2099-08-30T00:00:00',
          data: { name_cn: '<img src=x onerror=alert(1)>' },
        }],
        next_cursor: 77, has_more: true,
      };
      return { items: [], next_cursor: 77, has_more: false };
    };
    Auth.restoreRecord = async (...args) => { restored = args; return { revision: 78 }; };
    Sync.syncNow = async () => true;
    window.confirm = () => true;
    try {
      await UIAuth.showTrash();
      const modal = document.getElementById('trash-modal');
      TestRunner.assert.equal(modal.querySelector('.trash-item img'), null);
      TestRunner.assert.ok(modal.textContent.includes('<img'));
      TestRunner.assert.ok(!document.getElementById('trash-load-more').classList.contains('hidden'));
      await UIAuth._loadTrash(false);
      TestRunner.assert.equal(trashCalls, 2);
      await UIAuth._restoreTrash(0);
      TestRunner.assert.deepEqual(restored, ['horses', 'trash-1', 77]);
      TestRunner.assert.ok(modal.textContent.includes(I18N.t('trash_empty')));
    } finally {
      window.confirm = originalConfirm;
      UIAuth._closeR5Modal('trash-modal');
      restoreSync();
      restoreAuth();
    }
  });

  t.test('云端导出核对条数并生成可重新导入格式', async () => {
    const restoreAuth = saveMethods(Auth, ['isLoggedIn', 'fetchSyncStatus', 'fetchCloudExport']);
    const originalDownload = UIAuth._downloadJson;
    let downloaded = null;
    Auth.isLoggedIn = () => true;
    Auth.fetchSyncStatus = async () => ({ modules: { horses: { count: 1 }, races: { count: 0 } } });
    Auth.fetchCloudExport = async () => ({
      version: '1.0', exported_at: '2026-08-30T00:00:00Z',
      modules: { horses: [{ id: 'cloud-h1', data: { name_en: 'Safe Horse' } }], races: [] },
    });
    UIAuth._downloadJson = (data, filename) => { downloaded = { data, filename }; };
    try {
      UIAuth.showCloudExport();
      await UIAuth._runCloudExport();
      TestRunner.assert.ok(downloaded);
      TestRunner.assert.equal(downloaded.data.export_version, ExportImport.EXPORT_VERSION);
      TestRunner.assert.equal(downloaded.data.horses[0].id, 'cloud-h1');
      TestRunner.assert.ok(downloaded.filename.endsWith('.json'));
      TestRunner.assert.equal(document.getElementById('cloud-export-progress').value, 100);
      TestRunner.assert.ok(document.getElementById('cloud-export-status').textContent.includes('(1)'));
    } finally {
      UIAuth._downloadJson = originalDownload;
      UIAuth._closeR5Modal('cloud-export-modal');
      restoreAuth();
    }
  });

  t.test('云端导出条数不一致时禁止下载', async () => {
    const restoreAuth = saveMethods(Auth, ['isLoggedIn', 'fetchSyncStatus', 'fetchCloudExport']);
    const originalDownload = UIAuth._downloadJson;
    let downloadCount = 0;
    Auth.isLoggedIn = () => true;
    Auth.fetchSyncStatus = async () => ({ modules: { horses: { count: 2 } } });
    Auth.fetchCloudExport = async () => ({ modules: { horses: [{ id: 'one', data: { name_en: 'One' } }] } });
    UIAuth._downloadJson = () => { downloadCount += 1; };
    try {
      UIAuth.showCloudExport();
      await UIAuth._runCloudExport();
      TestRunner.assert.equal(downloadCount, 0);
      TestRunner.assert.equal(document.getElementById('cloud-export-progress').value, 0);
      TestRunner.assert.ok(document.getElementById('cloud-export-status').classList.contains('r5-status-error'));
    } finally {
      UIAuth._downloadJson = originalDownload;
      UIAuth._closeR5Modal('cloud-export-modal');
      restoreAuth();
    }
  });

  t.test('Press 页面包含仅本地保存的可访问提示与双语键', async () => {
    const [html, i18nSource] = await Promise.all([
      fetch('../press/index.html').then(response => response.text()),
      fetch('../press/js/press-i18n.js').then(response => response.text()),
    ]);
    TestRunner.assert.ok(html.includes('id="press-local-only"'));
    TestRunner.assert.ok(html.includes('role="status"'));
    TestRunner.assert.ok(i18nSource.includes("localOnly: 'Press 文章仅保存在本设备浏览器，不参与云端同步'"));
    TestRunner.assert.ok(i18nSource.includes('Press articles are stored only in this browser'));
  });

  t.test('320px移动端样式与Modal关键ARIA存在', async () => {
    const css = await fetch('../css/style.css').then(response => response.text());
    TestRunner.assert.ok(css.includes('@media (max-width: 320px)'));
    TestRunner.assert.ok(css.includes('.r5-modal-content'));
    const source = await fetch('../js/ui-auth.js').then(response => response.text());
    TestRunner.assert.ok(source.includes("setAttribute('aria-modal', 'true')"));
    TestRunner.assert.ok(source.includes("event.key === 'Escape'"));
  });
});
