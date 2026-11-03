"""Status配额口径：活动数据与含tombstone payload总量分离。"""

import json

import pytest

from app.services.sync_service import get_status


class _Result:
    def __init__(self, *, row=None, scalar_value=None):
        self._row = row
        self._scalar = scalar_value

    def fetchone(self):
        return self._row

    def scalar(self):
        return self._scalar


class _StatusSession:
    def __init__(self, records, current_revision):
        self.records = records
        self.current_revision = current_revision

    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}

        if sql.startswith("SELECT COUNT(*), MAX(revision)"):
            active = [
                record for record in self.records
                if record["user_id"] == params["uid"]
                and record["module"] == params["mod"]
                and record["is_tombstone"] == 0
            ]
            size = sum(
                len(record["data"].encode("utf-8"))
                for record in active if record["data"] is not None
            )
            return _Result(row=(
                len(active),
                max((record["revision"] for record in active), default=None),
                size,
            ))

        if sql.startswith("SELECT COALESCE(SUM(LENGTH(data)), 0) FROM sync_data"):
            total = sum(
                len(record["data"].encode("utf-8"))
                for record in self.records
                if record["user_id"] == params["uid"] and record["data"] is not None
            )
            return _Result(scalar_value=total)

        if sql.startswith("SELECT GREATEST(") and "SELECT MAX(revision)" in sql:
            return _Result(scalar_value=self.current_revision)

        raise AssertionError(f"unexpected SQL: {sql}")


def _encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


@pytest.mark.asyncio
async def test_status_total_matches_quota_and_includes_retained_tombstone_utf8_bytes():
    active_horse = _encoded({"id": "active", "name": "競馬"})
    deleted_horse = _encoded({"id": "deleted", "name": "削除済み"})
    active_owner = _encoded({"id": "owner", "name": "馬主"})
    records = [
        {"user_id": 5, "module": "horses", "data": active_horse,
         "revision": 10, "is_tombstone": 0},
        {"user_id": 5, "module": "horses", "data": deleted_horse,
         "revision": 11, "is_tombstone": 1},
        {"user_id": 5, "module": "owners", "data": active_owner,
         "revision": 12, "is_tombstone": 0},
        {"user_id": 5, "module": "races", "data": None,
         "revision": 13, "is_tombstone": 1},
        {"user_id": 6, "module": "horses", "data": _encoded({"secret": "other"}),
         "revision": 99, "is_tombstone": 0},
    ]

    status = await get_status(_StatusSession(records, current_revision=13), 5)
    active_expected = len(active_horse.encode("utf-8")) + len(active_owner.encode("utf-8"))
    total_expected = active_expected + len(deleted_horse.encode("utf-8"))

    assert status["modules"]["horses"] == {
        "count": 1,
        "last_revision": 10,
        "size_bytes": len(active_horse.encode("utf-8")),
    }
    assert status["modules"]["owners"]["size_bytes"] == len(active_owner.encode("utf-8"))
    assert status["active_size_bytes"] == active_expected
    assert status["total_size_bytes"] == total_expected
    assert status["total_size_bytes"] > status["active_size_bytes"]
    assert status["current_revision"] == 13
