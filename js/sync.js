/**
 * sync.js — 前端同步引擎
 * 持久 outbox + 显式状态机 + cursor 分页 + 首次上传 + 离线恢复
 */
'use strict';

const Sync = {
  STATUS: {
    IDLE: 'idle', SYNCING: 'syncing', SYNCED: 'synced',
    OFFLINE: 'offline', PARTIAL: 'partial', ERROR: 'error', DISABLED: 'disabled'
  },

  MODULES: ['horses', 'dam_groups', 'races', 'results', 'farms',
            'trainers', 'owners', 'countries', 'jockeys'],

  _status: 'idle',
  _debounceTimer: null,
  _syncLock: false,
  _retryCount: 0,
  _maxRetry: 3,
  _snapshotPageMaxAttempts: 3,
  _snapshotRetryBaseMs: 250,
  // 生产50MB基线证明49MB单请求会长时间阻塞单worker；限制为已验证安全的约5MB。
  _maxPushRequestBytes: 5_000_000,
  _stopped: false,
  _listenersBound: false,
  _runtimeDisabled: false,
  _onlineHandler: null,
  _offlineHandler: null,

  // === 生命周期 ===

  isEnabled() {
    const configured = typeof window === 'undefined' || window.UMAFIC_SYNC_ENABLED !== false;
    return configured && !this._runtimeDisabled;
  },

  setEnabled(enabled) {
    if (typeof window !== 'undefined') window.UMAFIC_SYNC_ENABLED = !!enabled;
    this._runtimeDisabled = !enabled;
    if (!enabled) {
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this._setStatus(this.STATUS.DISABLED);
    } else if (this._status === this.STATUS.DISABLED) {
      this._setStatus(this.STATUS.IDLE);
    }
  },

  async init() {
    await Storage.init();
    if (!this.isEnabled()) {
      this._setStatus(this.STATUS.DISABLED);
      return;
    }
    if (!Auth.isLoggedIn()) return;
    if (Storage.getWorkspaceOwner() !== Auth.getUserId()) {
      this._setStatus(this.STATUS.DISABLED);
      return;
    }
    if (Storage.useLocalStorage) {
      this._setStatus(this.STATUS.DISABLED);
      return;
    }
    this._stopped = false;
    if (!this._listenersBound) {
      this._onlineHandler = this._onOnline.bind(this);
      this._offlineHandler = this._onOffline.bind(this);
      window.addEventListener('online', this._onlineHandler);
      window.addEventListener('offline', this._offlineHandler);
      this._listenersBound = true;
    }

    await this._executeSyncCycle();
  },

  stop() {
    this._stopped = true;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
    this._syncLock = false;
    this._setStatus(this.STATUS.IDLE);
  },

  // === 外部调用 ===

  /** 用户操作后调度（10 秒防抖） */
  schedulePush() {
    if (!this.isEnabled()) {
      this._setStatus(this.STATUS.DISABLED);
      return;
    }
    if (!Auth.isLoggedIn() || this._stopped) return;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._executeSyncCycle(), 10000);
  },

  /** 手动立即同步 */
  async syncNow() {
    if (!this.isEnabled()) {
      this._setStatus(this.STATUS.DISABLED);
      return false;
    }
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
    await this._executeSyncCycle();
  },

  // === 核心循环 ===

  async _executeSyncCycle() {
    if (!this.isEnabled()) {
      this._setStatus(this.STATUS.DISABLED);
      return false;
    }
    if (this._syncLock || this._stopped || !navigator.onLine) return;
    this._syncLock = true;
    this._setStatus(this.STATUS.SYNCING);

    try {
      // 所有网络同步入口统一 fail-closed：preset 清单、隔离恢复、IndexedDB 任一不安全即停止。
      Storage.assertSyncReadyForNetwork();
      // Phase 1: push outbox
      await this._pushOutbox();
      // Phase 2: pull 增量；snapshot 被本地新写入中止时保持 partial。
      const pullComplete = await this._pullChanges();
      if (!pullComplete) {
        this._setStatus(this.STATUS.PARTIAL);
        return;
      }
      // Phase 3: 再检查 push 期间新增的 outbox
      const userId = Auth.getUserId();
      const remaining = await Storage.getOutboxCount(userId);
      if (remaining > 0) await this._pushOutbox();

      const pending = await Storage.getInitialUploadState(userId);
      if (pending?.status === 'pending') {
        const completed = await Storage.completeInitialUpload(userId);
        if (!completed) {
          this._setStatus(this.STATUS.PARTIAL);
          return;
        }
      }

      await Storage.clearSyncError(userId);
      try { await Storage.setLastSyncedAt(userId, Date.now()); } catch (_) { /* 非关键，忽略 */ }
      this._retryCount = 0;
      this._setStatus(this.STATUS.SYNCED);
      if (typeof UIAuth !== 'undefined') UIAuth.showToast('✓ 已同步', 'success');
    } catch (e) {
      const userId = Auth.getUserId();
      try { await Storage.setSyncError(userId, e); } catch (_) { /* 不覆盖原错误 */ }
      if (e.code === 'SYNC_DISABLED') {
        this._runtimeDisabled = true;
        this._setStatus(this.STATUS.DISABLED, e);
        if (typeof UIAuth !== 'undefined') UIAuth.showToast('云同步已临时关闭，本地编辑仍会保存', 'warning');
        return;
      }
      if (e.status === 401) {
        Auth.logout();
        if (typeof UIAuth !== 'undefined') UIAuth.renderNavButton();
        return;
      }

      this._retryCount++;
      const nonRetryableStatuses = new Set([400, 403, 409, 413, 422]);
      const nonRetryable = e.nonRetryable || nonRetryableStatuses.has(e.status);
      if (nonRetryable) {
        this._setStatus(this.STATUS.ERROR, e);
        const message = e.status === 413 ? '记录或存储空间超出限制' : '同步数据需要处理后重试';
        if (typeof UIAuth !== 'undefined') UIAuth.showToast(message, 'error');
      } else if (this._retryCount < this._maxRetry) {
        const delay = this._getRetryDelay(e);
        this._setStatus(this.STATUS.PARTIAL, e);
        setTimeout(() => { this._syncLock = false; this._executeSyncCycle(); }, delay);
        return;
      } else {
        this._setStatus(this.STATUS.ERROR, e);
        if (typeof UIAuth !== 'undefined') UIAuth.showToast('同步失败', 'error');
      }
    } finally {
      this._syncLock = false;
    }
  },

  // === Push ===

  async _pushOutbox() {
    const userId = Auth.getUserId();
    if (!userId) return;

    let pending;
    while ((pending = await Storage.getOutboxBatch(userId, 100)).length > 0) {
      // Storage保证同批只有一个模块；再按真实UTF-8 JSON字节切到约5MB以内。
      const module = pending[0].module;
      const { items, changes } = this._buildPushBatch(module, pending);

      let res;
      try {
        res = await Auth._fetch('/api/sync/push', 'POST', { module, changes });
        this._validatePushResults(items, res);
      } catch (error) {
        // 保留当前批次的诊断上下文；队首不删除，用户修复后可原 op_id 重试。
        error.failedOperations = items.map(item => ({
          op_id: item.op_id,
          module: item.module,
          record_id: item.record_id,
        }));
        throw error;
      }

      for (const r of res.results) {
        if (r.status === 'accepted' || r.status === 'duplicate') {
          await Storage.removeFromOutbox(userId, r.op_id);
        } else if (r.status === 'deleted_conflict') {
          await Storage.applyRemoteDelete(module, r.id);
          await Storage.removeFromOutbox(userId, r.op_id);
        }
      }
    }
  },

  _buildPushBatch(module, pending) {
    const encoder = new TextEncoder();
    const items = [];
    const changes = [];
    let requestBytes = encoder.encode(JSON.stringify({ module, changes: [] })).length;

    for (const item of pending) {
      const change = {
        op_id: item.op_id,
        id: item.record_id,
        action: item.action,
        data: item.data,
        known_revision: item.known_revision,
        local_updated_at: item.local_updated_at,
      };
      const changeBytes = encoder.encode(JSON.stringify(change)).length;
      const projected = requestBytes + (changes.length > 0 ? 1 : 0) + changeBytes;
      if (changes.length > 0 && projected > this._maxPushRequestBytes) break;
      items.push(item);
      changes.push(change);
      requestBytes = projected;
      // 防止异常超大单条造成空批死循环；服务端仍会按单记录上限拒绝。
      if (requestBytes > this._maxPushRequestBytes) break;
    }

    return { items, changes, requestBytes };
  },

  _validatePushResults(items, response) {
    if (!response || !Array.isArray(response.results)) {
      throw this._protocolError('PUSH_RESULTS_MISSING');
    }
    const expected = new Map(items.map(item => [item.op_id, item]));
    const seen = new Set();
    const allowed = new Set(['accepted', 'duplicate', 'deleted_conflict']);

    for (const result of response.results) {
      if (!result || typeof result.op_id !== 'string' || !expected.has(result.op_id)) {
        throw this._protocolError('PUSH_RESULT_UNKNOWN_OP');
      }
      if (seen.has(result.op_id)) throw this._protocolError('PUSH_RESULT_DUPLICATE_OP');
      if (!allowed.has(result.status)) throw this._protocolError('PUSH_RESULT_UNKNOWN_STATUS');
      if ((result.status === 'accepted' || result.status === 'duplicate') &&
          !Number.isFinite(Number(result.revision))) {
        throw this._protocolError('PUSH_RESULT_REVISION_MISSING');
      }
      if (result.status === 'deleted_conflict') {
        const item = expected.get(result.op_id);
        if (result.id !== item.record_id || !Number.isFinite(Number(result.delete_revision))) {
          throw this._protocolError('PUSH_DELETE_CONFLICT_INVALID');
        }
      }
      seen.add(result.op_id);
    }
    if (seen.size !== expected.size) throw this._protocolError('PUSH_RESULT_OP_MISSING');
    return true;
  },

  // === Pull ===

  async _pullChanges() {
    const userId = Auth.getUserId();
    if (!userId) return false;

    let cursor = await Storage.getSyncCursor(userId);
    let hasMore = true;

    // cursor=0 代表没有可信云端基线；直接建立快照，不能假设变更日志仍含全部历史。
    if (cursor === 0) {
      if (await Storage.getOutboxCount(userId) > 0) return false;
      const rebuilt = await this._rebuildFromSnapshot(userId);
      if (!rebuilt) return false;
      cursor = await Storage.getSyncCursor(userId);
    }

    while (hasMore) {
      const res = await Auth._fetch(`/api/sync/pull?cursor=${cursor}&limit=500`, 'GET');

      if (res.reset_required) {
        // 任何未确认本地操作都优先于全量重建，绝不覆盖当前 workspace。
        const count = await Storage.getOutboxCount(userId);
        if (count > 0) {
          console.warn('[Sync] reset_required but outbox is not empty');
          return false;
        }

        const rebuilt = await this._rebuildFromSnapshot(userId);
        if (!rebuilt) {
          console.warn('[Sync] snapshot replacement aborted by local mutation/owner change');
          return false;
        }

        // snapshot_revision 已在原子事务中成为新 cursor；继续拉取物化后的并发变化。
        cursor = await Storage.getSyncCursor(userId);
        hasMore = true;
        continue;
      }

      for (const change of res.changes) {
        if (change.action === 'delete') {
          await Storage.applyRemoteDelete(change.module, change.id);
        } else {
          await Storage.applyRemoteUpsert(change.module, change.id, change.data, change.revision);
        }
      }

      cursor = res.next_cursor;
      hasMore = res.has_more;
    }

    // 全部页面成功后才提交 cursor；中途失败会安全重放已应用的幂等变更。
    await Storage.setSyncCursor(userId, cursor);
    return true;
  },

  async _fetchSnapshotPage(requestBody) {
    const nonRetryableStatuses = new Set([400, 401, 403, 404, 409, 410, 413, 422]);
    const maxAttempts = Math.max(1, Number(this._snapshotPageMaxAttempts) || 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await Auth._fetch('/api/sync/snapshot', 'POST', requestBody, 120000);
      } catch (error) {
        const nonRetryable = error?.nonRetryable || nonRetryableStatuses.has(error?.status);
        if (nonRetryable || attempt + 1 >= maxAttempts) throw error;
        const delay = error?.status === 429
          ? this._getRetryDelay(error)
          : Math.min(5000, Math.max(0, Number(this._snapshotRetryBaseMs) || 0) * (2 ** attempt));
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw this._protocolError('SNAPSHOT_PAGE_RETRY_EXHAUSTED');
  },

  /**
   * 下载完整物化快照到内存 staging，最终由 Storage 在单一 IDB 事务中替换。
   * SNAPSHOT_EXPIRED 可重新物化一次；其他错误保持原 workspace/cursor。
   */
  async _rebuildFromSnapshot(userId) {
    const startGeneration = await Storage.getWorkspaceGeneration(userId);
    if (await Storage.getOutboxCount(userId) > 0) return false;

    for (let attempt = 0; attempt < 2; attempt++) {
      const staging = [];
      const seen = new Set();
      let requestBody = {};
      let snapshotToken = null;
      let snapshotRevision = null;
      let totalItems = null;

      try {
        while (true) {
          // 首次物化可能扫描最多50MB数据，允许使用Nginx同级的120秒超时。
          const page = await this._fetchSnapshotPage(requestBody);

          if (!snapshotToken) {
            snapshotToken = page.snapshot_token;
            snapshotRevision = Number(page.snapshot_revision);
            totalItems = Number(page.total_items);
            if (!snapshotToken || !Number.isInteger(snapshotRevision) || snapshotRevision < 0 ||
                !Number.isInteger(totalItems) || totalItems < 0 || totalItems > 1000000) {
              throw this._protocolError('SNAPSHOT_INVALID_RESPONSE');
            }
          } else if (page.snapshot_token !== snapshotToken ||
                     Number(page.snapshot_revision) !== snapshotRevision ||
                     Number(page.total_items) !== totalItems) {
            throw this._protocolError('SNAPSHOT_CHANGED_DURING_PAGING');
          }

          if (!Array.isArray(page.items)) throw this._protocolError('SNAPSHOT_INVALID_ITEMS');
          for (const item of page.items) {
            const key = `${item?.module}\u0000${item?.id}`;
            if (!item || !this.MODULES.includes(item.module) || typeof item.id !== 'string' ||
                !item.data || typeof item.data !== 'object' ||
                !Number.isFinite(Number(item.revision)) || seen.has(key)) {
              throw this._protocolError('SNAPSHOT_ITEM_INVALID');
            }
            seen.add(key);
            staging.push(item);
          }

          if (!page.has_more) break;
          if (!Number.isInteger(Number(page.next_cursor))) {
            throw this._protocolError('SNAPSHOT_CURSOR_INVALID');
          }
          requestBody = {
            snapshot_token: snapshotToken,
            cursor: Number(page.next_cursor),
          };
        }

        if (staging.length !== totalItems || Auth.getUserId() !== userId || this._stopped) {
          return false;
        }

        return await Storage.atomicSnapshotReplace(
          userId, staging, snapshotRevision, startGeneration, totalItems
        );
      } catch (e) {
        if (e.status === 410 && e.code === 'SNAPSHOT_EXPIRED' && attempt === 0) {
          continue;
        }
        throw e;
      }
    }
    return false;
  },

  _getRetryDelay(error) {
    if (error?.status === 429 && error.retryAfter) {
      const seconds = Number(error.retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(60000, Math.max(1000, seconds * 1000));
      }
      const at = Date.parse(error.retryAfter);
      if (Number.isFinite(at)) {
        return Math.min(60000, Math.max(1000, at - Date.now()));
      }
    }
    return 5000 * Math.pow(2, Math.max(0, this._retryCount - 1));
  },

  _protocolError(code) {
    const error = new Error(code);
    error.code = code;
    error.status = 0;
    error.nonRetryable = true;
    return error;
  },

  // === 首次上传（注册后调用） ===

  async performInitialUpload(onProgress) {
    const userId = Auth.getUserId();
    if (!userId) return false;

    const state = await Storage.beginInitialUpload(userId);
    const totalItems = Number(state?.total_items) || 0;
    const before = await Storage.getOutboxCount(userId);
    if (onProgress) onProgress(Math.max(0, totalItems - before), totalItems);

    await this.syncNow();

    const after = await Storage.getOutboxCount(userId);
    if (onProgress) onProgress(Math.max(0, totalItems - after), totalItems);
    return !await Storage.getInitialUploadState(userId);
  },

  // === 网络状态 ===

  _onOnline() {
    if (this._stopped || this._status === this.STATUS.DISABLED) return;
    this._executeSyncCycle();
  },

  _onOffline() {
    if (this._stopped || this._status === this.STATUS.DISABLED) return;
    this._setStatus(this.STATUS.OFFLINE);
    if (typeof UIAuth !== 'undefined') UIAuth.showToast('⚠ 网络断开，数据保存在本地', 'warning');
  },

  _setStatus(status, error = null) {
    this._status = status;
    if (typeof UIAuth !== 'undefined') UIAuth.updateSyncStatus(status, error);
  },
};
