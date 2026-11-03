/**
 * Mock API — 模拟后端响应，供前端同步引擎测试使用
 * 通过替换全局 fetch 来拦截请求
 */
'use strict';

const MockAPI = {
  _handlers: new Map(),
  _calls: [],
  _originalFetch: null,
  _latency: 0,    // 模拟延迟 ms
  _failNext: null, // 下一个请求强制失败

  /** 安装 Mock（替换全局 fetch） */
  install() {
    this._originalFetch = window.fetch;
    this._calls = [];
    window.fetch = async (url, opts) => {
      this._calls.push({ url, opts, time: Date.now() });

      // 模拟网络延迟
      if (this._latency > 0) {
        await new Promise(r => setTimeout(r, this._latency));
      }

      // 强制失败
      if (this._failNext) {
        const err = this._failNext;
        this._failNext = null;
        if (err === 'timeout') {
          throw new Error('Network timeout');
        }
        if (err === 'offline') {
          throw new TypeError('Failed to fetch');
        }
        return new Response(JSON.stringify(err.body || {}), {
          status: err.status || 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 匹配路径
      const path = new URL(url, 'http://test').pathname;
      const method = (opts?.method || 'GET').toUpperCase();
      const key = `${method} ${path}`;

      const handler = this._handlers.get(key);
      if (handler) {
        const body = opts?.body ? JSON.parse(opts.body) : null;
        const result = await handler({ path, method, body, headers: opts?.headers || {} });
        return new Response(JSON.stringify(result.body), {
          status: result.status || 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // 无匹配 handler
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: `No mock for ${key}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    };
  },

  /** 卸载 Mock（恢复原始 fetch） */
  uninstall() {
    if (this._originalFetch) {
      window.fetch = this._originalFetch;
      this._originalFetch = null;
    }
    this._handlers.clear();
    this._calls = [];
  },

  /** 注册路由 handler */
  on(method, path, handler) {
    this._handlers.set(`${method.toUpperCase()} ${path}`, handler);
  },

  /** 设置模拟延迟 */
  setLatency(ms) { this._latency = ms; },

  /** 下一个请求强制失败 */
  failNextWith(errorOrStatus) { this._failNext = errorOrStatus; },

  /** 获取请求记录 */
  getCalls() { return this._calls; },
  getCallCount() { return this._calls.length; },
  getLastCall() { return this._calls[this._calls.length - 1] || null; },
  clearCalls() { this._calls = []; },

  // === 常用预设 Mock ===

  /** 预设成功的 push 响应 */
  mockPushSuccess() {
    this.on('POST', '/api/sync/push', async ({ body }) => {
      const results = (body.changes || []).map(c => ({
        op_id: c.op_id, status: 'accepted', revision: Date.now()
      }));
      return { status: 200, body: { results, request_id: 'mock_req_1' } };
    });
  },

  /** 预设 DELETED_CONFLICT push 响应 */
  mockPushDeletedConflict(recordId, deleteRevision) {
    this.on('POST', '/api/sync/push', async ({ body }) => {
      const results = (body.changes || []).map(c => {
        if (c.id === recordId) {
          return { op_id: c.op_id, status: 'deleted_conflict', id: recordId, delete_revision: deleteRevision };
        }
        return { op_id: c.op_id, status: 'accepted', revision: Date.now() };
      });
      return { status: 200, body: { results, request_id: 'mock_req_2' } };
    });
  },

  /** 预设分页 pull 响应 */
  mockPullPaginated(allChanges, pageSize = 500) {
    this.on('GET', '/api/sync/pull', async ({ path }) => {
      const url = new URL(path, 'http://test');
      // 从完整 URL 获取参数
      const params = new URLSearchParams(url.search || '');
      let cursor = parseInt(params.get('cursor') || '0');
      const limit = parseInt(params.get('limit') || String(pageSize));

      const page = allChanges.filter(c => c.revision > cursor).slice(0, limit);
      const hasMore = allChanges.filter(c => c.revision > cursor).length > limit;
      const nextCursor = page.length > 0 ? page[page.length - 1].revision : cursor;

      return {
        status: 200,
        body: {
          changes: page,
          next_cursor: nextCursor,
          has_more: hasMore,
          min_available_revision: 1,
          reset_required: false,
          request_id: 'mock_pull'
        }
      };
    });
  },

  /** 预设 413 配额超限 */
  mockPushQuotaExceeded() {
    this.on('POST', '/api/sync/push', async () => ({
      status: 413,
      body: { code: 'QUOTA_EXCEEDED', message: '存储已满', request_id: 'mock_quota' }
    }));
  },

  /** 预设 401 token 失效 */
  mockAuthExpired() {
    this.on('GET', '/api/auth/me', async () => ({
      status: 401,
      body: { code: 'TOKEN_REVOKED', message: 'Token revoked', request_id: 'mock_auth' }
    }));
  },

  /** 预设 reset_required */
  mockPullResetRequired() {
    this.on('GET', '/api/sync/pull', async () => ({
      status: 200,
      body: {
        changes: [], next_cursor: 0, has_more: false,
        min_available_revision: 99999, reset_required: true,
        request_id: 'mock_reset'
      }
    }));
  }
};
