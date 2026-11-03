"""物化 snapshot API 集成测试。仅在显式 TEST_DB_* 配置时运行。"""

import hashlib
import os
import time

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text


@pytest.fixture
async def snapshot_client():
    required = ["TEST_DB_HOST", "TEST_DB_USER", "TEST_DB_PASSWORD", "TEST_DB_NAME"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        pytest.skip(f"未配置测试数据库环境变量：{', '.join(missing)}")
    if not os.environ["TEST_DB_NAME"].endswith("_test"):
        pytest.fail("TEST_DB_NAME 必须以 _test 结尾")

    os.environ["APP_ENV"] = "test"
    os.environ["JWT_SECRET"] = "snapshot_test_jwt_secret_32bytes!!"
    os.environ["ADMIN_KEY"] = "snapshot_test_admin"
    os.environ["DB_HOST"] = os.environ["TEST_DB_HOST"]
    os.environ["DB_PORT"] = os.getenv("TEST_DB_PORT", "3306")
    os.environ["DB_USER"] = os.environ["TEST_DB_USER"]
    os.environ["DB_PASSWORD"] = os.environ["TEST_DB_PASSWORD"]
    os.environ["DB_NAME"] = os.environ["TEST_DB_NAME"]

    from app.config import get_config
    get_config.cache_clear()
    from app.deps import close_db, init_db, _engine
    from app.main import create_app

    await close_db()
    await init_db()
    from app import deps
    async with deps._engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))

    transport = ASGITransport(app=create_app())
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, deps

    async with deps._engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))
    await close_db()


async def _register(client: AsyncClient, username: str) -> dict:
    response = await client.post(
        "/api/auth/register", json={"username": username, "password": "Snapshot123"}
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _push_many(client: AsyncClient, token: str, records: list[dict], prefix: str):
    headers = {"Authorization": f"Bearer {token}"}
    revisions = {}
    for offset in range(0, len(records), 100):
        chunk = records[offset:offset + 100]
        changes = [
            {
                "op_id": f"{prefix}_{offset + index}",
                "id": record["id"],
                "action": "upsert",
                "data": record,
                "known_revision": None,
                "local_updated_at": int(time.time() * 1000),
            }
            for index, record in enumerate(chunk)
        ]
        response = await client.post(
            "/api/sync/push", headers=headers,
            json={"module": "horses", "changes": changes},
        )
        assert response.status_code == 200, response.text
        for result, record in zip(response.json()["results"], chunk):
            assert result["status"] == "accepted"
            revisions[record["id"]] = result["revision"]
    return revisions


@pytest.mark.asyncio
async def test_snapshot_materialization_paging_security_and_expiry(snapshot_client):
    client, deps = snapshot_client
    user_a = await _register(client, "snapshot_a")
    user_b = await _register(client, "snapshot_b")
    token_a = user_a["token"]
    token_b = user_b["token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    records = [
        {"id": f"horse_{index:04d}", "name": f"original-{index}"}
        for index in range(501)
    ]
    revisions = await _push_many(client, token_a, records, "snapshot_seed")

    first = await client.post("/api/sync/snapshot", headers=headers_a, json={})
    assert first.status_code == 200, first.text
    page1 = first.json()
    assert page1["total_items"] == 501
    assert len(page1["items"]) == 500
    assert page1["has_more"] is True
    assert page1["next_cursor"] == 499
    assert [item["id"] for item in page1["items"]] == [
        f"horse_{index:04d}" for index in range(500)
    ]
    snapshot_token = page1["snapshot_token"]
    snapshot_revision = page1["snapshot_revision"]

    # 数据库只保存 SHA-256，不保存可直接使用的 token 原文。
    async with deps._engine.connect() as conn:
        row = (await conn.execute(
            text("SELECT token_hash FROM sync_snapshots WHERE user_id = :uid"),
            {"uid": user_a["user"]["id"]},
        )).fetchone()
    assert row is not None
    assert row[0] == hashlib.sha256(snapshot_token.encode("utf-8")).hexdigest()
    assert row[0] != snapshot_token

    # 首页重试必须稳定返回同一物化集合。
    retry = await client.post(
        "/api/sync/snapshot", headers=headers_a,
        json={"snapshot_token": snapshot_token, "cursor": -1},
    )
    assert retry.status_code == 200
    assert retry.json()["items"] == page1["items"]

    # 第一页之后并发更新最后一条、插入新条目、删除第一页中的条目。
    update = {
        "op_id": "after_snapshot_update",
        "id": "horse_0500",
        "action": "upsert",
        "data": {"id": "horse_0500", "name": "updated-after-snapshot"},
        "known_revision": revisions["horse_0500"],
        "local_updated_at": int(time.time() * 1000),
    }
    insert = {
        "op_id": "after_snapshot_insert",
        "id": "horse_new",
        "action": "upsert",
        "data": {"id": "horse_new", "name": "new-after-snapshot"},
        "known_revision": None,
        "local_updated_at": int(time.time() * 1000),
    }
    delete = {
        "op_id": "after_snapshot_delete",
        "id": "horse_0001",
        "action": "delete",
        "data": None,
        "known_revision": revisions["horse_0001"],
        "local_updated_at": int(time.time() * 1000),
    }
    mutation = await client.post(
        "/api/sync/push", headers=headers_a,
        json={"module": "horses", "changes": [update, insert, delete]},
    )
    assert mutation.status_code == 200, mutation.text

    second = await client.post(
        "/api/sync/snapshot", headers=headers_a,
        json={"snapshot_token": snapshot_token, "cursor": page1["next_cursor"]},
    )
    assert second.status_code == 200, second.text
    page2 = second.json()
    assert page2["has_more"] is False
    assert len(page2["items"]) == 1
    assert page2["items"][0]["id"] == "horse_0500"
    assert page2["items"][0]["data"]["name"] == "original-500"

    combined = page1["items"] + page2["items"]
    assert len(combined) == page1["total_items"]
    assert len({(item["module"], item["id"]) for item in combined}) == 501

    # 快照 revision 之后的并发变化由普通 pull 完整补齐。
    pulled = await client.get(
        f"/api/sync/pull?cursor={snapshot_revision}&limit=20", headers=headers_a
    )
    assert pulled.status_code == 200
    actions = {(item["id"], item["action"]) for item in pulled.json()["changes"]}
    assert ("horse_0500", "upsert") in actions
    assert ("horse_new", "upsert") in actions
    assert ("horse_0001", "delete") in actions

    # token 绑定用户，另一用户不能读取。
    forbidden = await client.post(
        "/api/sync/snapshot", headers=headers_b,
        json={"snapshot_token": snapshot_token, "cursor": -1},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "SNAPSHOT_FORBIDDEN"

    # 过期明确返回 410，并级联删除物化项。
    async with deps._engine.begin() as conn:
        await conn.execute(
            text("UPDATE sync_snapshots SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) "
                 "WHERE token_hash = :token_hash"),
            {"token_hash": hashlib.sha256(snapshot_token.encode("utf-8")).hexdigest()},
        )
    expired = await client.post(
        "/api/sync/snapshot", headers=headers_a,
        json={"snapshot_token": snapshot_token, "cursor": -1},
    )
    assert expired.status_code == 410
    assert expired.json()["code"] == "SNAPSHOT_EXPIRED"


@pytest.mark.asyncio
async def test_empty_snapshot(snapshot_client):
    client, _ = snapshot_client
    user = await _register(client, "snapshot_empty")
    response = await client.post(
        "/api/sync/snapshot",
        headers={"Authorization": f"Bearer {user['token']}"},
        json={},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["snapshot_revision"] == 0
    assert data["total_items"] == 0
    assert data["items"] == []
    assert data["has_more"] is False
    assert data["next_cursor"] is None
