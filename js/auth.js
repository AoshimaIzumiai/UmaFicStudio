/**
 * auth.js — 前端认证模块
 * 负责：注册/登录/退出/改密码/删除账号/token管理/workspace归属
 */
'use strict';

const Auth = {
  TOKEN_KEY: 'uma_auth_token',
  USER_KEY: 'uma_auth_user',
  API_BASE: 'https://aiching.net/umafic-api',
  SESSION_TRANSITION_KEY: 'uma_auth_session_transition',
  _candidateSession: null,

  // === 状态查询 ===

  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  getUser() {
    const raw = localStorage.getItem(this.USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },

  getUserId() {
    const user = this.getUser();
    return user ? String(user.id) : null;
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  // === 候选登录会话（workspace 决策前不覆盖当前会话） ===

  _setCandidateSession(response) {
    this._candidateSession = { token: response.token, user: response.user };
  },

  _activateCandidateSession() {
    if (!this._candidateSession) throw new Error('没有待确认的登录会话');
    const previous = { token: this.getToken(), user: this.getUser() };
    try { sessionStorage.setItem(this.SESSION_TRANSITION_KEY, JSON.stringify(previous)); } catch (_) {}
    this._saveSession(this._candidateSession.token, this._candidateSession.user);
    return this._candidateSession;
  },

  _commitCandidateSession() {
    this._candidateSession = null;
    try { sessionStorage.removeItem(this.SESSION_TRANSITION_KEY); } catch (_) {}
  },

  _restorePreviousSession() {
    let previous = null;
    try {
      const raw = sessionStorage.getItem(this.SESSION_TRANSITION_KEY);
      previous = raw ? JSON.parse(raw) : null;
      sessionStorage.removeItem(this.SESSION_TRANSITION_KEY);
    } catch (_) { /* ignore */ }
    if (previous?.token && previous?.user) this._saveSession(previous.token, previous.user);
    else {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.USER_KEY);
    }
    this._candidateSession = null;
  },

  cancelLogin() {
    this._candidateSession = null;
  },

  recoverInterruptedSessionTransition() {
    let hasTransition = false;
    try { hasTransition = !!sessionStorage.getItem(this.SESSION_TRANSITION_KEY); } catch (_) {}
    if (!hasTransition) return false;
    const currentUserId = this.getUserId();
    const owner = Storage.getWorkspaceOwner();
    if (!currentUserId || currentUserId !== owner) this._restorePreviousSession();
    else this._commitCandidateSession();
    return true;
  },

  // === 认证操作 ===

  /**
   * 注册新用户
   * 成功后自动保存 token 和绑定 workspace owner
   */
  async register(username, password) {
    Storage.assertSyncReadyForAdoption();
    if (Storage.getWorkspaceOwner()) {
      const error = new Error('当前本地 workspace 已绑定账号，请先登录原账号或显式切换');
      error.code = 'WORKSPACE_OWNER_CONFLICT';
      throw error;
    }

    const res = await this._fetch('/api/auth/register', 'POST', { username, password });
    // 远端账号创建后，先原子持久化 adoption/outbox/owner，再暴露本地登录会话。
    await Storage.beginInitialUpload(String(res.user.id));
    this._saveSession(res.token, res.user);
    return res;
  },

  /**
   * 登录
   * 成功后保存 token，但不自动绑定 workspace（需要先检查冲突）
   * @returns {{ token, user, workspaceConflict: string|null }}
   */
  async login(username, password) {
    const res = await this._fetch('/api/auth/login', 'POST', { username, password });
    this._setCandidateSession(res);

    const currentOwner = Storage.getWorkspaceOwner();
    const newUserId = String(res.user.id);
    let workspaceConflict = null;

    if (!currentOwner) {
      const hasLocalData = await this._hasLocalUserData();
      if (hasLocalData) {
        workspaceConflict = 'anonymous_with_data';
      } else {
        this._activateCandidateSession();
        try {
          await Storage.beginInitialUpload(newUserId);
          this._commitCandidateSession();
        } catch (error) {
          this._restorePreviousSession();
          throw error;
        }
      }
    } else if (currentOwner !== newUserId) {
      workspaceConflict = 'other_account';
    } else {
      // 当前 workspace 本来就属于该账号，可直接提交候选会话并续传。
      this._activateCandidateSession();
      this._commitCandidateSession();
    }

    return { ...res, workspaceConflict };
  },

  /**
   * 退出登录
   * 清除 token 但保留本地数据和 workspace owner
   */
  logout() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this._candidateSession = null;
    try { sessionStorage.removeItem(this.SESSION_TRANSITION_KEY); } catch (_) {}
    // 不清 workspace_owner、不清 outbox、不清本地数据
    if (typeof Sync !== 'undefined') Sync.stop();
  },

  /**
   * 验证当前 token 有效性
   * @returns {boolean}
   */
  async verify() {
    if (!this.getToken()) return false;
    try {
      const res = await this._fetch('/api/auth/me', 'GET');
      localStorage.setItem(this.USER_KEY, JSON.stringify({ id: res.id, username: res.username, created_at: res.created_at || null }));
      return true;
    } catch (e) {
      if (e.status === 401) {
        // Token 失效，清除但保留本地数据
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
      }
      return false;
    }
  },

  /**
   * 拉取账号信息（含注册时间），顺便刷新本地 USER_KEY 缓存。
   * @returns {Promise<{id,username,created_at,request_id}>}
   */
  async fetchAccountInfo() {
    const res = await this._fetch('/api/auth/me', 'GET');
    const user = { id: res.id, username: res.username, created_at: res.created_at || null };
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    return res;
  },

  /** 拉取云端同步状态与用量（R5 同步详情 / 导出条数校验）。 */
  async fetchSyncStatus() {
    return this._fetch('/api/sync/status', 'GET');
  },

  /** 拉取回收站一页（R5 分页回收站）。 */
  async fetchTrash(module = null, cursor = 0, limit = 50) {
    const params = new URLSearchParams();
    if (module) params.set('module', module);
    params.set('cursor', String(cursor));
    params.set('limit', String(limit));
    return this._fetch(`/api/sync/trash?${params.toString()}`, 'GET');
  },

  /** 恢复一条回收站记录（R5）。成功 {revision,data}。 */
  async restoreRecord(module, id, baseDeleteRevision) {
    return this._fetch('/api/sync/restore', 'POST', {
      module, id, base_delete_revision: baseDeleteRevision,
    });
  },

  /** 拉取云端全量导出 JSON（R5 云端导出）。较大，放宽超时到 120s。 */
  async fetchCloudExport() {
    return this._fetch('/api/sync/export', 'GET', null, 120000);
  },

  /**
   * 修改密码
   * 成功后原子替换新 token（当前设备继续可用）
   */
  async changePassword(oldPassword, newPassword) {
    const res = await this._fetch('/api/auth/change-password', 'POST', {
      old_password: oldPassword,
      new_password: newPassword,
    });
    // 原子替换为新 token
    if (res.new_token) {
      localStorage.setItem(this.TOKEN_KEY, res.new_token);
    }
    return res;
  },

  /**
   * 删除账号
   * 清除云端数据和本地会话，但保留本地业务数据和 Press
   */
  async deleteAccount(confirmUsername) {
    const userId = this.getUserId();
    await this._fetch('/api/auth/account', 'DELETE', { confirm_username: confirmUsername });

    // 云端已删除后立即终止该会话；后续本地清理失败不能把云端成功误报为失败。
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this._candidateSession = null;
    try { sessionStorage.removeItem(this.SESSION_TRANSITION_KEY); } catch (_) {}
    if (typeof Sync !== 'undefined') Sync.stop();

    try {
      await Storage.setWorkspaceOwner(null);
      if (userId && typeof Storage.clearUserSyncState === 'function') {
        await Storage.clearUserSyncState(userId);
      }
    } catch (error) {
      console.warn('[Auth] 云端账号已删除；本地同步元数据清理未完全完成，业务数据仍保留', error);
    }
  },

  // === Workspace 决策执行 ===

  /**
   * 用户选择"使用云端数据"时调用
   * 生成本地备份 → 清空业务 store → 绑定新 owner → 等待 Sync snapshot pull
   */
  async switchToCloudWorkspace() {
    const candidate = this._candidateSession;
    if (!candidate?.user?.id) throw new Error('没有待确认的登录账号');
    const userId = String(candidate.user.id);
    let prepared = false;

    // 用户可见下载只是额外副本；真正可回滚备份由 Storage 持久化并校验。
    await this._exportLocalBackup();
    this._activateCandidateSession();
    try {
      await Storage.beginWorkspaceSwitch(userId);
      prepared = true;

      if (typeof Sync === 'undefined') throw new Error('同步引擎不可用');
      await Sync.init();
      const baseline = await Storage.get('sync_meta', `baseline_${userId}`);
      if (Sync._status !== Sync.STATUS.SYNCED || baseline?.value !== true) {
        const error = new Error('云端数据下载未完整完成，已恢复原 workspace');
        error.code = 'WORKSPACE_SNAPSHOT_FAILED';
        throw error;
      }

      await Storage.commitWorkspaceSwitch(userId);
      this._commitCandidateSession();
      return true;
    } catch (error) {
      if (typeof Sync !== 'undefined') Sync.stop();
      if (prepared) await Storage.rollbackWorkspaceSwitch();
      this._restorePreviousSession();
      throw error;
    }
  },

  /** 用户选择“本地优先合并”（仅匿名 workspace）时进入持久首次上传。 */
  async mergeLocalToCloud() {
    const candidate = this._candidateSession;
    if (!candidate?.user?.id) throw new Error('没有待确认的登录账号');
    const userId = String(candidate.user.id);
    this._activateCandidateSession();
    try {
      const state = await Storage.beginInitialUpload(userId);
      this._commitCandidateSession();
      return state;
    } catch (error) {
      this._restorePreviousSession();
      throw error;
    }
  },

  // === 内部方法 ===

  _saveSession(token, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  },

  /**
   * 通用 fetch 封装
   * 自动附带 Authorization、超时控制、统一错误处理
   */
  async _fetch(path, method, body, timeoutMs = 10000) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const opts = { method, headers, signal: controller.signal };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    try {
      const res = await fetch(this.API_BASE + path, opts);
      clearTimeout(timeout);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ code: 'UNKNOWN', message: `HTTP ${res.status}` }));
        const error = new Error(err.message || err.detail?.message || `HTTP ${res.status}`);
        error.status = res.status;
        error.code = err.code || err.detail?.code || 'UNKNOWN';
        error.requestId = err.request_id || err.detail?.request_id || '';
        error.retryAfter = res.headers.get('Retry-After') || '';
        error.details = err.details || err.detail?.details || null;
        throw error;
      }
      return await res.json();
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        const timeoutErr = new Error('请求超时');
        timeoutErr.status = 0;
        timeoutErr.code = 'TIMEOUT';
        throw timeoutErr;
      }
      if (!e.status) {
        // 网络错误（断网等）
        e.status = 0;
        e.code = e.code || 'NETWORK_ERROR';
      }
      throw e;
    }
  },

  /**
   * 检查本地是否有用户创建的数据（不含 preset）
   */
  async _hasLocalUserData() {
    try {
      const horses = await Storage.getAllHorses();
      if (horses && horses.length > 0) return true;
      // 也检查其他模块
      for (const store of ['dam_groups', 'farms', 'trainers', 'owners', 'jockeys']) {
        const items = await Storage.getAll(store);
        if (items && items.length > 0) return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  },

  /**
   * 导出本地数据备份（触发浏览器下载）
   */
  async _exportLocalBackup() {
    const backup = {};
    for (const store of Storage._SYNCABLE_STORES) {
      const items = await Storage.getAll(store);
      if (items && items.length > 0) backup[store] = items;
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `umafic_local_backup_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
