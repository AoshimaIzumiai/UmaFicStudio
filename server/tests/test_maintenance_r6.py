"""R6 离线维护服务的无数据库安全测试。"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.config import BaseConfig
from app.maintenance import _ensure_execution_allowed, build_parser
from app.services.maintenance_service import (
    cleanup_expired_snapshots,
    cleanup_tombstone_payloads,
)


class _Result:
    def __init__(self, *, scalar_value=None, rowcount=0):
        self._scalar = scalar_value
        self.rowcount = rowcount

    def scalar(self):
        return self._scalar


@dataclass
class _MaintenanceState:
    sync_data: list
    snapshots: list
    snapshot_items: list


class _MaintenanceSession:
    def __init__(self, state: _MaintenanceState):
        self.state = state
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        params = params or {}

        if sql.startswith("SELECT COUNT(*) FROM sync_data"):
            rows = self._eligible_tombstones(params["cutoff"])
            return _Result(scalar_value=len(rows))

        if sql.startswith("UPDATE sync_data SET data = NULL"):
            rows = self._eligible_tombstones(params["cutoff"])
            selected = sorted(rows, key=lambda row: row["id"])[:params["batch_size"]]
            for row in selected:
                row["data"] = None
            return _Result(rowcount=len(selected))

        if sql.startswith("SELECT COUNT(*) FROM sync_snapshots"):
            rows = self._expired_snapshots(params["expires_at"])
            return _Result(scalar_value=len(rows))

        if sql.startswith("DELETE FROM sync_snapshots"):
            rows = self._expired_snapshots(params["expires_at"])
            selected = sorted(rows, key=lambda row: row["id"])[:params["batch_size"]]
            selected_ids = {row["id"] for row in selected}
            self.state.snapshots[:] = [
                row for row in self.state.snapshots if row["id"] not in selected_ids
            ]
            # 模拟数据库外键 ON DELETE CASCADE。
            self.state.snapshot_items[:] = [
                row for row in self.state.snapshot_items
                if row["snapshot_id"] not in selected_ids
            ]
            return _Result(rowcount=len(selected))

        raise AssertionError(f"unexpected SQL: {sql}")

    def _eligible_tombstones(self, cutoff):
        return [
            row for row in self.state.sync_data
            if row["is_tombstone"] == 1
            and row["data"] is not None
            and row["deleted_at"] is not None
            and row["deleted_at"] <= cutoff
        ]

    def _expired_snapshots(self, expires_at):
        return [
            row for row in self.state.snapshots
            if row["expires_at"] <= expires_at
        ]

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


def _state(now: datetime) -> _MaintenanceState:
    return _MaintenanceState(
        sync_data=[
            {
                "id": 1, "data": {"name": "old-a"}, "revision": 11,
                "deleted_at": now - timedelta(days=8), "is_tombstone": 1,
            },
            {
                "id": 2, "data": {"name": "old-b"}, "revision": 12,
                "deleted_at": now - timedelta(days=9), "is_tombstone": 1,
            },
            {
                "id": 3, "data": {"name": "recent"}, "revision": 13,
                "deleted_at": now - timedelta(days=6), "is_tombstone": 1,
            },
            {
                "id": 4, "data": None, "revision": 14,
                "deleted_at": now - timedelta(days=20), "is_tombstone": 1,
            },
            {
                "id": 5, "data": {"name": "active"}, "revision": 15,
                "deleted_at": now - timedelta(days=20), "is_tombstone": 0,
            },
        ],
        snapshots=[
            {"id": 21, "expires_at": now - timedelta(seconds=1)},
            {"id": 22, "expires_at": now - timedelta(days=1)},
            {"id": 23, "expires_at": now + timedelta(seconds=1)},
        ],
        snapshot_items=[
            {"id": 31, "snapshot_id": 21},
            {"id": 32, "snapshot_id": 22},
            {"id": 33, "snapshot_id": 23},
        ],
    )


@pytest.mark.asyncio
async def test_tombstone_cleanup_defaults_to_dry_run_without_mutation():
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    state = _state(now.replace(tzinfo=None))
    session = _MaintenanceSession(state)

    result = await cleanup_tombstone_payloads(session, now=now)

    assert result.eligible == 2
    assert result.affected == 0
    assert result.dry_run is True
    assert state.sync_data[0]["data"] == {"name": "old-a"}
    assert session.commits == 0


@pytest.mark.asyncio
async def test_tombstone_cleanup_is_batched_idempotent_and_preserves_fence():
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    state = _state(now.replace(tzinfo=None))
    session = _MaintenanceSession(state)
    preserved = [
        (row["id"], row["revision"], row["deleted_at"], row["is_tombstone"])
        for row in state.sync_data[:2]
    ]

    first = await cleanup_tombstone_payloads(
        session, now=now, execute=True, batch_size=1
    )
    second = await cleanup_tombstone_payloads(
        session, now=now, execute=True, batch_size=1
    )
    third = await cleanup_tombstone_payloads(
        session, now=now, execute=True, batch_size=1
    )

    assert (first.eligible, first.affected) == (2, 1)
    assert (second.eligible, second.affected) == (1, 1)
    assert (third.eligible, third.affected) == (0, 0)
    assert [row["data"] for row in state.sync_data[:2]] == [None, None]
    assert [
        (row["id"], row["revision"], row["deleted_at"], row["is_tombstone"])
        for row in state.sync_data[:2]
    ] == preserved
    assert state.sync_data[2]["data"] == {"name": "recent"}
    assert state.sync_data[4]["data"] == {"name": "active"}
    assert session.commits == 2


@pytest.mark.asyncio
async def test_snapshot_cleanup_is_independent_batched_and_cascades_items():
    now = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)
    state = _state(now.replace(tzinfo=None))
    session = _MaintenanceSession(state)

    dry_run = await cleanup_expired_snapshots(session, now=now)
    first = await cleanup_expired_snapshots(
        session, now=now, execute=True, batch_size=1
    )
    second = await cleanup_expired_snapshots(
        session, now=now, execute=True, batch_size=1
    )
    third = await cleanup_expired_snapshots(
        session, now=now, execute=True, batch_size=1
    )

    assert (dry_run.eligible, dry_run.affected, dry_run.dry_run) == (2, 0, True)
    assert (first.eligible, first.affected) == (2, 1)
    assert (second.eligible, second.affected) == (1, 1)
    assert (third.eligible, third.affected) == (0, 0)
    assert [row["id"] for row in state.snapshots] == [23]
    assert [row["id"] for row in state.snapshot_items] == [33]


def test_maintenance_defaults_are_disabled_and_cli_defaults_to_dry_run():
    config = BaseConfig()
    args = build_parser().parse_args([])

    assert config.MAINTENANCE_ENABLED is False
    assert config.TOMBSTONE_PAYLOAD_RETENTION_DAYS == 7
    assert config.MAINTENANCE_BATCH_SIZE == 500
    assert args.execute is False


def test_execute_requires_maintenance_config_switch():
    disabled = SimpleNamespace(MAINTENANCE_ENABLED=False)
    enabled = SimpleNamespace(MAINTENANCE_ENABLED=True)

    _ensure_execution_allowed(disabled, execute=False)
    _ensure_execution_allowed(enabled, execute=True)
    with pytest.raises(RuntimeError, match="MAINTENANCE_ENABLED=true"):
        _ensure_execution_allowed(disabled, execute=True)


@pytest.mark.parametrize(
    ("cleanup", "kwargs"),
    [
        (cleanup_tombstone_payloads, {"retention_days": 0}),
        (cleanup_tombstone_payloads, {"batch_size": 0}),
        (cleanup_expired_snapshots, {"batch_size": 0}),
    ],
)
@pytest.mark.asyncio
async def test_cleanup_rejects_non_positive_safety_limits(cleanup, kwargs):
    state = _MaintenanceState([], [], [])
    with pytest.raises(ValueError):
        await cleanup(_MaintenanceSession(state), **kwargs)
