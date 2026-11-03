"""R8 大数据分页：25,000条 pull/snapshot 无漏页、重页。"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime

import pytest

from app.config import get_config
from app.services.sync_service import get_snapshot, pull_changes


class _Result:
    def __init__(self, *, rows=None, row=None, scalar_value=None, lastrowid=None):
        self._rows = rows or []
        self._row = row
        self._scalar = scalar_value
        self.lastrowid = lastrowid

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._row

    def scalar(self):
        return self._scalar


@dataclass
class _PagingBackend:
    user_id: int
    records: list
    changes: list
    snapshots: dict = field(default_factory=dict)
    snapshot_items: dict = field(default_factory=dict)
    next_snapshot_id: int = 1
    materialize_batch_sizes: list = field(default_factory=list)
    user_locks: dict = field(default_factory=dict)
    max_active_snapshots: int = 0


class _PagingSession:
    """模拟MySQL持久表；不同Session共享backend以模拟服务实例重建。"""

    def __init__(self, backend: _PagingBackend):
        self.backend = backend
        self.commits = 0
        self.rollbacks = 0
        self._held_user_lock = None

    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())

        if sql.startswith("SELECT id FROM users") and "FOR UPDATE" in sql:
            lock = self.backend.user_locks.setdefault(params["uid"], asyncio.Lock())
            await lock.acquire()
            self._held_user_lock = lock
            return _Result(row=(params["uid"],))

        if sql.startswith("SELECT GREATEST("):
            user_changes = [row for row in self.backend.changes if row[6] == params["uid"]]
            if "SELECT MIN(revision)" in sql:
                value = min((row[0] for row in user_changes), default=0)
            else:
                record_revisions = [
                    row[3] for row in self.backend.records if row[4] == params["uid"]
                ]
                value = max(
                    [row[0] for row in user_changes] + record_revisions,
                    default=0,
                )
            return _Result(scalar_value=value)

        if sql.startswith("SELECT sc.revision, sc.module"):
            rows = [
                row[:6] for row in self.backend.changes
                if row[6] == params["uid"] and row[0] > params["cursor"]
            ][:params["lim"]]
            return _Result(rows=rows)

        if sql.startswith("DELETE FROM sync_snapshots WHERE expires_at <="):
            expired = [
                snapshot_id for snapshot_id, snapshot in self.backend.snapshots.items()
                if snapshot["expires_at"] <= params["now"]
            ]
            for snapshot_id in expired:
                self.backend.snapshots.pop(snapshot_id, None)
                self.backend.snapshot_items.pop(snapshot_id, None)
            return _Result()

        if sql.startswith("SELECT id FROM sync_snapshots WHERE user_id"):
            rows = [
                (snapshot_id,) for snapshot_id, snapshot in sorted(
                    self.backend.snapshots.items(), reverse=True
                )
                if snapshot["user_id"] == params["uid"]
            ]
            await asyncio.sleep(0)
            return _Result(rows=rows)

        if sql.startswith("DELETE FROM sync_snapshots WHERE id = :id AND user_id"):
            snapshot = self.backend.snapshots.get(params["id"])
            if snapshot and snapshot["user_id"] == params["uid"]:
                self.backend.snapshots.pop(params["id"], None)
                self.backend.snapshot_items.pop(params["id"], None)
            return _Result()

        if sql.startswith("SELECT MAX(revision) FROM sync_changes"):
            values = [row[0] for row in self.backend.changes if row[6] == params["uid"]]
            return _Result(scalar_value=max(values, default=None))

        if sql.startswith("INSERT INTO sync_snapshots"):
            snapshot_id = self.backend.next_snapshot_id
            self.backend.next_snapshot_id += 1
            self.backend.snapshots[snapshot_id] = {
                "id": snapshot_id,
                "user_id": params["uid"],
                "token_hash": params["token_hash"],
                "snapshot_revision": params["snapshot_revision"],
                "total_items": 0,
                "expires_at": params["expires_at"],
            }
            self.backend.snapshot_items[snapshot_id] = []
            active_count = sum(
                snapshot["user_id"] == params["uid"]
                for snapshot in self.backend.snapshots.values()
            )
            self.backend.max_active_snapshots = max(
                self.backend.max_active_snapshots, active_count
            )
            return _Result(lastrowid=snapshot_id)

        if sql.startswith("SELECT module, record_id, data, revision FROM sync_data"):
            rows = [
                row for row in self.backend.records
                if row[4] == params["uid"] and row[3] <= params["snapshot_revision"]
            ]
            if "last_module" in params:
                boundary = (params["last_module"], params["last_record_id"])
                rows = [row for row in rows if (row[0], row[1]) > boundary]
            rows = sorted(rows, key=lambda row: (row[0], row[1]))[:params["lim"]]
            return _Result(rows=[row[:4] for row in rows])

        if sql.startswith("INSERT INTO sync_snapshot_items"):
            assert isinstance(params, list)
            self.backend.materialize_batch_sizes.append(len(params))
            for item in params:
                self.backend.snapshot_items[item["snapshot_id"]].append((
                    item["sort_key"], item["module"], item["record_id"],
                    item["data"], item["revision"],
                ))
            return _Result()

        if sql.startswith("UPDATE sync_snapshots SET total_items"):
            self.backend.snapshots[params["id"]]["total_items"] = params["total"]
            return _Result()

        if sql.startswith("SELECT sort_key, module, record_id, data, revision"):
            rows = [
                row for row in self.backend.snapshot_items[params["snapshot_id"]]
                if row[0] > params["cursor"]
            ][:params["lim"]]
            return _Result(rows=rows)

        if sql.startswith("SELECT id, user_id, snapshot_revision, total_items, expires_at"):
            snapshot = next((
                value for value in self.backend.snapshots.values()
                if value["token_hash"] == params["token_hash"]
            ), None)
            if snapshot is None:
                return _Result(row=None)
            return _Result(row=(
                snapshot["id"], snapshot["user_id"], snapshot["snapshot_revision"],
                snapshot["total_items"], snapshot["expires_at"],
            ))

        if sql.startswith("DELETE FROM sync_snapshots WHERE id = :id"):
            self.backend.snapshots.pop(params["id"], None)
            self.backend.snapshot_items.pop(params["id"], None)
            return _Result()

        raise AssertionError(f"unexpected SQL: {sql}")

    async def commit(self):
        self.commits += 1
        self._release_user_lock()

    async def rollback(self):
        self.rollbacks += 1
        self._release_user_lock()

    def _release_user_lock(self):
        if self._held_user_lock is not None:
            self._held_user_lock.release()
            self._held_user_lock = None


def _large_backend(total: int = 25_000) -> _PagingBackend:
    modules = ("farms", "horses", "owners", "races")
    records = []
    changes = []
    for index in range(total):
        module = modules[index % len(modules)]
        record_id = f"record_{index:05d}"
        revision = 10 + index * 3  # 模拟其他用户占用全局revision形成空洞。
        data = {"id": record_id, "ordinal": index}
        records.append((module, record_id, data, revision, 77))
        changes.append((revision, module, record_id, "upsert", data, None, 77))
    return _PagingBackend(user_id=77, records=records, changes=changes)


@pytest.mark.asyncio
async def test_pull_25000_records_has_no_missing_or_duplicate_pages():
    backend = _large_backend()
    session = _PagingSession(backend)
    cursor = 0
    seen_revisions = []
    seen_keys = []
    page_count = 0

    while True:
        page = await pull_changes(session, 77, cursor, 500)
        page_count += 1
        revisions = [item["revision"] for item in page["changes"]]
        assert revisions == sorted(revisions)
        assert all(revision > cursor for revision in revisions)
        seen_revisions.extend(revisions)
        seen_keys.extend((item["module"], item["id"]) for item in page["changes"])
        assert page["reset_required"] is False
        assert page["next_cursor"] >= cursor
        cursor = page["next_cursor"]
        if not page["has_more"]:
            break

    assert page_count == 50
    assert len(seen_keys) == 25_000
    assert len(set(seen_keys)) == 25_000
    assert seen_revisions == [row[0] for row in backend.changes]
    assert cursor == backend.changes[-1][0]


@pytest.mark.asyncio
async def test_snapshot_25000_records_materializes_and_pages_across_new_sessions(monkeypatch):
    config = get_config()
    monkeypatch.setattr(config, "SNAPSHOT_PAGE_SIZE", 500)
    backend = _large_backend()

    first = await get_snapshot(_PagingSession(backend), 77, None, None)
    token = first["snapshot_token"]
    snapshot_revision = first["snapshot_revision"]
    assert first["total_items"] == 25_000
    assert len(first["items"]) == 500
    assert first["next_cursor"] == 499
    assert first["has_more"] is True
    assert all(token != snapshot["token_hash"] for snapshot in backend.snapshots.values())

    pages = 1
    cursor = first["next_cursor"]
    items = list(first["items"])
    while first["has_more"]:
        # 新Session共享持久backend，模拟API进程/服务实例重建后继续旧token。
        first = await get_snapshot(_PagingSession(backend), 77, token, cursor)
        pages += 1
        items.extend(first["items"])
        if first["has_more"]:
            assert first["next_cursor"] is not None
            assert first["next_cursor"] > cursor
            cursor = first["next_cursor"]

    keys = [(item["module"], item["id"]) for item in items]
    expected_keys = [(row[0], row[1]) for row in sorted(
        backend.records, key=lambda row: (row[0], row[1])
    )]
    assert pages == 50
    assert len(items) == 25_000
    assert len(set(keys)) == 25_000
    assert keys == expected_keys
    assert all(item["revision"] <= snapshot_revision for item in items)
    assert backend.materialize_batch_sizes == [500] * 50


@pytest.mark.asyncio
async def test_concurrent_snapshot_creation_never_exceeds_active_limit(monkeypatch):
    config = get_config()
    monkeypatch.setattr(config, "SNAPSHOT_MAX_ACTIVE_PER_USER", 3)
    backend = _PagingBackend(user_id=77, records=[], changes=[])
    sessions = [_PagingSession(backend) for _ in range(6)]

    results = await asyncio.gather(*[
        get_snapshot(session, 77, None, None)
        for session in sessions
    ])

    assert len(results) == 6
    assert all(result["total_items"] == 0 for result in results)
    assert len({result["snapshot_token"] for result in results}) == 6
    active = [
        snapshot for snapshot in backend.snapshots.values()
        if snapshot["user_id"] == 77
    ]
    assert len(active) == 3
    assert backend.max_active_snapshots == 3
    assert len(backend.snapshot_items) == 3
    assert all(session.commits == 1 for session in sessions)
    assert all(session.rollbacks == 0 for session in sessions)
