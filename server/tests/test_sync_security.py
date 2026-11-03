"""同步核心端点双用户隔离与错误契约集成测试。"""

import os

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text


@pytest.fixture
async def isolated_sync_client():
    required = ["TEST_DB_HOST", "TEST_DB_USER", "TEST_DB_PASSWORD", "TEST_DB_NAME"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        pytest.skip(f"未配置测试数据库环境变量：{', '.join(missing)}")
    if not os.environ["TEST_DB_NAME"].endswith("_test"):
        pytest.fail("TEST_DB_NAME 必须以 _test 结尾")

    os.environ.update({
        "APP_ENV": "test",
        "JWT_SECRET": "sync_security_test_secret_32bytes!!",
        "ADMIN_KEY": "sync_security_test_admin",
        "DB_HOST": os.environ["TEST_DB_HOST"],
        "DB_PORT": os.getenv("TEST_DB_PORT", "3306"),
        "DB_USER": os.environ["TEST_DB_USER"],
        "DB_PASSWORD": os.environ["TEST_DB_PASSWORD"],
        "DB_NAME": os.environ["TEST_DB_NAME"],
    })

    from app.config import get_config
    get_config.cache_clear()
    from app import deps
    from app.deps import close_db, init_db
    from app.main import create_app

    await close_db()
    await init_db()
    async with deps._engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))

    async with AsyncClient(
        transport=ASGITransport(app=create_app(), raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client

    async with deps._engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))
    await close_db()


async def _register(client: AsyncClient, username: str) -> dict:
    response = await client.post("/api/auth/register", json={
        "username": username,
        "password": "Password7",
    })
    assert response.status_code == 201
    return {
        "token": response.json()["token"],
        "headers": {"Authorization": f"Bearer {response.json()['token']}"},
    }


def _assert_request_id(response) -> dict:
    payload = response.json()
    assert payload["request_id"]
    assert response.headers["X-Request-ID"] == payload["request_id"]
    return payload


@pytest.mark.asyncio
async def test_user_a_data_never_leaks_to_user_b_core_endpoints(isolated_sync_client):
    client = isolated_sync_client
    user_a = await _register(client, "isolation_a")
    user_b = await _register(client, "isolation_b")

    upsert = {
        "module": "horses",
        "changes": [{
            "op_id": "isolation_upsert_a",
            "id": "private_horse_a",
            "action": "upsert",
            "data": {"id": "private_horse_a", "name": "A-ONLY-競馬"},
            "known_revision": None,
        }],
    }
    pushed = await client.post("/api/sync/push", headers=user_a["headers"], json=upsert)
    assert pushed.status_code == 200
    pushed_body = _assert_request_id(pushed)
    upsert_revision = pushed_body["results"][0]["revision"]
    assert pushed_body["results"][0]["status"] == "accepted"

    duplicate = await client.post("/api/sync/push", headers=user_a["headers"], json=upsert)
    duplicate_body = _assert_request_id(duplicate)
    assert duplicate.status_code == 200
    assert duplicate_body["results"] == [{
        "op_id": "isolation_upsert_a",
        "status": "duplicate",
        "revision": upsert_revision,
        "id": None,
        "delete_revision": None,
    }]

    a_pull = await client.get("/api/sync/pull?cursor=0", headers=user_a["headers"])
    assert a_pull.status_code == 200
    assert _assert_request_id(a_pull)["changes"][0]["data"]["name"] == "A-ONLY-競馬"

    b_pull = await client.get("/api/sync/pull?cursor=0", headers=user_b["headers"])
    assert b_pull.status_code == 200
    assert _assert_request_id(b_pull)["changes"] == []

    b_status = await client.get("/api/sync/status", headers=user_b["headers"])
    b_status_body = _assert_request_id(b_status)
    assert b_status.status_code == 200
    assert b_status_body["current_revision"] == 0
    assert b_status_body["total_size_bytes"] == 0
    assert b_status_body["modules"]["horses"]["count"] == 0

    b_export = await client.get("/api/sync/export", headers=user_b["headers"])
    assert b_export.status_code == 200
    assert b_export.headers["X-Request-ID"]
    assert b_export.json()["modules"]["horses"] == []
    assert "A-ONLY" not in b_export.text

    deleted = await client.post("/api/sync/push", headers=user_a["headers"], json={
        "module": "horses",
        "changes": [{
            "op_id": "isolation_delete_a",
            "id": "private_horse_a",
            "action": "delete",
            "known_revision": upsert_revision,
        }],
    })
    deleted_body = _assert_request_id(deleted)
    assert deleted.status_code == 200
    delete_revision = deleted_body["results"][0]["revision"]

    a_trash = await client.get("/api/sync/trash", headers=user_a["headers"])
    a_trash_body = _assert_request_id(a_trash)
    assert a_trash.status_code == 200
    assert len(a_trash_body["items"]) == 1
    assert a_trash_body["items"][0]["data"]["name"] == "A-ONLY-競馬"

    b_trash = await client.get("/api/sync/trash", headers=user_b["headers"])
    assert b_trash.status_code == 200
    assert _assert_request_id(b_trash)["items"] == []

    b_restore = await client.post("/api/sync/restore", headers=user_b["headers"], json={
        "module": "horses",
        "id": "private_horse_a",
        "base_delete_revision": delete_revision,
    })
    assert b_restore.status_code == 404
    assert _assert_request_id(b_restore)["code"] == "NOT_FOUND"

    a_restore = await client.post("/api/sync/restore", headers=user_a["headers"], json={
        "module": "horses",
        "id": "private_horse_a",
        "base_delete_revision": delete_revision,
    })
    assert a_restore.status_code == 200
    assert _assert_request_id(a_restore)["data"]["name"] == "A-ONLY-競馬"

    a_export = await client.get("/api/sync/export", headers=user_a["headers"])
    assert a_export.status_code == 200
    assert a_export.json()["modules"]["horses"][0]["data"]["name"] == "A-ONLY-競馬"


@pytest.mark.asyncio
async def test_core_endpoints_reject_invalid_or_unauthorized_requests(isolated_sync_client):
    client = isolated_sync_client
    user = await _register(client, "invalid_probe")

    cases = [
        await client.get("/api/sync/status"),
        await client.get("/api/sync/export"),
        await client.get("/api/sync/pull?cursor=-1", headers=user["headers"]),
        await client.get("/api/sync/trash?module=press_articles", headers=user["headers"]),
        await client.post("/api/sync/restore", headers=user["headers"], json={
            "module": "press_articles", "id": "record_1", "base_delete_revision": 1,
        }),
        await client.post("/api/sync/push", headers=user["headers"], json={
            "module": "press_articles",
            "changes": [{
                "op_id": "invalid_module", "id": "record_1",
                "action": "upsert", "data": {"id": "record_1"},
            }],
        }),
    ]
    assert [response.status_code for response in cases] == [401, 401, 422, 400, 422, 422]
    for response in cases:
        payload = _assert_request_id(response)
        assert "detail" not in payload
        assert payload["code"] in {"TOKEN_INVALID", "VALIDATION_ERROR"}


@pytest.mark.asyncio
async def test_persistent_xss_payload_remains_json_and_is_user_isolated(isolated_sync_client):
    client = isolated_sync_client
    user_a = await _register(client, "xss_owner_a")
    user_b = await _register(client, "xss_other_b")
    xss_payload = '</script><img src=x onerror="alert(1)">競馬'

    pushed = await client.post("/api/sync/push", headers=user_a["headers"], json={
        "module": "horses",
        "changes": [{
            "op_id": "persistent_xss_probe",
            "id": "xss_probe_record",
            "action": "upsert",
            "data": {"id": "xss_probe_record", "name": xss_payload},
        }],
    })
    assert pushed.status_code == 200

    owner_pull = await client.get("/api/sync/pull?cursor=0", headers=user_a["headers"])
    assert owner_pull.status_code == 200
    assert owner_pull.headers["Content-Type"].startswith("application/json")
    assert owner_pull.headers["X-Content-Type-Options"] == "nosniff"
    assert owner_pull.json()["changes"][0]["data"]["name"] == xss_payload

    owner_export = await client.get("/api/sync/export", headers=user_a["headers"])
    assert owner_export.status_code == 200
    assert owner_export.headers["Content-Type"].startswith("application/json")
    assert owner_export.headers["Content-Security-Policy"].startswith("default-src 'none'")
    assert owner_export.json()["modules"]["horses"][0]["data"]["name"] == xss_payload

    other_pull = await client.get("/api/sync/pull?cursor=0", headers=user_b["headers"])
    other_export = await client.get("/api/sync/export", headers=user_b["headers"])
    assert other_pull.json()["changes"] == []
    assert other_export.json()["modules"]["horses"] == []
    assert xss_payload not in other_export.text
