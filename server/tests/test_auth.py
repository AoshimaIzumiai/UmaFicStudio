"""
认证接口集成测试
需要测试数据库 umafic_test（与生产隔离）
"""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def app_client():
    """带数据库初始化的测试客户端"""
    import os
    # 数据库集成测试必须显式配置，避免误连生产库。
    # 示例：TEST_DB_HOST/PORT/USER/PASSWORD/NAME，其中 NAME 必须以 _test 结尾。
    required = [
        "TEST_DB_HOST", "TEST_DB_USER", "TEST_DB_PASSWORD", "TEST_DB_NAME",
    ]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        pytest.skip(f"未配置测试数据库环境变量：{', '.join(missing)}")

    test_db_name = os.environ["TEST_DB_NAME"]
    if not test_db_name.endswith("_test"):
        pytest.fail("TEST_DB_NAME 必须以 _test 结尾，禁止对生产库运行测试")

    os.environ["APP_ENV"] = "test"
    os.environ["JWT_SECRET"] = "test_jwt_secret_32bytes_long!!"
    os.environ["ADMIN_KEY"] = "test_admin_key"
    os.environ["DB_HOST"] = os.environ["TEST_DB_HOST"]
    os.environ["DB_PORT"] = os.getenv("TEST_DB_PORT", "3306")
    os.environ["DB_USER"] = os.environ["TEST_DB_USER"]
    os.environ["DB_PASSWORD"] = os.environ["TEST_DB_PASSWORD"]
    os.environ["DB_NAME"] = test_db_name

    # 清除配置缓存
    from app.config import get_config
    get_config.cache_clear()

    from app.main import create_app
    from app.deps import init_db, close_db

    app = create_app()
    await init_db()

    # 清理测试数据
    from app.deps import _engine
    from sqlalchemy import text
    async with _engine.begin() as conn:
        await conn.execute(text("DELETE FROM users"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    await close_db()


class TestRegister:
    @pytest.mark.asyncio
    async def test_register_success(self, app_client):
        resp = await app_client.post("/api/auth/register", json={
            "username": "testuser", "password": "abc123"
        })
        assert resp.status_code == 201
        data = resp.json()
        assert "token" in data
        assert data["user"]["username"] == "testuser"

    @pytest.mark.asyncio
    async def test_register_duplicate(self, app_client):
        await app_client.post("/api/auth/register", json={
            "username": "dupuser", "password": "abc123"
        })
        resp = await app_client.post("/api/auth/register", json={
            "username": "dupuser", "password": "xyz789"
        })
        assert resp.status_code == 409
        assert resp.json()["code"] == "USERNAME_EXISTS"

    @pytest.mark.asyncio
    async def test_register_unicode_username(self, app_client):
        resp = await app_client.post("/api/auth/register", json={
            "username": "テスト太郎", "password": "abc123"
        })
        assert resp.status_code == 201
        assert resp.json()["user"]["username"] == "テスト太郎"

    @pytest.mark.asyncio
    async def test_register_nfc_equivalent_username_is_duplicate(self, app_client):
        first = await app_client.post("/api/auth/register", json={
            "username": "ガ馬", "password": "abc123"
        })
        assert first.status_code == 201
        assert first.json()["user"]["username"] == "ガ馬"

        duplicate = await app_client.post("/api/auth/register", json={
            "username": "カ\u3099馬", "password": "xyz789"
        })
        assert duplicate.status_code == 409
        assert duplicate.json()["code"] == "USERNAME_EXISTS"

    @pytest.mark.asyncio
    async def test_register_invalid_password_no_letter(self, app_client):
        resp = await app_client.post("/api/auth/register", json={
            "username": "validuser", "password": "123456"
        })
        assert resp.status_code == 422  # Pydantic validation

    @pytest.mark.asyncio
    async def test_register_invalid_password_no_number(self, app_client):
        resp = await app_client.post("/api/auth/register", json={
            "username": "validuser", "password": "abcdef"
        })
        assert resp.status_code == 422


class TestLogin:
    @pytest.mark.asyncio
    async def test_login_success(self, app_client):
        await app_client.post("/api/auth/register", json={
            "username": "loginuser", "password": "abc123"
        })
        resp = await app_client.post("/api/auth/login", json={
            "username": "loginuser", "password": "abc123"
        })
        assert resp.status_code == 200
        assert "token" in resp.json()

    @pytest.mark.asyncio
    async def test_login_wrong_password(self, app_client):
        await app_client.post("/api/auth/register", json={
            "username": "loginuser2", "password": "abc123"
        })
        resp = await app_client.post("/api/auth/login", json={
            "username": "loginuser2", "password": "wrong"
        })
        assert resp.status_code == 401
        assert resp.json()["code"] == "CREDENTIALS_INVALID"

    @pytest.mark.asyncio
    async def test_login_nonexistent_user(self, app_client):
        resp = await app_client.post("/api/auth/login", json={
            "username": "nobody", "password": "abc123"
        })
        assert resp.status_code == 401
        # 不区分用户名不存在和密码错误
        assert resp.json()["code"] == "CREDENTIALS_INVALID"


class TestMe:
    @pytest.mark.asyncio
    async def test_me_success(self, app_client):
        reg = await app_client.post("/api/auth/register", json={
            "username": "meuser", "password": "abc123"
        })
        token = reg.json()["token"]
        resp = await app_client.get("/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert resp.status_code == 200
        assert resp.json()["username"] == "meuser"

    @pytest.mark.asyncio
    async def test_me_no_token(self, app_client):
        resp = await app_client.get("/api/auth/me")
        assert resp.status_code == 401


class TestChangePassword:
    @pytest.mark.asyncio
    async def test_change_password_success(self, app_client):
        reg = await app_client.post("/api/auth/register", json={
            "username": "pwuser", "password": "old123"
        })
        token = reg.json()["token"]

        resp = await app_client.post("/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"old_password": "old123", "new_password": "new456"}
        )
        assert resp.status_code == 200
        new_token = resp.json()["new_token"]
        assert new_token != token

        # 旧 token 应失效
        resp2 = await app_client.get("/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert resp2.status_code == 401

        # 新 token 应可用
        resp3 = await app_client.get("/api/auth/me", headers={
            "Authorization": f"Bearer {new_token}"
        })
        assert resp3.status_code == 200

    @pytest.mark.asyncio
    async def test_change_password_wrong_old(self, app_client):
        reg = await app_client.post("/api/auth/register", json={
            "username": "pwuser2", "password": "old123"
        })
        token = reg.json()["token"]
        resp = await app_client.post("/api/auth/change-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"old_password": "wrongold", "new_password": "new456"}
        )
        assert resp.status_code == 401


class TestDeleteAccount:
    @pytest.mark.asyncio
    async def test_delete_account_success(self, app_client):
        reg = await app_client.post("/api/auth/register", json={
            "username": "deluser", "password": "abc123"
        })
        token = reg.json()["token"]
        resp = await app_client.request("DELETE", "/api/auth/account",
            headers={"Authorization": f"Bearer {token}"},
            json={"confirm_username": "deluser"}
        )
        assert resp.status_code == 200

        # 登录应失败
        resp2 = await app_client.post("/api/auth/login", json={
            "username": "deluser", "password": "abc123"
        })
        assert resp2.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_account_wrong_confirm(self, app_client):
        reg = await app_client.post("/api/auth/register", json={
            "username": "deluser2", "password": "abc123"
        })
        token = reg.json()["token"]
        resp = await app_client.request("DELETE", "/api/auth/account",
            headers={"Authorization": f"Bearer {token}"},
            json={"confirm_username": "wrong_name"}
        )
        assert resp.status_code == 400


class TestAdminResetPassword:
    @pytest.mark.asyncio
    async def test_admin_reset_success(self, app_client):
        # 先注册
        await app_client.post("/api/auth/register", json={
            "username": "resetuser", "password": "old123"
        })

        # 管理员重置
        resp = await app_client.post("/api/admin/reset-password",
            headers={"X-Admin-Key": "test_admin_key"},
            json={"username": "resetuser", "new_password": "new789"}
        )
        assert resp.status_code == 200

        # 用新密码登录
        resp2 = await app_client.post("/api/auth/login", json={
            "username": "resetuser", "password": "new789"
        })
        assert resp2.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize("weak_password", ["123456", "abcdef"])
    async def test_admin_reset_rejects_weak_password(self, app_client, weak_password):
        resp = await app_client.post("/api/admin/reset-password",
            headers={"X-Admin-Key": "test_admin_key"},
            json={"username": "resetuser", "new_password": weak_password}
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_admin_wrong_key(self, app_client):
        resp = await app_client.post("/api/admin/reset-password",
            headers={"X-Admin-Key": "wrong_key"},
            json={"username": "anyone", "new_password": "abc123"}
        )
        assert resp.status_code == 403
