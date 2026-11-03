"""R6 restore：UUID op_id、重复恢复与同用户并发语义。"""

import asyncio
import json
import re
from dataclasses import dataclass, field

import pytest

from app.services.sync_service import (
    _new_restore_op_id,
    get_user_total_size,
    get_user_total_size_locked,
    restore_record,
)


_RESTORE_OP_RE = re.compile(r"^restore_[0-9a-f]{32}$")


class _Result:
    def __init__(self, row=None, scalar_value=None, lastrowid=None):
        self._row = row
        self._scalar = scalar_value
        self.lastrowid = lastrowid

    def fetchone(self):
        return self._row

    def scalar(self):
        return self._scalar


@dataclass
class _SharedRestoreState:
    records: dict
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    revision: int = 100
    changes: list = field(default_factory=list)


class _RestoreSession:
    """只实现 restore_record 会使用的 SQL 语义，并模拟用户行锁。"""

    def __init__(self, shared: _SharedRestoreState):
        self.shared = shared
        self._holds_lock = False

    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}

        if sql.startswith("SELECT id FROM users") and "FOR UPDATE" in sql:
            await self.shared.lock.acquire()
            self._holds_lock = True
            return _Result(row=(params["uid"],))

        if sql.startswith("SELECT data, revision, deleted_at FROM sync_data"):
            record = self.shared.records.get((params["mod"], params["rid"]))
            if not record or not record["is_tombstone"]:
                return _Result(row=None)
            return _Result(row=(record["data"], record["revision"], record["deleted_at"]))

        if "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM sync_data" in sql:
            total = sum(len(record["data"].encode("utf-8")) for record in self.shared.records.values() if record["data"])
            return _Result(scalar_value=total)

        if sql.startswith("INSERT INTO sync_changes"):
            self.shared.revision += 1
            self.shared.changes.append({**params, "revision": self.shared.revision})
            return _Result(lastrowid=self.shared.revision)

        if sql.startswith("UPDATE sync_data SET is_tombstone = 0"):
            record = self.shared.records[(params["mod"], params["rid"])]
            record.update({"is_tombstone": False, "deleted_at": None, "revision": params["rev"]})
            return _Result()

        raise AssertionError(f"unexpected SQL: {sql}")

    async def commit(self):
        if self._holds_lock:
            self._holds_lock = False
            self.shared.lock.release()

    async def rollback(self):
        if self._holds_lock:
            self._holds_lock = False
            self.shared.lock.release()


def _state(*record_ids: str) -> _SharedRestoreState:
    return _SharedRestoreState(records={
        ("horses", record_id): {
            "data": json.dumps({"id": record_id, "name": f"Horse {record_id}"}),
            "revision": index + 10,
            "deleted_at": "2026-08-30T00:00:00",
            "is_tombstone": True,
        }
        for index, record_id in enumerate(record_ids)
    })


def test_restore_op_id_uses_uuid4_shape_and_is_unique():
    values = {_new_restore_op_id() for _ in range(200)}
    assert len(values) == 200
    assert all(_RESTORE_OP_RE.fullmatch(value) for value in values)


@pytest.mark.asyncio
async def test_repeated_restore_changes_state_once_then_returns_not_found():
    shared = _state("repeat")
    first = await restore_record(_RestoreSession(shared), 7, "horses", "repeat", 10)
    second_session = _RestoreSession(shared)
    second = await restore_record(second_session, 7, "horses", "repeat", 10)
    await second_session.rollback()  # 模拟请求结束释放 SELECT ... FOR UPDATE。

    assert first["data"]["id"] == "repeat"
    assert second == {"error": "NOT_FOUND"}
    assert len(shared.changes) == 1
    assert _RESTORE_OP_RE.fullmatch(shared.changes[0]["op_id"])
    assert shared.records[("horses", "repeat")]["is_tombstone"] is False


@pytest.mark.asyncio
async def test_concurrent_same_record_restore_has_one_success_and_one_not_found():
    shared = _state("race")
    sessions = [_RestoreSession(shared), _RestoreSession(shared)]

    results = await asyncio.gather(*[
        restore_record(session, 8, "horses", "race", 10)
        for session in sessions
    ])
    for session in sessions:
        await session.rollback()

    assert sum("revision" in result for result in results) == 1
    assert sum(result == {"error": "NOT_FOUND"} for result in results) == 1
    assert len(shared.changes) == 1
    assert shared.records[("horses", "race")]["is_tombstone"] is False


@pytest.mark.asyncio
async def test_concurrent_different_restores_get_distinct_uuid_op_ids():
    shared = _state("same_second_a", "same_second_b")
    sessions = [_RestoreSession(shared), _RestoreSession(shared)]

    results = await asyncio.gather(
        restore_record(sessions[0], 9, "horses", "same_second_a", 10),
        restore_record(sessions[1], 9, "horses", "same_second_b", 11),
    )

    assert all("revision" in result for result in results)
    op_ids = [change["op_id"] for change in shared.changes]
    assert len(set(op_ids)) == 2
    assert all(_RESTORE_OP_RE.fullmatch(op_id) for op_id in op_ids)


class _SizeSession:
    def __init__(self, value):
        self.value = value
        self.calls = []

    async def execute(self, statement, params):
        self.calls.append((" ".join(str(statement).split()), params))
        return _Result(scalar_value=self.value)


@pytest.mark.asyncio
async def test_user_total_size_queries_have_distinct_locking_semantics():
    unlocked_db = _SizeSession(123)
    locked_db = _SizeSession(456)

    assert await get_user_total_size(unlocked_db, 17) == 123
    assert await get_user_total_size_locked(locked_db, 17) == 456
    assert unlocked_db.calls[0][1] == {"uid": 17}
    assert locked_db.calls[0][1] == {"uid": 17}
    assert "FOR UPDATE" not in unlocked_db.calls[0][0]
    assert locked_db.calls[0][0].endswith("FOR UPDATE")


@pytest.mark.asyncio
async def test_restore_does_not_double_charge_retained_unicode_payload(monkeypatch):
    from app.config import get_config

    shared = _state("unicode")
    payload = json.dumps(
        {"id": "unicode", "name": "競馬・削除から復元"},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    shared.records[("horses", "unicode")]["data"] = payload
    monkeypatch.setattr(get_config(), "QUOTA_BYTES", len(payload.encode("utf-8")))

    result = await restore_record(
        _RestoreSession(shared), 10, "horses", "unicode", 10
    )

    assert result["data"]["name"] == "競馬・削除から復元"
    assert result["revision"] == 101
    assert len(shared.changes) == 1
    assert shared.records[("horses", "unicode")]["is_tombstone"] is False


@pytest.mark.asyncio
async def test_restore_rejects_only_when_existing_counted_total_is_already_over_quota(monkeypatch):
    from app.config import get_config

    shared = _state("over_quota")
    payload = shared.records[("horses", "over_quota")]["data"]
    monkeypatch.setattr(get_config(), "QUOTA_BYTES", len(payload.encode("utf-8")) - 1)
    session = _RestoreSession(shared)

    result = await restore_record(session, 11, "horses", "over_quota", 10)
    await session.rollback()

    assert result == {"error": "QUOTA_EXCEEDED"}
    assert shared.changes == []
    assert shared.records[("horses", "over_quota")]["is_tombstone"] is True
