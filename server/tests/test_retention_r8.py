"""R6.8/R8.8 changelog retention floor 的无数据库可靠性测试。"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pytest

from app.services.maintenance_service import cleanup_changelog
from app.services.sync_service import (
    get_current_revision,
    get_min_available_revision,
    pull_changes,
)


class _Result:
    def __init__(self, *, scalar_value=None, rows=None, rowcount=0):
        self._scalar = scalar_value
        self._rows = rows or []
        self.rowcount = rowcount

    def scalar(self):
        return self._scalar

    def fetchall(self):
        return self._rows


@dataclass
class _RetentionState:
    changes: list[dict]
    floors: dict[int, int] = field(default_factory=dict)
    locked_users: list[int] = field(default_factory=list)


class _RetentionSession:
    def __init__(self, state: _RetentionState, *, fail_delete: bool = False):
        self.state = state
        self.fail_delete = fail_delete
        self.commits = 0
        self.rollbacks = 0
        self._floor_before = None
        self._changes_before = None

    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}

        if sql.startswith("SELECT COUNT(*) FROM sync_changes"):
            rows = self._expired(params["cutoff"])
            return _Result(scalar_value=len(rows))

        if (sql.startswith("SELECT revision, user_id FROM sync_changes")
                and "FOR UPDATE" not in sql):
            rows = sorted(self._expired(params["cutoff"]), key=lambda row: row["revision"])
            return _Result(rows=[
                (row["revision"], row["user_id"])
                for row in rows[:params["batch_size"]]
            ])

        if sql.startswith("SELECT id FROM users") and "FOR UPDATE" in sql:
            user_ids = sorted(
                int(value) for key, value in params.items()
                if key.startswith("user_id_")
            )
            self.state.locked_users.extend(user_ids)
            return _Result(rows=[(user_id,) for user_id in user_ids])

        if (sql.startswith("SELECT revision, user_id FROM sync_changes")
                and "FOR UPDATE" in sql):
            allowed = {
                int(value) for key, value in params.items()
                if key.startswith("user_id_")
            }
            rows = [
                row for row in self._expired(params["cutoff"])
                if row["user_id"] in allowed
            ]
            rows.sort(key=lambda row: row["revision"])
            return _Result(rows=[
                (row["revision"], row["user_id"])
                for row in rows[:params["batch_size"]]
            ])

        if sql.startswith("INSERT INTO sync_retention_state"):
            self._snapshot_for_rollback()
            uid = int(params["uid"])
            self.state.floors[uid] = max(
                self.state.floors.get(uid, 0), int(params["floor"])
            )
            return _Result(rowcount=1)

        if sql.startswith("DELETE FROM sync_changes WHERE revision IN"):
            self._snapshot_for_rollback()
            if self.fail_delete:
                raise RuntimeError("simulated delete failure")
            revisions = {
                int(value) for key, value in params.items()
                if key.startswith("revision_")
            }
            before = len(self.state.changes)
            self.state.changes[:] = [
                row for row in self.state.changes
                if not (row["revision"] in revisions and row["created_at"] <= params["cutoff"])
            ]
            return _Result(rowcount=before - len(self.state.changes))

        if sql.startswith("SELECT GREATEST("):
            uid = int(params["uid"])
            retained = [
                row["revision"] for row in self.state.changes
                if row["user_id"] == uid
            ]
            return _Result(scalar_value=max(
                self.state.floors.get(uid, 0), min(retained, default=0)
            ))

        if sql.startswith("SELECT sc.revision, sc.module"):
            uid = int(params["uid"])
            rows = [
                row for row in self.state.changes
                if row["user_id"] == uid and row["revision"] > params["cursor"]
            ]
            rows.sort(key=lambda row: row["revision"])
            return _Result(rows=[
                (
                    row["revision"], row["module"], row["record_id"],
                    row["action"], row.get("data"), row.get("deleted_at"),
                )
                for row in rows[:params["lim"]]
            ])

        raise AssertionError(f"unexpected SQL: {sql}")

    def _expired(self, cutoff):
        return [row for row in self.state.changes if row["created_at"] <= cutoff]

    def _snapshot_for_rollback(self):
        if self._floor_before is None:
            self._floor_before = dict(self.state.floors)
            self._changes_before = [dict(row) for row in self.state.changes]

    async def commit(self):
        self.commits += 1
        self._floor_before = None
        self._changes_before = None

    async def rollback(self):
        self.rollbacks += 1
        if self._floor_before is not None:
            self.state.floors.clear()
            self.state.floors.update(self._floor_before)
            self.state.changes[:] = self._changes_before
        self._floor_before = None
        self._changes_before = None


def _state(now: datetime) -> _RetentionState:
    old = now - timedelta(days=181)
    boundary = now - timedelta(days=180)
    recent = now - timedelta(days=179, hours=23)
    return _RetentionState(changes=[
        {"revision": 10, "user_id": 1, "module": "horses", "record_id": "old-a",
         "action": "upsert", "data": {"id": "old-a"}, "created_at": old},
        {"revision": 15, "user_id": 2, "module": "horses", "record_id": "old-b",
         "action": "upsert", "data": {"id": "old-b"}, "created_at": old},
        {"revision": 20, "user_id": 1, "module": "horses", "record_id": "boundary",
         "action": "delete", "data": None, "created_at": boundary},
        {"revision": 30, "user_id": 1, "module": "horses", "record_id": "recent",
         "action": "upsert", "data": {"id": "recent"}, "created_at": recent},
    ])


@pytest.mark.asyncio
async def test_changelog_cleanup_dry_run_and_exact_180_day_boundary():
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    state = _state(now.replace(tzinfo=None))
    session = _RetentionSession(state)

    result = await cleanup_changelog(session, now=now, retention_days=180)

    assert (result.eligible, result.affected, result.dry_run) == (3, 0, True)
    assert [row["revision"] for row in state.changes] == [10, 15, 20, 30]
    assert state.floors == {}
    assert session.commits == 0


@pytest.mark.asyncio
async def test_changelog_cleanup_batches_and_monotonically_preserves_floor():
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    state = _state(now.replace(tzinfo=None))
    session = _RetentionSession(state)

    first = await cleanup_changelog(
        session, now=now, retention_days=180, batch_size=2, execute=True
    )
    second = await cleanup_changelog(
        session, now=now, retention_days=180, batch_size=2, execute=True
    )
    third = await cleanup_changelog(
        session, now=now, retention_days=180, batch_size=2, execute=True
    )

    assert (first.eligible, first.affected) == (3, 2)
    assert (second.eligible, second.affected) == (1, 1)
    assert (third.eligible, third.affected) == (0, 0)
    assert state.locked_users[:2] == [1, 2]
    assert state.floors == {1: 20, 2: 15}
    assert [row["revision"] for row in state.changes] == [30]
    assert session.commits == 2


@pytest.mark.asyncio
async def test_floor_and_delete_roll_back_together_on_failure():
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    state = _state(now.replace(tzinfo=None))
    session = _RetentionSession(state, fail_delete=True)

    with pytest.raises(RuntimeError, match="simulated delete failure"):
        await cleanup_changelog(
            session, now=now, retention_days=180, batch_size=2, execute=True
        )

    assert state.floors == {}
    assert [row["revision"] for row in state.changes] == [10, 15, 20, 30]
    assert session.commits == 0
    assert session.rollbacks == 1


@pytest.mark.asyncio
async def test_persisted_floor_survives_empty_changelog_and_old_cursor_requires_snapshot():
    state = _RetentionState(changes=[], floors={7: 101})
    session = _RetentionSession(state)

    assert await get_min_available_revision(session, 7) == 101
    assert await get_current_revision(session, 7) == 101
    expired = await pull_changes(session, 7, cursor=100, limit=500)
    assert expired == {
        "changes": [], "next_cursor": 100, "has_more": False,
        "min_available_revision": 101, "reset_required": True,
    }
    current = await pull_changes(session, 7, cursor=101, limit=500)
    assert current["reset_required"] is False
    assert current["changes"] == []
    assert current["next_cursor"] == 101


@pytest.mark.parametrize("kwargs", [
    {"retention_days": 0},
    {"batch_size": 0},
])
@pytest.mark.asyncio
async def test_changelog_cleanup_rejects_non_positive_limits(kwargs):
    with pytest.raises(ValueError):
        await cleanup_changelog(_RetentionSession(_RetentionState([])), **kwargs)
