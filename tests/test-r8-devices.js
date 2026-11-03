"use strict";

window.R8SharedCloud = {
  revision: 0,
  users: new Map(),
  tokens: new Map(),
  requestLog: [],
  failAfterCommitOnce: false,
  floors: new Map(),

  reset() {
    this.revision = 0;
    this.users.clear();
    this.tokens.clear();
    this.requestLog = [];
    this.failAfterCommitOnce = false;
    this.floors.clear();
  },

  _user(userId) {
    const uid = String(userId);
    if (!this.users.has(uid)) {
      this.users.set(uid, { records: new Map(), changes: [], operations: new Map() });
    }
    return this.users.get(uid);
  },

  _key(module, id) { return `${module}\u0000${id}`; },

  seed(userId, module, id, data) {
    const user = this._user(userId);
    const revision = ++this.revision;
    user.records.set(this._key(module, id), {
      module, id, data, revision, tombstone: false,
    });
    user.changes.push({ revision, module, id, action: "upsert", data });
    return revision;
  },

  compact(userId, floor) {
    const user = this._user(userId);
    user.changes = [];
    this.floors.set(String(userId), Number(floor));
    this.revision = Math.max(this.revision, Number(floor));
  },

  currentRecord(userId, module, id) {
    return this._user(userId).records.get(this._key(module, id)) || null;
  },

  async handle(userId, path, method = "GET", body = null) {
    const uid = String(userId);
    if (path === "/api/sync/push" && method === "POST") {
      return this._push(uid, body);
    }
    if (path.startsWith("/api/sync/pull") && method === "GET") {
      return this._pull(uid, path);
    }
    if (path === "/api/sync/snapshot" && method === "POST") {
      return this._snapshot(uid, body || {});
    }
    throw new Error(`unexpected cloud request ${method} ${path}`);
  },

  async _push(uid, body) {
    const user = this._user(uid);
    const opIds = body.changes.map(change => change.op_id);
    const requestBytes = new Blob([JSON.stringify(body)]).size;
    const results = [];

    for (const change of body.changes) {
      const duplicate = user.operations.get(change.op_id);
      if (duplicate) {
        results.push({ ...duplicate, status: "duplicate" });
        continue;
      }

      const key = this._key(body.module, change.id);
      const current = user.records.get(key);
      if (change.action === "upsert" && current?.tombstone) {
        results.push({
          op_id: change.op_id,
          status: "deleted_conflict",
          id: change.id,
          delete_revision: current.revision,
        });
        continue;
      }

      const revision = ++this.revision;
      if (change.action === "delete") {
        user.records.set(key, {
          module: body.module,
          id: change.id,
          data: current?.data || null,
          revision,
          tombstone: true,
        });
        user.changes.push({
          revision, module: body.module, id: change.id, action: "delete",
        });
      } else {
        user.records.set(key, {
          module: body.module,
          id: change.id,
          data: change.data,
          revision,
          tombstone: false,
        });
        user.changes.push({
          revision, module: body.module, id: change.id,
          action: "upsert", data: change.data,
        });
      }
      const accepted = { op_id: change.op_id, status: "accepted", revision };
      user.operations.set(change.op_id, accepted);
      results.push(accepted);
    }

    this.requestLog.push({
      userId: uid,
      path: "/api/sync/push",
      opIds,
      requestBytes,
      statuses: results.map(result => result.status),
    });
    if (this.failAfterCommitOnce) {
      this.failAfterCommitOnce = false;
      const error = new Error("simulated response loss after commit");
      error.status = 0;
      error.code = "NETWORK_ERROR";
      throw error;
    }
    return { results, request_id: `push_${this.requestLog.length}` };
  },

  _pull(uid, path) {
    const url = new URL(path, location.origin);
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const limit = Number(url.searchParams.get("limit") || 500);
    const user = this._user(uid);
    const earliest = user.changes.length
      ? Math.min(...user.changes.map(change => change.revision))
      : 0;
    const minAvailable = Math.max(this.floors.get(uid) || 0, earliest);
    this.requestLog.push({ userId: uid, path: "/api/sync/pull", cursor });

    if (cursor > 0 && cursor < minAvailable) {
      return {
        changes: [], next_cursor: cursor, has_more: false,
        min_available_revision: minAvailable, reset_required: true,
        request_id: `pull_reset_${cursor}`,
      };
    }

    const rows = user.changes
      .filter(change => change.revision > cursor)
      .sort((a, b) => a.revision - b.revision)
      .slice(0, limit + 1);
    const hasMore = rows.length > limit;
    const changes = rows.slice(0, limit);
    return {
      changes,
      next_cursor: changes.length ? changes[changes.length - 1].revision : cursor,
      has_more: hasMore,
      min_available_revision: minAvailable,
      reset_required: false,
      request_id: `pull_${cursor}`,
    };
  },

  _snapshot(uid, body) {
    let snapshot;
    if (!body.snapshot_token) {
      const user = this._user(uid);
      const items = [...user.records.values()]
        .filter(record => !record.tombstone)
        .sort((a, b) => this._key(a.module, a.id).localeCompare(this._key(b.module, b.id)))
        .map(record => ({
          module: record.module,
          id: record.id,
          data: record.data,
          revision: record.revision,
        }));
      const token = `snapshot_${crypto.randomUUID().replace(/-/g, "")}`;
      snapshot = {
        token, userId: uid, revision: this.revision,
        items,
      };
      this.tokens.set(token, snapshot);
    } else {
      snapshot = this.tokens.get(body.snapshot_token);
      if (!snapshot || snapshot.userId !== uid) {
        const error = new Error("snapshot invalid");
        error.status = 404;
        error.code = "SNAPSHOT_INVALID";
        throw error;
      }
    }

    const cursor = body.cursor == null ? -1 : Number(body.cursor);
    const page = snapshot.items.slice(cursor + 1, cursor + 501);
    const nextCursor = page.length ? cursor + page.length : null;
    const hasMore = nextCursor != null && nextCursor + 1 < snapshot.items.length;
    this.requestLog.push({
      userId: uid, path: "/api/sync/snapshot",
      token: snapshot.token, cursor,
    });
    return {
      snapshot_token: snapshot.token,
      snapshot_revision: snapshot.revision,
      total_items: snapshot.items.length,
      items: page,
      next_cursor: nextCursor,
      has_more: hasMore,
      request_id: `snapshot_${cursor}`,
    };
  },
};

const R8DeviceHarness = {
  async open(dbName, userId) {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `r8-device-frame.html?db=${encodeURIComponent(dbName)}&user=${encodeURIComponent(userId)}`;
    document.body.appendChild(iframe);
    await new Promise((resolve, reject) => {
      iframe.onload = resolve;
      iframe.onerror = () => reject(new Error("device frame load failed"));
    });
    await iframe.contentWindow.deviceReady;
    return iframe;
  },

  async prepare(iframe, userId) {
    const win = iframe.contentWindow;
    win.DeviceAuth._userId = String(userId);
    await win.DeviceStorage.setWorkspaceOwner(String(userId));
    win.DeviceSync._stopped = false;
    win.DeviceSync.setEnabled(true);
    await win.DeviceSync.syncNow();
    TestRunner.assert.equal(win.DeviceSync._status, win.DeviceSync.STATUS.SYNCED);
  },

  async close(iframe, { removeDatabase = true } = {}) {
    if (!iframe) return;
    const win = iframe.contentWindow;
    const dbName = win?.DeviceStorage?.DB_NAME;
    try { win?.DeviceSync?.stop(); } catch (_) {}
    try { if (win?.DeviceStorage?._autoBackupTimer) win.clearInterval(win.DeviceStorage._autoBackupTimer); } catch (_) {}
    try { win?.DeviceStorage?.db?.close(); } catch (_) {}
    iframe.remove();
    if (removeDatabase && dbName) {
      await new Promise(resolve => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  },

  async bulkPutHorses(iframe, records) {
    const storage = iframe.contentWindow.DeviceStorage;
    await new Promise((resolve, reject) => {
      const tx = storage.db.transaction("horses", "readwrite");
      const store = tx.objectStore("horses");
      for (const record of records) store.put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("bulk put failed"));
      tx.onabort = () => reject(tx.error || new Error("bulk put aborted"));
    });
  },
};

TestRunner.suite("R8.4 — 50MB 首传与响应中断续传", t => {
  t.test("约50MiB首传按批提交，响应丢失后沿原op_id续传", async () => {
    R8SharedCloud.reset();
    const userId = `large_user_${Date.now()}`;
    const dbName = `StudDataDB_R8_Large_${Date.now()}`;
    let frame = null;
    try {
      frame = await R8DeviceHarness.open(dbName, userId);
      const win = frame.contentWindow;
      const filler = "大".repeat(163000); // UTF-8约489,000字节/记录。
      const records = [];
      let payloadBytes = 0;
      for (let index = 0; index < 106; index++) {
        const record = {
          id: `large_${String(index).padStart(3, "0")}`,
          name_en: `Large-${index}`,
          notes: filler,
          type: "fictional",
        };
        records.push(record);
        payloadBytes += new Blob([JSON.stringify(record)]).size;
      }
      TestRunner.assert.ok(payloadBytes >= 50_000_000, `payload=${payloadBytes}`);
      TestRunner.assert.ok(payloadBytes < 50 * 1024 * 1024, `payload=${payloadBytes}`);
      await R8DeviceHarness.bulkPutHorses(frame, records);
      records.length = 0;

      const started = performance.now();
      const pending = await win.DeviceStorage.beginInitialUpload(userId);
      TestRunner.assert.equal(pending.total_items, 106);
      win.DeviceAuth._userId = userId;
      const firstBatch = await win.DeviceStorage.getOutboxBatch(userId, 100);
      const originalOpIds = firstBatch.map(item => item.op_id);
      TestRunner.assert.equal(originalOpIds.length, 100);

      R8SharedCloud.failAfterCommitOnce = true;
      let responseLost = false;
      try { await win.DeviceSync._pushOutbox(); } catch (_) { responseLost = true; }
      TestRunner.assert.ok(responseLost);
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userId), 106);
      const retryBatch = await win.DeviceStorage.getOutboxBatch(userId, 100);
      TestRunner.assert.deepEqual(retryBatch.map(item => item.op_id), originalOpIds);

      await win.DeviceSync._pushOutbox();
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userId), 0);
      TestRunner.assert.ok(await win.DeviceStorage.getInitialUploadState(userId));
      TestRunner.assert.ok(await win.DeviceSync._pullChanges());
      TestRunner.assert.ok(await win.DeviceStorage.completeInitialUpload(userId));
      const elapsedMs = performance.now() - started;

      const pushes = R8SharedCloud.requestLog.filter(entry => entry.path === "/api/sync/push");
      TestRunner.assert.equal(pushes.length, 12);
      TestRunner.assert.deepEqual(pushes[0].opIds, pushes[1].opIds);
      TestRunner.assert.ok(pushes[0].statuses.every(status => status === "accepted"));
      TestRunner.assert.ok(pushes[1].statuses.every(status => status === "duplicate"));
      const acceptedPushes = [pushes[0], ...pushes.slice(2)];
      const acceptedOpIds = acceptedPushes.flatMap(entry => entry.opIds);
      TestRunner.assert.equal(acceptedOpIds.length, 106);
      TestRunner.assert.equal(new Set(acceptedOpIds).size, 106);
      TestRunner.assert.ok(acceptedPushes.every(entry =>
        entry.statuses.every(status => status === "accepted")));
      TestRunner.assert.ok(pushes.every(entry => entry.opIds.length <= 10));
      TestRunner.assert.equal(pushes.at(-1).opIds.length, 6);
      TestRunner.assert.ok(Math.max(...pushes.map(entry => entry.requestBytes)) < 5_000_000);
      TestRunner.assert.equal(R8SharedCloud._user(userId).operations.size, 106);
      TestRunner.assert.equal((await win.DeviceStorage.getAllHorses()).length, 106);
      TestRunner.assert.equal(await win.DeviceStorage.getInitialUploadState(userId), null);
      TestRunner.assert.ok(elapsedMs < 60_000, `elapsed=${elapsedMs.toFixed(1)}ms`);

      window.__R8_50MB_BASELINE__ = {
        payload_bytes: payloadBytes,
        elapsed_ms: Math.round(elapsedMs),
        browser: navigator.userAgent,
        hardware_concurrency: navigator.hardwareConcurrency || null,
        network: navigator.connection?.effectiveType || "local-mock",
        request_count: pushes.length,
        max_request_bytes: Math.max(...pushes.map(entry => entry.requestBytes)),
        record_count: 106,
      };
    } finally {
      await R8DeviceHarness.close(frame);
    }
  });
});

TestRunner.suite("R8.6 — 双设备离线删除与最终收敛", t => {
  t.test("并发编辑后最后写入收敛，关闭重开后delete fence阻止旧upsert复活", async () => {
    R8SharedCloud.reset();
    const userId = `device_user_${Date.now()}`;
    const dbA = `StudDataDB_R8_A_${Date.now()}`;
    const dbB = `StudDataDB_R8_B_${Date.now()}`;
    let frameA = null;
    let frameB = null;
    try {
      frameA = await R8DeviceHarness.open(dbA, userId);
      frameB = await R8DeviceHarness.open(dbB, userId);
      await R8DeviceHarness.prepare(frameA, userId);
      await R8DeviceHarness.prepare(frameB, userId);
      const a = frameA.contentWindow;
      const b = frameB.contentWindow;

      a.DeviceSync.stop(); b.DeviceSync.stop();
      await a.DeviceStorage.saveHorse({ id: "shared_horse", name_en: "Edit-A", type: "fictional" });
      await b.DeviceStorage.saveHorse({ id: "shared_horse", name_en: "Edit-B", type: "fictional" });
      a.DeviceSync._stopped = false;
      await a.DeviceSync.syncNow();
      b.DeviceSync._stopped = false;
      await b.DeviceSync.syncNow();
      await a.DeviceSync.syncNow();
      TestRunner.assert.equal((await a.DeviceStorage.getHorse("shared_horse")).name_en, "Edit-B");
      TestRunner.assert.equal((await b.DeviceStorage.getHorse("shared_horse")).name_en, "Edit-B");

      a.DeviceSync.stop(); b.DeviceSync.stop();
      await b.DeviceStorage.saveHorse({
        ...(await b.DeviceStorage.getHorse("shared_horse")), name_en: "stale-offline-upsert",
      });
      await a.DeviceStorage.deleteHorse("shared_horse");
      await R8DeviceHarness.close(frameA, { removeDatabase: false });
      frameA = await R8DeviceHarness.open(dbA, userId);
      const reopenedA = frameA.contentWindow;
      TestRunner.assert.equal(reopenedA.DeviceStorage.getWorkspaceOwner(), userId);
      TestRunner.assert.equal(await reopenedA.DeviceStorage.getOutboxCount(userId), 1);
      reopenedA.DeviceSync._stopped = false;
      await reopenedA.DeviceSync.syncNow();

      b.DeviceSync._stopped = false;
      await b.DeviceSync.syncNow();
      await reopenedA.DeviceSync.syncNow();
      TestRunner.assert.equal(await reopenedA.DeviceStorage.getHorse("shared_horse"), null);
      TestRunner.assert.equal(await b.DeviceStorage.getHorse("shared_horse"), null);
      TestRunner.assert.equal(await reopenedA.DeviceStorage.getOutboxCount(userId), 0);
      TestRunner.assert.equal(await b.DeviceStorage.getOutboxCount(userId), 0);
      TestRunner.assert.ok(R8SharedCloud.currentRecord(userId, "horses", "shared_horse").tombstone);
      TestRunner.assert.equal(
        await reopenedA.DeviceStorage.getSyncCursor(userId),
        await b.DeviceStorage.getSyncCursor(userId)
      );
      const conflicts = R8SharedCloud.requestLog
        .filter(entry => entry.path === "/api/sync/push")
        .flatMap(entry => entry.statuses);
      TestRunner.assert.ok(conflicts.includes("deleted_conflict"));
    } finally {
      await R8DeviceHarness.close(frameA);
      await R8DeviceHarness.close(frameB);
    }
  });
});

TestRunner.suite("R8.7 — A→B→A workspace隔离", t => {
  t.test("业务数据、outbox和cursor按账号隔离且切回后续传A队列", async () => {
    R8SharedCloud.reset();
    const userA = `account_a_${Date.now()}`;
    const userB = `account_b_${Date.now()}`;
    R8SharedCloud.seed(userA, "horses", "cloud_a", { id: "cloud_a", name_en: "Cloud-A" });
    R8SharedCloud.seed(userB, "horses", "cloud_b", { id: "cloud_b", name_en: "Cloud-B" });
    const dbName = `StudDataDB_R8_ABA_${Date.now()}`;
    let frame = null;
    try {
      frame = await R8DeviceHarness.open(dbName, userA);
      await R8DeviceHarness.prepare(frame, userA);
      const win = frame.contentWindow;
      TestRunner.assert.ok(await win.DeviceStorage.getHorse("cloud_a"));
      TestRunner.assert.equal(await win.DeviceStorage.getHorse("cloud_b"), null);

      win.DeviceSync.stop();
      await win.DeviceStorage.saveHorse({ id: "pending_a", name_en: "Pending-A", type: "fictional" });
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userA), 1);

      await win.DeviceStorage.beginWorkspaceSwitch(userB);
      win.DeviceAuth._userId = userB;
      win.DeviceSync._stopped = false;
      await win.DeviceSync.syncNow();
      TestRunner.assert.ok(await win.DeviceStorage.commitWorkspaceSwitch(userB));
      TestRunner.assert.equal(win.DeviceStorage.getWorkspaceOwner(), userB);
      TestRunner.assert.equal(await win.DeviceStorage.getHorse("cloud_a"), null);
      TestRunner.assert.equal(await win.DeviceStorage.getHorse("pending_a"), null);
      TestRunner.assert.ok(await win.DeviceStorage.getHorse("cloud_b"));
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userA), 1);
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userB), 0);

      await win.DeviceStorage.saveHorse({ id: "local_b", name_en: "Local-B", type: "fictional" });
      await win.DeviceSync.syncNow();
      const cursorB = await win.DeviceStorage.getSyncCursor(userB);
      TestRunner.assert.ok(R8SharedCloud.currentRecord(userB, "horses", "local_b"));

      win.DeviceSync.stop();
      await win.DeviceStorage.beginWorkspaceSwitch(userA);
      win.DeviceAuth._userId = userA;
      win.DeviceSync._stopped = false;
      await win.DeviceSync.syncNow();
      TestRunner.assert.ok(await win.DeviceStorage.commitWorkspaceSwitch(userA));
      TestRunner.assert.equal(win.DeviceStorage.getWorkspaceOwner(), userA);
      TestRunner.assert.ok(await win.DeviceStorage.getHorse("cloud_a"));
      TestRunner.assert.ok(await win.DeviceStorage.getHorse("pending_a"));
      TestRunner.assert.equal(await win.DeviceStorage.getHorse("cloud_b"), null);
      TestRunner.assert.equal(await win.DeviceStorage.getHorse("local_b"), null);
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userA), 0);
      TestRunner.assert.equal(await win.DeviceStorage.getOutboxCount(userB), 0);
      TestRunner.assert.equal(await win.DeviceStorage.getSyncCursor(userB), cursorB);
      TestRunner.assert.ok(await win.DeviceStorage.getSyncCursor(userA) > cursorB);
      TestRunner.assert.ok(R8SharedCloud.currentRecord(userA, "horses", "pending_a"));
      TestRunner.assert.ok(R8SharedCloud.currentRecord(userB, "horses", "local_b"));
    } finally {
      await R8DeviceHarness.close(frame);
    }
  });
});

TestRunner.suite("R8.8 — retention floor后旧cursor自动snapshot", t => {
  t.test("日志全清空仍返回floor，snapshot完成后cursor不再重复reset", async () => {
    R8SharedCloud.reset();
    const userId = `retention_user_${Date.now()}`;
    R8SharedCloud.seed(userId, "horses", "retained_cloud", {
      id: "retained_cloud", name_en: "Retained-Cloud", type: "fictional",
    });
    R8SharedCloud.compact(userId, 120);
    const dbName = `StudDataDB_R8_Retention_${Date.now()}`;
    let frame = null;
    try {
      frame = await R8DeviceHarness.open(dbName, userId);
      const win = frame.contentWindow;
      await win.DeviceStorage.setWorkspaceOwner(userId);
      await win.DeviceStorage.setSyncCursor(userId, 100);
      await win.DeviceStorage._putRaw("horses", { id: "stale_local", name_en: "Stale" });
      win.DeviceAuth._userId = userId;
      win.DeviceSync._stopped = false;
      await win.DeviceSync.syncNow();

      TestRunner.assert.equal(await win.DeviceStorage.getHorse("stale_local"), null);
      TestRunner.assert.equal(
        (await win.DeviceStorage.getHorse("retained_cloud")).name_en,
        "Retained-Cloud"
      );
      TestRunner.assert.equal(await win.DeviceStorage.getSyncCursor(userId), 120);
      const snapshots = R8SharedCloud.requestLog.filter(
        entry => entry.path === "/api/sync/snapshot" && entry.userId === userId
      );
      const pulls = R8SharedCloud.requestLog.filter(
        entry => entry.path === "/api/sync/pull" && entry.userId === userId
      );
      TestRunner.assert.equal(snapshots.length, 1);
      TestRunner.assert.deepEqual(pulls.map(entry => entry.cursor), [100, 120]);
      TestRunner.assert.equal(win.DeviceSync._status, win.DeviceSync.STATUS.SYNCED);
    } finally {
      await R8DeviceHarness.close(frame);
    }
  });
});
