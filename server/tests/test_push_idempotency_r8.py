"""R8 push响应丢失后的服务端op_id幂等语义。"""

import json
from dataclasses import dataclass, field

import pytest

from app.models.schemas import PushChange
from app.services.sync_service import push_changes


class _Result:
    def __init__(self, *, row=None, scalar_value=None, lastrowid=None):
        self._row = row
        self._scalar = scalar_value
        self.lastrowid = lastrowid

    def fetchone(self):
        return self._row

    def scalar(self):
        return self._scalar


@dataclass
class _PushState:
    next_revision: int = 1
    changes: dict = field(default_factory=dict)
    records: dict = field(default_factory=dict)


class _PushSession:
    def __init__(self, state: _PushState):
        self.state = state
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}

        if sql.startswith("SELECT id FROM users") and "FOR UPDATE" in sql:
            return _Result(row=(params["uid"],))

        if sql.startswith("SELECT revision FROM sync_changes"):
            change = self.state.changes.get((params["uid"], params["op_id"]))
            return _Result(row=(change["revision"],) if change else None)

        if sql.startswith("SELECT id, revision, is_tombstone FROM sync_data"):
            record = self.state.records.get((params["uid"], params["mod"], params["rid"]))
            if not record:
                return _Result(row=None)
            return _Result(row=(record["id"], record["revision"], record["is_tombstone"]))

        if sql.startswith("INSERT INTO sync_changes"):
            revision = self.state.next_revision
            self.state.next_revision += 1
            self.state.changes[(params["uid"], params["op_id"])] = {
                "revision": revision,
                "module": params["mod"],
                "record_id": params["rid"],
                "data": params.get("data"),
            }
            return _Result(lastrowid=revision)

        if sql.startswith("INSERT INTO sync_data"):
            key = (params["uid"], params["mod"], params["rid"])
            self.state.records[key] = {
                "id": len(self.state.records) + 1,
                "data": params.get("data"),
                "revision": params["rev"],
                "is_tombstone": 0,
            }
            return _Result()

        if sql.startswith("UPDATE sync_data SET data"):
            key = (params["uid"], params["mod"], params["rid"])
            self.state.records[key].update({
                "data": params["data"], "revision": params["rev"], "is_tombstone": 0,
            })
            return _Result()

        if "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM sync_data" in sql:
            total = sum(
                len(record["data"].encode("utf-8"))
                for key, record in self.state.records.items()
                if key[0] == params["uid"] and record["data"] is not None
            )
            return _Result(scalar_value=total)

        raise AssertionError(f"unexpected SQL: {sql}")

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


@pytest.mark.asyncio
async def test_committed_push_response_loss_retry_is_duplicate_without_new_revision():
    state = _PushState()
    change = PushChange(
        op_id="response_lost_same_op",
        id="horse_response_lost",
        action="upsert",
        data={"id": "horse_response_lost", "name": "競馬"},
    )

    first_session = _PushSession(state)
    accepted = await push_changes(first_session, 91, "horses", [change])
    # 模拟服务端commit成功后响应在到达客户端前丢失：客户端未看到accepted。
    assert accepted == [{
        "op_id": "response_lost_same_op", "status": "accepted", "revision": 1,
    }]

    retry_session = _PushSession(state)
    duplicate = await push_changes(retry_session, 91, "horses", [change])

    assert duplicate == [{
        "op_id": "response_lost_same_op", "status": "duplicate", "revision": 1,
    }]
    assert state.next_revision == 2
    assert len(state.changes) == 1
    assert len(state.records) == 1
    stored = state.records[(91, "horses", "horse_response_lost")]
    assert stored["revision"] == 1
    assert json.loads(stored["data"])["name"] == "競馬"
    assert first_session.commits == 1
    assert retry_session.commits == 1
    assert first_session.rollbacks == retry_session.rollbacks == 0
