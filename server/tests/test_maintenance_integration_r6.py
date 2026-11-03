"""R6 维护任务真实MySQL集成测试；只允许显式 *_test 数据库。"""

import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import URL, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.services.maintenance_service import (
    cleanup_expired_snapshots,
    cleanup_tombstone_payloads,
)


@pytest.fixture
async def maintenance_db():
    required = ["TEST_DB_HOST", "TEST_DB_USER", "TEST_DB_PASSWORD", "TEST_DB_NAME"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        pytest.skip(f"未配置测试数据库环境变量：{', '.join(missing)}")

    db_name = os.environ["TEST_DB_NAME"]
    if not db_name.endswith("_test"):
        pytest.fail("TEST_DB_NAME 必须以 _test 结尾，禁止对生产库运行测试")

    url = URL.create(
        "mysql+aiomysql",
        username=os.environ["TEST_DB_USER"],
        password=os.environ["TEST_DB_PASSWORD"],
        host=os.environ["TEST_DB_HOST"],
        port=int(os.getenv("TEST_DB_PORT", "3306")),
        database=db_name,
        query={"charset": "utf8mb4"},
    )
    engine = create_async_engine(url, pool_size=1, max_overflow=0)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    username = f"maintenance_{uuid.uuid4().hex[:16]}"

    async with factory() as db:
        inserted = await db.execute(
            text(
                "INSERT INTO users (username, password_hash, token_version, created_at) "
                "VALUES (:username, :password_hash, 1, UTC_TIMESTAMP())"
            ),
            {"username": username, "password_hash": "integration-test-only"},
        )
        await db.commit()
        user_id = int(inserted.lastrowid)
        try:
            yield db, user_id
        finally:
            await db.rollback()
            await db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
            await db.commit()

    await engine.dispose()


@pytest.mark.asyncio
async def test_real_mysql_cleanup_scope_idempotency_and_snapshot_cascade(maintenance_db):
    db, user_id = maintenance_db
    now = datetime.now(timezone.utc).replace(microsecond=0)
    old = now - timedelta(days=8)
    recent = now - timedelta(days=6)

    rows = [
        ("old_payload", {"name": "old"}, 101, old, 1),
        ("recent_payload", {"name": "recent"}, 102, recent, 1),
        ("already_empty", None, 103, old, 1),
        ("active_payload", {"name": "active"}, 104, old, 0),
    ]
    for record_id, data, revision, deleted_at, is_tombstone in rows:
        await db.execute(
            text(
                "INSERT INTO sync_data "
                "(user_id, module, record_id, data, revision, deleted_at, is_tombstone) "
                "VALUES (:uid, 'horses', :rid, :data, :revision, :deleted_at, :tombstone)"
            ),
            {
                "uid": user_id,
                "rid": record_id,
                "data": json.dumps(data, ensure_ascii=False) if data is not None else None,
                "revision": revision,
                "deleted_at": deleted_at.replace(tzinfo=None),
                "tombstone": is_tombstone,
            },
        )

    snapshot_ids = []
    for suffix, expires_at in (
        ("expired", now - timedelta(seconds=1)),
        ("active", now + timedelta(minutes=5)),
    ):
        inserted = await db.execute(
            text(
                "INSERT INTO sync_snapshots "
                "(user_id, token_hash, snapshot_revision, total_items, expires_at, created_at) "
                "VALUES (:uid, :token, 104, 1, :expires_at, UTC_TIMESTAMP())"
            ),
            {
                "uid": user_id,
                "token": uuid.uuid4().hex + uuid.uuid4().hex,
                "expires_at": expires_at.replace(tzinfo=None),
            },
        )
        snapshot_id = int(inserted.lastrowid)
        snapshot_ids.append(snapshot_id)
        await db.execute(
            text(
                "INSERT INTO sync_snapshot_items "
                "(snapshot_id, module, record_id, data, revision, sort_key) "
                "VALUES (:snapshot_id, 'horses', :record_id, :data, 104, 0)"
            ),
            {
                "snapshot_id": snapshot_id,
                "record_id": f"snapshot_{suffix}",
                "data": json.dumps({"id": suffix}),
            },
        )
    await db.commit()

    tombstone_result = await cleanup_tombstone_payloads(
        db, now=now, execute=True, retention_days=7, batch_size=1
    )
    tombstone_repeat = await cleanup_tombstone_payloads(
        db, now=now, execute=True, retention_days=7, batch_size=1
    )
    snapshot_result = await cleanup_expired_snapshots(
        db, now=now, execute=True, batch_size=1
    )
    snapshot_repeat = await cleanup_expired_snapshots(
        db, now=now, execute=True, batch_size=1
    )

    assert (tombstone_result.eligible, tombstone_result.affected) == (1, 1)
    assert (tombstone_repeat.eligible, tombstone_repeat.affected) == (0, 0)
    assert (snapshot_result.eligible, snapshot_result.affected) == (1, 1)
    assert (snapshot_repeat.eligible, snapshot_repeat.affected) == (0, 0)

    data_result = await db.execute(
        text(
            "SELECT record_id, data, revision, deleted_at, is_tombstone "
            "FROM sync_data WHERE user_id = :uid ORDER BY record_id"
        ),
        {"uid": user_id},
    )
    actual = {row[0]: row[1:] for row in data_result.fetchall()}
    assert actual["old_payload"][0] is None
    assert actual["old_payload"][1] == 101
    assert actual["old_payload"][2] == old.replace(tzinfo=None)
    assert actual["old_payload"][3] == 1
    assert actual["recent_payload"][0] is not None
    assert actual["active_payload"][0] is not None

    snapshots = await db.execute(
        text("SELECT id FROM sync_snapshots WHERE user_id = :uid ORDER BY id"),
        {"uid": user_id},
    )
    assert [row[0] for row in snapshots.fetchall()] == [snapshot_ids[1]]
    items = await db.execute(
        text(
            "SELECT snapshot_id FROM sync_snapshot_items "
            "WHERE snapshot_id IN (:expired_id, :active_id) ORDER BY snapshot_id"
        ),
        {"expired_id": snapshot_ids[0], "active_id": snapshot_ids[1]},
    )
    assert [row[0] for row in items.fetchall()] == [snapshot_ids[1]]
