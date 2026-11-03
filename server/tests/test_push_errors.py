"""Push 阻断错误和统一错误契约集成测试。"""
import asyncio
import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text


@pytest.fixture
async def push_client():
    required = ["TEST_DB_HOST", "TEST_DB_USER", "TEST_DB_PASSWORD", "TEST_DB_NAME"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        pytest.skip(f"未配置测试数据库环境变量：{', '.join(missing)}")
    if not os.environ["TEST_DB_NAME"].endswith("_test"):
        pytest.fail("TEST_DB_NAME 必须以 _test 结尾")
    os.environ.update({
        "APP_ENV": "test", "JWT_SECRET": "push_test_secret_32bytes_long!!",
        "ADMIN_KEY": "push_test_admin", "DB_HOST": os.environ["TEST_DB_HOST"],
        "DB_PORT": os.getenv("TEST_DB_PORT", "3306"),
        "DB_USER": os.environ["TEST_DB_USER"], "DB_PASSWORD": os.environ["TEST_DB_PASSWORD"],
        "DB_NAME": os.environ["TEST_DB_NAME"],
    })
    from app.config import get_config
    get_config.cache_clear()
    from app.deps import close_db, init_db
    from app import deps
    from app.main import create_app
    await close_db(); await init_db()
    async with deps._engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))
    async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as client:
        yield client
    async with deps._engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))
    await close_db()


@pytest.mark.asyncio
async def test_oversized_record_is_413_and_transaction_unchanged(push_client):
    client = push_client
    registered = await client.post("/api/auth/register", json={
        "username": "push_size", "password": "Password7",
    })
    assert registered.status_code == 201
    headers = {"Authorization": f"Bearer {registered.json()['token']}"}

    before = (await client.get("/api/sync/status", headers=headers)).json()
    response = await client.post("/api/sync/push", headers=headers, json={
        "module": "horses",
        "changes": [{
            "op_id": "oversized_op", "id": "oversized_record", "action": "upsert",
            "data": {"id": "oversized_record", "blob": "x" * (500 * 1024 + 1)},
            "known_revision": None,
        }],
    })
    assert response.status_code == 413
    error = response.json()
    assert error["code"] == "RECORD_TOO_LARGE"
    assert error["details"]["op_id"] == "oversized_op"
    assert error["request_id"]
    assert "detail" not in error

    after = (await client.get("/api/sync/status", headers=headers)).json()
    assert after["current_revision"] == before["current_revision"] == 0
    assert after["total_size_bytes"] == before["total_size_bytes"] == 0
    assert after["modules"]["horses"]["count"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [
    [],
    [{"op_id": "missing_data", "id": "rec_1", "action": "upsert", "data": None}],
    [{"op_id": "delete_data", "id": "rec_2", "action": "delete", "data": {"id": "rec_2"}}],
])
async def test_invalid_push_shapes_use_top_level_422(push_client, changes):
    client = push_client
    registered = await client.post("/api/auth/register", json={
        "username": "shape_user", "password": "Password7",
    })
    assert registered.status_code == 201
    response = await client.post("/api/sync/push", headers={
        "Authorization": f"Bearer {registered.json()['token']}"
    }, json={"module": "horses", "changes": changes})
    assert response.status_code == 422
    error = response.json()
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["errors"]
    assert error["request_id"]
    assert "detail" not in error


@pytest.mark.asyncio
async def test_total_push_request_limit_is_stable_and_write_free(push_client, monkeypatch):
    from app.config import get_config
    monkeypatch.setattr(get_config(), "MAX_PUSH_REQUEST_BYTES", 1000)
    client = push_client
    registered = await client.post("/api/auth/register", json={
        "username": "request_size", "password": "Password7",
    })
    headers = {"Authorization": f"Bearer {registered.json()['token']}"}

    response = await client.post("/api/sync/push", headers=headers, json={
        "module": "horses",
        "changes": [{
            "op_id": "large_request_op", "id": "large_request_record",
            "action": "upsert",
            "data": {"id": "large_request_record", "blob": "x" * 1500},
        }],
    })
    assert response.status_code == 413
    error = response.json()
    assert error["code"] == "PUSH_REQUEST_TOO_LARGE"
    assert error["details"]["actual_bytes"] > error["details"]["max_bytes"]
    status = (await client.get("/api/sync/status", headers=headers)).json()
    assert status["current_revision"] == 0
    assert status["total_size_bytes"] == 0
    assert status["modules"]["horses"]["count"] == 0


@pytest.mark.asyncio
async def test_concurrent_pushes_cannot_exceed_user_quota(push_client, monkeypatch):
    from app.config import get_config
    monkeypatch.setattr(get_config(), "QUOTA_BYTES", 900)
    client = push_client
    registered = await client.post("/api/auth/register", json={
        "username": "quota_race", "password": "Password7",
    })
    headers = {"Authorization": f"Bearer {registered.json()['token']}"}

    async def push(suffix):
        return await client.post("/api/sync/push", headers=headers, json={
            "module": "horses",
            "changes": [{
                "op_id": f"quota_{suffix}", "id": f"quota_{suffix}",
                "action": "upsert",
                "data": {"id": f"quota_{suffix}", "blob": "x" * 500},
            }],
        })

    responses = await asyncio.gather(push("a"), push("b"))
    assert sorted(response.status_code for response in responses) == [200, 413]
    rejected = next(response for response in responses if response.status_code == 413)
    assert rejected.json()["code"] == "QUOTA_EXCEEDED"

    status = (await client.get("/api/sync/status", headers=headers)).json()
    assert status["modules"]["horses"]["count"] == 1
    assert status["total_size_bytes"] <= 900
