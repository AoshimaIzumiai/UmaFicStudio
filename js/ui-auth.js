/**
 * ui-auth.js — 认证 UI 模块
 * 导航栏用户按钮、登录/注册 Modal、同步状态、Toast、账号设置、横幅
 */
'use strict';

const UIAuth = {
  _toastTimer: null,
  _toastLimitTimer: null,
  _lastToastTime: 0,

  // === 初始化 ===

  init() {
    this.renderNavButton();
    this.renderSettingsMenu();
    this._checkBanner();
  },

  // === 导航栏用户按钮 ===

  renderNavButton() {
    const container = document.getElementById('nav-user-btn');
    if (!container) return;

    if (Auth.isLoggedIn()) {
      const user = Auth.getUser();
      const name = user ? Utils.escapeHtml(user.username) : '用户';
      container.innerHTML = `
        <button class="nav-btn nav-user-logged" onclick="UIAuth.toggleUserMenu()">
          <span class="sync-dot" id="sync-dot"></span>
          <span class="user-name">${name}</span>
        </button>
        <div class="dropdown-menu user-menu hidden" id="user-menu" role="menu" aria-label="${I18N.t('settings_title','账号设置')}">
          <div class="menu-status" id="menu-sync-status">同步状态加载中...</div>
          <button role="menuitem" onclick="UIAuth._onSyncNow()">立即同步</button>
          <button role="menuitem" onclick="UIAuth.showSyncDetail()">${I18N.t('sync_detail_title','同步详情')}</button>
          <button role="menuitem" onclick="UIAuth.showTrash()">${I18N.t('trash_title','回收站')}</button>
          <button role="menuitem" onclick="UIAuth.showCloudExport()">${I18N.t('cloud_export_btn','导出云端数据（JSON）')}</button>
          <button role="menuitem" onclick="UIAuth.showSettings()">${I18N.t('settings_title','账号设置')}</button>
          <button role="menuitem" onclick="UIAuth._onLogout()">${I18N.t('logout_btn','退出登录')}</button>
        </div>`;
    } else {
      container.innerHTML = `
        <button class="nav-btn" onclick="UIAuth.showLoginModal()">${I18N.t('login', '登录')}</button>`;
    }
  },

  toggleUserMenu() {
    const menu = document.getElementById('user-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
    // 点击外部关闭
    if (!menu.classList.contains('hidden')) {
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target) && !e.target.closest('.nav-user-logged')) {
            menu.classList.add('hidden');
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    }
  },

  // === ⚙️ 设置菜单 ===

  renderSettingsMenu() {
    const container = document.getElementById('nav-settings');
    if (!container) return;
    container.innerHTML = `
      <button class="nav-btn" onclick="UIAuth.toggleSettingsMenu()">⚙️</button>
      <div class="dropdown-menu settings-menu hidden" id="settings-menu">
        <button onclick="I18N.setLang(I18N.getLang()==='zh'?'en':'zh');App._applyI18n();App.updateModeButton();UIAuth.init()">🌐 ${I18N.t('lang_switch', '语言')}</button>
        <button onclick="App.cycleNameLang()">名 ${I18N.t('name_display', '马名显示')}</button>
        <button onclick="App.showHelp()">ℹ️ ${I18N.t('help', '帮助')}</button>
      </div>`;
  },

  toggleSettingsMenu() {
    const menu = document.getElementById('settings-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
    if (!menu.classList.contains('hidden')) {
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target) && !e.target.closest('#nav-settings')) {
            menu.classList.add('hidden');
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    }
  },

  // === 同步状态 ===

  updateSyncStatus(status, error = null) {
    const dot = document.getElementById('sync-dot');
    const statusEl = document.getElementById('menu-sync-status');
    if (dot) {
      dot.className = 'sync-dot sync-' + status;
    }
    if (statusEl) {
      const labels = {
        idle: '就绪', syncing: '同步中...', synced: '已同步 ✓',
        offline: '⚠ 离线', partial: '部分同步失败', error: '同步出错', disabled: '同步不可用'
      };
      let label = labels[status] || status;
      if (error && (status === 'error' || status === 'partial')) {
        const operations = Array.isArray(error.failedOperations) ? error.failedOperations : [];
        if (operations.length) {
          const shown = operations.slice(0, 3).map(item =>
            `${item.module || '?'}:${item.record_id || item.op_id || '?'}`
          );
          label += ` — ${shown.join(', ')}`;
          if (operations.length > shown.length) label += ` 等${operations.length}项`;
        }
        if (error.requestId) label += `（请求 ${error.requestId}）`;
      }
      statusEl.textContent = label;
      statusEl.title = label;
    }
  },

  // === Toast ===

  showToast(message, type = 'success') {
    // 限频：自动同步成功最多 30 秒一次
    if (type === 'success') {
      const now = Date.now();
      if (now - this._lastToastTime < 30000) return;
      this._lastToastTime = now;
    }

    let toast = document.getElementById('sync-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sync-toast';
      toast.className = 'sync-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `sync-toast toast-${type} toast-show`;

    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('toast-show');
    }, 3000);
  },

  // === 登录/注册 Modal ===

  showLoginModal() {
    this._showAuthModal('login');
  },

  showRegisterModal() {
    this._showAuthModal('register');
  },

  _closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
    const returnFocus = modal._returnFocus;
    modal.remove();
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  },

  _showAuthModal(mode) {
    this._closeAuthModal();

    const modal = document.createElement('div');
    modal.id = 'auth-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'auth-modal-title');
    modal._returnFocus = document.activeElement;
    modal.onclick = (e) => { if (e.target === modal) this._closeAuthModal(); };

    if (mode === 'login') {
      modal.innerHTML = `
        <div class="modal-content auth-modal-content">
          <h3 id="auth-modal-title">${I18N.t('login', '登录')}</h3>
          <div class="auth-error hidden" id="auth-error" role="alert" aria-live="polite"></div>
          <input type="text" id="auth-username" placeholder="${I18N.t('username', '用户名')}" autocomplete="username" aria-label="${I18N.t('username', '用户名')}">
          <input type="password" id="auth-password" placeholder="${I18N.t('password', '密码')}" autocomplete="current-password" aria-label="${I18N.t('password', '密码')}">
          <button class="btn btn-primary" id="auth-submit" onclick="UIAuth._doLogin()">${I18N.t('login', '登录')}</button>
          <p class="auth-switch">${I18N.t('no_account', '没有账号？')} <a href="#" onclick="UIAuth._showAuthModal('register');return false">${I18N.t('register', '注册')}</a></p>
          <p class="auth-forgot">${I18N.t('forgot_password', '忘记密码？')} <a href="https://github.com/AoshimaIzumiai/UmaFicStudio/issues" target="_blank">${I18N.t('contact_dev', '联系开发者')}</a> / QQ: 2233504794</p>
        </div>`;
    } else {
      modal.innerHTML = `
        <div class="modal-content auth-modal-content">
          <h3 id="auth-modal-title">${I18N.t('register', '注册')}</h3>
          <div class="auth-error hidden" id="auth-error" role="alert" aria-live="polite"></div>
          <input type="text" id="auth-username" placeholder="${I18N.t('username', '用户名')}（2~20字符）" autocomplete="username" aria-label="${I18N.t('username', '用户名')}">
          <input type="password" id="auth-password" placeholder="${I18N.t('password', '密码')}（6位以上，含字母和数字）" autocomplete="new-password" aria-label="${I18N.t('password', '密码')}">
          <input type="password" id="auth-password2" placeholder="${I18N.t('confirm_password', '确认密码')}" autocomplete="new-password" aria-label="${I18N.t('confirm_password', '确认密码')}">
          <button class="btn btn-primary" id="auth-submit" onclick="UIAuth._doRegister()">${I18N.t('register', '注册')}</button>
          <p class="auth-switch">${I18N.t('has_account', '已有账号？')} <a href="#" onclick="UIAuth._showAuthModal('login');return false">${I18N.t('login', '登录')}</a></p>
        </div>`;
    }

    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('auth-username')?.focus(), 100);
    modal._escHandler = (e) => { if (e.key === 'Escape') this._closeAuthModal(); };
    document.addEventListener('keydown', modal._escHandler);
  },

  async _doLogin() {
    const username = document.getElementById('auth-username')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    if (!username || !password) return this._showAuthError(I18N.t('fill_all', '请填写所有字段'));

    const btn = document.getElementById('auth-submit');
    btn.disabled = true;
    btn.textContent = '...';

    try {
      const result = await Auth.login(username, password);
      this._closeAuthModal();

      if (result.workspaceConflict) {
        this._showWorkspaceConflict(result.workspaceConflict);
      } else {
        this._onLoginSuccess();
      }
    } catch (e) {
      const msg = e.code === 'CREDENTIALS_INVALID' ? I18N.t('login_failed', '用户名或密码错误')
                : e.code === 'TIMEOUT' ? I18N.t('timeout', '请求超时，请重试')
                : e.message;
      this._showAuthError(msg);
      btn.disabled = false;
      btn.textContent = I18N.t('login', '登录');
    }
  },

  async _doRegister() {
    const username = document.getElementById('auth-username')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    const password2 = document.getElementById('auth-password2')?.value;

    if (!username || !password || !password2) return this._showAuthError(I18N.t('fill_all', '请填写所有字段'));
    if (password !== password2) return this._showAuthError(I18N.t('password_mismatch', '两次密码不一致'));
    if (password.length < 6) return this._showAuthError(I18N.t('password_short', '密码至少6位'));
    if (!/[a-zA-Z]/.test(password)) return this._showAuthError(I18N.t('password_need_letter', '密码需包含字母'));
    if (!/[0-9]/.test(password)) return this._showAuthError(I18N.t('password_need_number', '密码需包含数字'));

    const btn = document.getElementById('auth-submit');
    btn.disabled = true;
    btn.textContent = '...';

    try {
      await Auth.register(username, password);
      this._closeAuthModal();
      this._onLoginSuccess();
      this.showToast(I18N.t('register_success', '注册成功'), 'success');
    } catch (e) {
      const msg = e.code === 'USERNAME_EXISTS' ? I18N.t('username_taken', '用户名已被注册')
                : e.code === 'TIMEOUT' ? I18N.t('timeout', '请求超时，请重试')
                : e.message;
      this._showAuthError(msg);
      btn.disabled = false;
      btn.textContent = I18N.t('register', '注册');
    }
  },

  _showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
    }
  },

  _onLoginSuccess() {
    this.renderNavButton();
    this._dismissBanner();
    if (typeof Sync !== 'undefined') Sync.init();
  },

  _onLogout() {
    Auth.logout();
    this.renderNavButton();
    this.updateSyncStatus('idle');
    document.getElementById('user-menu')?.classList.add('hidden');
  },

  // === Workspace 冲突 ===

  _showWorkspaceConflict(type) {
    const modal = document.createElement('div');
    modal.id = 'workspace-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';

    if (type === 'anonymous_with_data') {
      modal.innerHTML = `
        <div class="modal-content">
          <h3>${I18N.t('workspace_conflict', '本地数据处理')}</h3>
          <p>${I18N.t('workspace_anon_msg', '检测到本地已有数据。请选择如何处理：')}</p>
          <div class="modal-options">
            <button class="btn btn-primary" onclick="UIAuth._resolveWorkspace('merge')">
              ${I18N.t('merge_local', '上传本地数据到云端')}
            </button>
            <button class="btn btn-secondary" onclick="UIAuth._resolveWorkspace('cloud')">
              ${I18N.t('use_cloud', '备份后使用云端数据')}
            </button>
            <button class="btn btn-secondary" onclick="UIAuth._resolveWorkspace('cancel')">
              ${I18N.t('cancel', '取消')}
            </button>
          </div>
        </div>`;
    } else {
      // other_account
      modal.innerHTML = `
        <div class="modal-content">
          <h3>${I18N.t('workspace_conflict', '本地数据归属冲突')}</h3>
          <p>${I18N.t('workspace_other_msg', '本地数据属于其他账号。为安全起见，不能直接合并。')}</p>
          <div class="modal-options">
            <button class="btn btn-primary" onclick="UIAuth._resolveWorkspace('cloud')">
              ${I18N.t('backup_and_switch', '备份本地后切换到云端')}
            </button>
            <button class="btn btn-secondary" onclick="UIAuth._resolveWorkspace('cancel')">
              ${I18N.t('cancel', '取消')}
            </button>
          </div>
          <p class="auth-forgot">${I18N.t('workspace_tip', '如需迁移数据，请先导出 JSON 再在新账号中导入。')}</p>
        </div>`;
    }

    document.body.appendChild(modal);
  },

  async _resolveWorkspace(choice) {
    document.getElementById('workspace-modal')?.remove();
    if (choice === 'cancel') {
      Auth.cancelLogin();
      this.renderNavButton();
      return;
    }
    try {
      if (choice === 'merge') {
        await Auth.mergeLocalToCloud();
      } else {
        await Auth.switchToCloudWorkspace();
      }
      this._onLoginSuccess();
    } catch (e) {
      this.showToast(I18N.t('workspace_error', '操作失败：') + e.message, 'error');
      Auth.cancelLogin();
      this.renderNavButton();
    }
  },

  // === 注册提醒横幅 ===

  _checkBanner() {
    if (Auth.isLoggedIn()) return;
    if (Storage.getWorkspaceOwner()) return; // 已绑定账号的设备
    if (localStorage.getItem('sync_banner_dismissed')) return;

    // 延迟检查本地是否有数据
    setTimeout(async () => {
      if (Auth.isLoggedIn()) return;
      const hasData = await Auth._hasLocalUserData();
      if (hasData) this._showBanner();
    }, 3000);
  },

  _showBanner() {
    if (document.getElementById('sync-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sync-banner';
    banner.className = 'sync-banner';
    banner.innerHTML = `
      <span>💡 ${I18N.t('banner_msg', '注册账号可将数据同步到云端，多设备使用')}</span>
      <button class="btn btn-primary btn-sm" onclick="UIAuth.showRegisterModal()">${I18N.t('register', '注册')}</button>
      <button class="btn btn-secondary btn-sm" onclick="UIAuth._dismissBanner()">${I18N.t('dismiss', '不再提示')}</button>
    `;
    const nav = document.getElementById('main-nav');
    if (nav) nav.after(banner);
  },

  _dismissBanner() {
    document.getElementById('sync-banner')?.remove();
    localStorage.setItem('sync_banner_dismissed', '1');
  },

  // === R5 通用 Modal ===

  _escape(value) {
    if (typeof Utils !== 'undefined' && typeof Utils.escapeHtml === 'function') {
      return Utils.escapeHtml(String(value ?? ''));
    }
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  },

  _formatDate(value) {
    if (!value) return '—';
    const raw = String(value);
    const hasTimezone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
    const date = new Date(hasTimezone ? raw : `${raw}Z`);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString(I18N.getLang() === 'en' ? 'en-US' : 'zh-CN');
  },

  _openR5Modal(id, title) {
    this._closeR5Modal(id);
    const modal = document.createElement('div');
    const titleId = `${id}-title`;
    modal.id = id;
    modal.className = 'modal-overlay r5-modal-overlay';
    modal.style.display = 'flex';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);
    modal._returnFocus = document.activeElement;
    modal.innerHTML = `
      <div class="modal-content r5-modal-content" tabindex="-1">
        <div class="r5-modal-header">
          <h3 id="${titleId}">${this._escape(title)}</h3>
          <button type="button" class="r5-close" aria-label="${this._escape(I18N.t('close', '关闭'))}" onclick="UIAuth._closeR5Modal('${id}')">×</button>
        </div>
        <div class="r5-modal-body" id="${id}-body"></div>
      </div>`;
    modal.addEventListener('click', event => {
      if (event.target === modal) this._closeR5Modal(id);
    });
    modal._escHandler = event => {
      if (event.key === 'Escape') {
        this._closeR5Modal(id);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', modal._escHandler);
    document.body.appendChild(modal);
    setTimeout(() => modal.querySelector('.r5-modal-content')?.focus(), 0);
    return document.getElementById(`${id}-body`);
  },

  _closeR5Modal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
    const returnFocus = modal._returnFocus;
    modal.remove();
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  },

  _setR5Status(id, message, type = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || '';
    el.className = `r5-inline-status${type ? ` r5-status-${type}` : ''}`;
  },

  _cloudActionAllowed() {
    if (!Auth.isLoggedIn()) {
      this.showToast(I18N.t('not_logged_in_hint', '未登录，数据仅保存在本地。登录后可同步到云端'), 'warning');
      return false;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.showToast(I18N.t('offline_hint', '当前离线，本地编辑仍会保存，联网后自动同步'), 'warning');
      return false;
    }
    return true;
  },

  // === 账号设置 ===

  async showSettings() {
    document.getElementById('user-menu')?.classList.add('hidden');
    if (!Auth.isLoggedIn()) return this.showLoginModal();
    const body = this._openR5Modal('account-settings-modal', I18N.t('settings_title', '账号设置'));
    body.textContent = I18N.t('loading', '加载中...');
    try {
      const account = await Auth.fetchAccountInfo();
      const username = this._escape(account.username);
      const createdAt = this._escape(this._formatDate(account.created_at));
      body.innerHTML = `
        <section class="r5-section" aria-labelledby="account-info-heading">
          <h4 id="account-info-heading">${this._escape(I18N.t('account_info', '账号信息'))}</h4>
          <dl class="r5-detail-list">
            <div><dt>${this._escape(I18N.t('username', '用户名'))}</dt><dd id="account-username">${username}</dd></div>
            <div><dt>${this._escape(I18N.t('reg_time', '注册时间'))}</dt><dd>${createdAt}</dd></div>
          </dl>
        </section>
        <section class="r5-section" aria-labelledby="change-password-heading">
          <h4 id="change-password-heading">${this._escape(I18N.t('change_password_title', '修改密码'))}</h4>
          <label for="account-old-password">${this._escape(I18N.t('old_password', '当前密码'))}</label>
          <input id="account-old-password" type="password" autocomplete="current-password" maxlength="64">
          <label for="account-new-password">${this._escape(I18N.t('new_password', '新密码'))}</label>
          <input id="account-new-password" type="password" autocomplete="new-password" maxlength="64">
          <label for="account-confirm-password">${this._escape(I18N.t('confirm_password', '确认密码'))}</label>
          <input id="account-confirm-password" type="password" autocomplete="new-password" maxlength="64">
          <button type="button" class="btn btn-primary" id="account-change-password" onclick="UIAuth._changePassword()">${this._escape(I18N.t('change_password_btn', '修改密码'))}</button>
          <div id="account-password-status" class="r5-inline-status" role="status" aria-live="polite"></div>
        </section>
        <section class="r5-section r5-danger-zone" aria-labelledby="delete-account-heading">
          <h4 id="delete-account-heading">${this._escape(I18N.t('delete_account_title', '注销账号'))}</h4>
          <p>${this._escape(I18N.t('delete_account_warning', '注销将永久删除云端账号与云端数据（不可恢复）。本地数据会保留在本设备上。'))}</p>
          <label for="delete-account-confirm">${this._escape(I18N.t('delete_account_confirm_label', '请输入用户名以确认注销'))}</label>
          <input id="delete-account-confirm" type="text" autocomplete="off" data-expected-username="${username}">
          <button type="button" class="btn r5-danger-btn" id="delete-account-button" onclick="UIAuth._deleteAccount()">${this._escape(I18N.t('delete_account_btn', '确认注销'))}</button>
          <div id="delete-account-status" class="r5-inline-status" role="status" aria-live="polite"></div>
        </section>
        <div class="r5-modal-actions">
          <button type="button" class="btn btn-secondary" onclick="UIAuth._logoutFromSettings()">${this._escape(I18N.t('logout_btn', '退出登录'))}</button>
          <button type="button" class="btn btn-secondary" onclick="UIAuth._closeR5Modal('account-settings-modal')">${this._escape(I18N.t('close', '关闭'))}</button>
        </div>`;
    } catch (error) {
      body.textContent = error.message || I18N.t('loading', '加载失败');
    }
  },

  async _changePassword() {
    const oldPassword = document.getElementById('account-old-password')?.value || '';
    const newPassword = document.getElementById('account-new-password')?.value || '';
    const confirmPassword = document.getElementById('account-confirm-password')?.value || '';
    if (!oldPassword || !newPassword || !confirmPassword) {
      return this._setR5Status('account-password-status', I18N.t('fill_all', '请填写所有字段'), 'error');
    }
    if (newPassword !== confirmPassword) {
      return this._setR5Status('account-password-status', I18N.t('password_mismatch', '两次密码不一致'), 'error');
    }
    if (newPassword.length < 6) {
      return this._setR5Status('account-password-status', I18N.t('password_short', '密码至少6位'), 'error');
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      return this._setR5Status('account-password-status', I18N.t('password_need_letter', '密码需包含字母'), 'error');
    }
    if (!/[0-9]/.test(newPassword)) {
      return this._setR5Status('account-password-status', I18N.t('password_need_number', '密码需包含数字'), 'error');
    }
    const button = document.getElementById('account-change-password');
    if (button) button.disabled = true;
    this._setR5Status('account-password-status', I18N.t('processing', '处理中...'));
    try {
      await Auth.changePassword(oldPassword, newPassword);
      document.getElementById('account-old-password').value = '';
      document.getElementById('account-new-password').value = '';
      document.getElementById('account-confirm-password').value = '';
      this._setR5Status('account-password-status', I18N.t('password_changed', '密码已修改'), 'success');
    } catch (error) {
      this._setR5Status('account-password-status', error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  },

  async _deleteAccount() {
    const input = document.getElementById('delete-account-confirm');
    const typed = input?.value.trim() || '';
    const expected = input?.dataset.expectedUsername || '';
    if (typed !== expected) {
      return this._setR5Status('delete-account-status', I18N.t('username_mismatch', '用户名不匹配'), 'error');
    }
    if (!window.confirm(I18N.t('confirm_delete_account', '确定要注销账号吗？此操作不可撤销。'))) return;
    const button = document.getElementById('delete-account-button');
    if (button) button.disabled = true;
    try {
      await Auth.deleteAccount(typed);
      this._closeR5Modal('account-settings-modal');
      this.renderNavButton();
      this.updateSyncStatus('idle');
      this.showToast(I18N.t('delete_account_local_kept', '云端账号已删除，本地数据已保留在本设备'), 'success');
    } catch (error) {
      this._setR5Status('delete-account-status', error.message, 'error');
      if (button) button.disabled = false;
    }
  },

  _logoutFromSettings() {
    this._closeR5Modal('account-settings-modal');
    this._onLogout();
  },

  // === 同步状态详情 ===

  async showSyncDetail() {
    document.getElementById('user-menu')?.classList.add('hidden');
    if (!Auth.isLoggedIn()) return this.showLoginModal();
    const body = this._openR5Modal('sync-detail-modal', I18N.t('sync_detail_title', '同步详情'));
    body.textContent = I18N.t('loading', '加载中...');
    const userId = Auth.getUserId();
    try {
      const [lastSyncedAt, outboxCount, lastError] = await Promise.all([
        Storage.getLastSyncedAt(userId),
        Storage.getOutboxCount(userId),
        Storage.getSyncError(userId),
      ]);
      let cloud = null;
      let cloudError = null;
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        try { cloud = await Auth.fetchSyncStatus(); } catch (error) { cloudError = error; }
      }
      const detail = R5Helpers.parseSyncDetail({
        status: typeof Sync !== 'undefined' ? Sync._status : 'idle',
        lastSyncedAt, outboxCount, lastError,
      });
      const failed = detail.failedOperations.length
        ? `<ul class="r5-failed-list">${detail.failedOperations.map(item => `<li>${this._escape(item.module || '?')} · ${this._escape(item.record_id || item.op_id || '?')}</li>`).join('')}</ul>`
        : `<p>${this._escape(I18N.t('no_failed_items', '无失败项'))}</p>`;
      const used = cloud ? R5Helpers.formatBytes(cloud.total_size_bytes) : '—';
      const quota = cloud ? R5Helpers.formatBytes(cloud.quota_bytes) : '—';
      const percent = cloud ? R5Helpers.usagePercent(cloud.total_size_bytes, cloud.quota_bytes) : 0;
      const remoteNote = cloudError ? `<p class="r5-status-error">${this._escape(cloudError.message)}</p>` : '';
      body.innerHTML = `
        <dl class="r5-detail-list">
          <div><dt>${this._escape(I18N.t('sync_detail_title', '同步状态'))}</dt><dd>${this._escape(detail.status)}</dd></div>
          <div><dt>${this._escape(I18N.t('last_synced', '最后成功同步'))}</dt><dd>${detail.lastSyncedAt ? this._escape(new Date(detail.lastSyncedAt).toLocaleString()) : this._escape(I18N.t('never_synced', '尚未成功同步'))}</dd></div>
          <div><dt>${this._escape(I18N.t('outbox_pending', '待上传变更'))}</dt><dd>${detail.outboxCount}</dd></div>
          <div><dt>${this._escape(I18N.t('cloud_usage', '云端用量'))}</dt><dd>${used} / ${quota} (${percent}%)</dd></div>
        </dl>
        <progress class="r5-usage-progress" max="100" value="${percent}" aria-label="${this._escape(I18N.t('cloud_usage', '云端用量'))}"></progress>
        ${remoteNote}
        <section class="r5-section"><h4>${this._escape(I18N.t('failed_items', '失败项'))}</h4>${failed}
          ${detail.requestId ? `<p class="r5-request-id">${this._escape(I18N.t('request_id_label', '请求 ID'))}: ${this._escape(detail.requestId)}</p>` : ''}
        </section>
        <div class="r5-modal-actions">
          <button type="button" class="btn btn-secondary" onclick="UIAuth.showSyncDetail()">${I18N.getLang() === 'en' ? 'Refresh' : '刷新'}</button>
          <button type="button" class="btn btn-secondary" onclick="UIAuth._closeR5Modal('sync-detail-modal')">${this._escape(I18N.t('close', '关闭'))}</button>
        </div>`;
    } catch (error) {
      body.textContent = error.message;
    }
  },

  // === 回收站 ===

  async showTrash() {
    document.getElementById('user-menu')?.classList.add('hidden');
    if (!this._cloudActionAllowed()) return;
    const body = this._openR5Modal('trash-modal', I18N.t('trash_title', '回收站'));
    const modules = (typeof Sync !== 'undefined' && Array.isArray(Sync.MODULES)) ? Sync.MODULES : R5Helpers.LOCAL_ARRAY_FIELDS;
    body.innerHTML = `
      <label for="trash-module-filter">${this._escape(I18N.t('trash_module', '模块'))}</label>
      <select id="trash-module-filter" onchange="UIAuth._changeTrashModule(this.value)">
        <option value="">${this._escape(I18N.t('trash_all_modules', '全部模块'))}</option>
        ${modules.map(module => `<option value="${this._escape(module)}">${this._escape(module)}</option>`).join('')}
      </select>
      <p class="r5-impact-note">${this._escape(I18N.t('restore_impact_note', '恢复后该记录会重新出现；引用它的其他记录关联关系将随之恢复'))}</p>
      <div id="trash-list" aria-live="polite"></div>
      <div class="r5-modal-actions">
        <button type="button" class="btn btn-secondary hidden" id="trash-load-more" onclick="UIAuth._loadTrash(false)">${this._escape(I18N.t('load_more', '加载更多'))}</button>
        <button type="button" class="btn btn-secondary" onclick="UIAuth._closeR5Modal('trash-modal')">${this._escape(I18N.t('close', '关闭'))}</button>
      </div>`;
    await this._changeTrashModule('');
  },

  async _changeTrashModule(module) {
    this._trashState = { module: module || null, cursor: 0, hasMore: false, items: [] };
    await this._loadTrash(true);
  },

  async _loadTrash(reset = false) {
    const list = document.getElementById('trash-list');
    if (!list || !this._trashState) return;
    if (reset) list.textContent = I18N.t('loading', '加载中...');
    const loadMore = document.getElementById('trash-load-more');
    if (loadMore) loadMore.disabled = true;
    try {
      const page = await Auth.fetchTrash(this._trashState.module, this._trashState.cursor, 20);
      this._trashState.items.push(...(Array.isArray(page.items) ? page.items : []));
      this._trashState.cursor = Number(page.next_cursor) || this._trashState.cursor;
      this._trashState.hasMore = !!page.has_more;
      this._renderTrash();
    } catch (error) {
      list.textContent = error.message;
    } finally {
      if (loadMore) loadMore.disabled = false;
    }
  },

  _renderTrash() {
    const list = document.getElementById('trash-list');
    const loadMore = document.getElementById('trash-load-more');
    if (!list || !this._trashState) return;
    if (!this._trashState.items.length) {
      list.textContent = I18N.t('trash_empty', '回收站为空');
    } else {
      list.innerHTML = this._trashState.items.map((item, index) => {
        const data = item && typeof item.data === 'object' ? item.data : {};
        const label = data.name_cn || data.name_ja || data.name_en || data.name || item.id;
        const remaining = R5Helpers.formatRemaining(R5Helpers.remainingMs(item.expires_at), I18N.getLang());
        return `<article class="trash-item">
          <div class="trash-item-main"><strong>${this._escape(label)}</strong><span>${this._escape(item.module)} · ${this._escape(item.id)}</span></div>
          <div class="trash-item-meta"><span>${this._escape(I18N.t('deleted_at', '删除时间'))}: ${this._escape(this._formatDate(item.deleted_at))}</span><span>${this._escape(I18N.t('remaining_time', '剩余恢复时间'))}: ${this._escape(remaining)}</span></div>
          <button type="button" class="btn btn-primary" onclick="UIAuth._restoreTrash(${index})">${this._escape(I18N.t('restore_btn', '恢复'))}</button>
        </article>`;
      }).join('');
    }
    if (loadMore) loadMore.classList.toggle('hidden', !this._trashState.hasMore);
  },

  async _restoreTrash(index) {
    const item = this._trashState?.items?.[index];
    if (!item || !window.confirm(I18N.t('confirm_restore', '确定恢复这条记录吗？'))) return;
    try {
      await Auth.restoreRecord(item.module, item.id, item.delete_revision);
      this._trashState.items.splice(index, 1);
      this._renderTrash();
      this.showToast(I18N.t('restore_success', '已恢复'), 'success');
      if (typeof Sync !== 'undefined') await Sync.syncNow();
    } catch (error) {
      const messages = {
        RESTORE_CONFLICT: I18N.t('restore_conflict', '恢复冲突，请刷新后重试'),
        NOT_FOUND: I18N.t('restore_not_found', '记录不存在或已彻底清除'),
        QUOTA_EXCEEDED: I18N.t('restore_quota', '云端空间不足，无法恢复'),
      };
      this.showToast(messages[error.code] || error.message, 'error');
    }
  },

  // === 云端 JSON 导出 ===

  showCloudExport() {
    document.getElementById('user-menu')?.classList.add('hidden');
    if (!this._cloudActionAllowed()) return;
    const body = this._openR5Modal('cloud-export-modal', I18N.t('cloud_export_title', '云端数据导出'));
    body.innerHTML = `
      <p>${this._escape(I18N.t('export_reimport_note', '导出文件会转换为可重新导入的本地 JSON 格式。'))}</p>
      <progress id="cloud-export-progress" class="r5-usage-progress" max="100" value="0" aria-label="${this._escape(I18N.t('export_progress', '导出进度'))}"></progress>
      <div id="cloud-export-status" class="r5-inline-status" role="status" aria-live="polite"></div>
      <div class="r5-modal-actions">
        <button type="button" class="btn btn-primary" id="cloud-export-start" onclick="UIAuth._runCloudExport()">${this._escape(I18N.t('cloud_export_btn', '导出云端数据（JSON）'))}</button>
        <button type="button" class="btn btn-secondary" onclick="UIAuth._closeR5Modal('cloud-export-modal')">${this._escape(I18N.t('close', '关闭'))}</button>
      </div>`;
  },

  async _runCloudExport() {
    const button = document.getElementById('cloud-export-start');
    const progress = document.getElementById('cloud-export-progress');
    if (button) button.disabled = true;
    const setProgress = (value, message) => {
      if (progress) progress.value = value;
      this._setR5Status('cloud-export-status', message);
    };
    try {
      setProgress(10, I18N.t('exporting', '正在导出...'));
      const status = await Auth.fetchSyncStatus();
      setProgress(35, `${I18N.t('export_progress', '导出进度')}: 35%`);
      const cloudExport = await Auth.fetchCloudExport();
      setProgress(75, `${I18N.t('export_progress', '导出进度')}: 75%`);
      const check = R5Helpers.verifyExportCount(status.modules, cloudExport.modules);
      if (!check.ok) {
        const error = new Error(`${I18N.t('export_count_mismatch', '条数校验不一致')} (${check.actual}/${check.expected})`);
        error.code = 'EXPORT_COUNT_MISMATCH';
        throw error;
      }
      const localExport = R5Helpers.cloudExportToLocal(cloudExport, typeof ExportImport !== 'undefined' ? ExportImport.EXPORT_VERSION : '1.3');
      if (typeof ExportImport !== 'undefined' && typeof ExportImport._validateImportData === 'function') {
        ExportImport._validateImportData(localExport);
      }
      this._downloadJson(localExport, `umafic_cloud_export_${new Date().toISOString().slice(0, 10)}.json`);
      setProgress(100, `${I18N.t('export_done', '导出完成')} · ${I18N.t('export_count_ok', '条数校验通过')} (${check.actual})`);
    } catch (error) {
      if (progress) progress.value = 0;
      this._setR5Status('cloud-export-status', `${I18N.t('export_failed', '导出失败')}: ${error.message}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  },

  _downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },

  // === 同步按钮 ===

  async _onSyncNow() {
    document.getElementById('user-menu')?.classList.add('hidden');
    if (typeof Sync !== 'undefined') {
      await Sync.syncNow();
    }
  },
};
