"""
基础测试：验证应用可启动、健康检查和 schema 校验
"""

import pytest
from httpx import ASGITransport, AsyncClient
from app.models.schemas import (
    RegisterRequest, PushChange, PushRequest,
    SYNCABLE_MODULES, USERNAME_PATTERN, RECORD_ID_PATTERN,
)


class TestHealthEndpoints:
    """健康检查端点"""

    @pytest.mark.asyncio
    async def test_live(self, client):
        resp = await client.get("/health/live")
        assert resp.status_code == 200
        assert resp.text == "ok"

    @pytest.mark.asyncio
    async def test_ready_without_db(self, client, monkeypatch):
        """数据库探测失败时 readiness 必须确定性返回 503。"""
        import app.deps as deps

        async def unavailable():
            return False

        monkeypatch.setattr(deps, "check_db", unavailable)
        resp = await client.get("/health/ready")
        assert resp.status_code == 503
        assert resp.text == "unavailable"


class TestSchemaValidation:
    """Pydantic schema 校验"""

    def test_valid_username(self):
        req = RegisterRequest(username="テスト用户", password="abc123")
        assert req.username == "テスト用户"

    def test_username_too_short(self):
        with pytest.raises(Exception):
            RegisterRequest(username="a", password="abc123")

    def test_username_invalid_chars(self):
        with pytest.raises(Exception):
            RegisterRequest(username="user name", password="abc123")  # 含空格

    def test_password_no_letter(self):
        with pytest.raises(Exception):
            RegisterRequest(username="testuser", password="123456")

    def test_password_no_number(self):
        with pytest.raises(Exception):
            RegisterRequest(username="testuser", password="abcdef")

    def test_valid_password(self):
        req = RegisterRequest(username="testuser", password="abc123")
        assert req.password == "abc123"

    def test_valid_push_change(self):
        change = PushChange(
            op_id="op_abc123",
            id="horse_001",
            action="upsert",
            data={"name": "テスト馬"},
        )
        assert change.action == "upsert"

    def test_invalid_module(self):
        with pytest.raises(Exception):
            PushRequest(module="press_articles", changes=[])

    def test_valid_module(self):
        for mod in SYNCABLE_MODULES:
            req = PushRequest(module=mod, changes=[
                PushChange(op_id="op_valid", id="rec_valid", action="upsert", data={})
            ])
            assert req.module == mod

    def test_invalid_record_id(self):
        with pytest.raises(Exception):
            PushChange(op_id="op1", id="invalid id!", action="upsert")

    def test_push_batch_limit(self):
        changes = [
            PushChange(op_id=f"op_{i}", id=f"rec_{i}", action="upsert", data={})
            for i in range(101)
        ]
        with pytest.raises(Exception):
            PushRequest(module="horses", changes=changes)


class TestOpenAPISnapshot:
    """OpenAPI schema 快照测试：防止接口字段被意外改动"""

    @pytest.mark.asyncio
    async def test_openapi_schema_fields(self, client):
        resp = await client.get("/api/docs")
        # 开发/测试环境 docs 应可访问
        # 如果 docs_url 被设为 None（生产），这个测试会跳过
        if resp.status_code == 200:
            # 基本验证：响应是 HTML
            assert "swagger" in resp.text.lower() or "openapi" in resp.text.lower()

    @pytest.mark.asyncio
    async def test_openapi_json_available(self, client):
        resp = await client.get("/openapi.json")
        assert resp.status_code == 200
        schema = resp.json()
        # 验证关键路径存在
        paths = schema.get("paths", {})
        assert "/api/auth/register" in paths
        assert "/api/auth/login" in paths
        assert "/api/sync/push" in paths
        assert "/api/sync/pull" in paths
        assert "/api/sync/snapshot" in paths
        assert "/api/sync/status" in paths
        assert "/api/sync/trash" in paths
        assert "/api/sync/restore" in paths
        assert "/api/sync/export" in paths
        assert "/health/live" in paths
        assert "/health/ready" in paths

        snapshot_schema = schema["components"]["schemas"]["SnapshotResponse"]
        assert "total_items" in snapshot_schema["properties"]
        assert "total_items" in snapshot_schema["required"]


class TestPushValidationAndErrors:
    def test_empty_push_batch_rejected(self):
        with pytest.raises(Exception):
            PushRequest(module="horses", changes=[])

    def test_upsert_requires_data(self):
        with pytest.raises(Exception):
            PushChange(op_id="op_missing_data", id="rec_1", action="upsert", data=None)

    def test_delete_rejects_data(self):
        with pytest.raises(Exception):
            PushChange(op_id="op_delete_data", id="rec_1", action="delete", data={"id": "rec_1"})

    @pytest.mark.asyncio
    async def test_404_uses_top_level_error_contract(self, client):
        response = await client.get("/does-not-exist")
        assert response.status_code == 404
        data = response.json()
        assert data["code"] == "NOT_FOUND"
        assert data["message"]
        assert data["request_id"]
        assert "detail" not in data
        assert response.headers["X-Request-ID"]

    @pytest.mark.asyncio
    async def test_sync_kill_switch_returns_top_level_503(self, client, monkeypatch):
        from app.config import get_config
        monkeypatch.setattr(get_config(), "SYNC_ENABLED", False)
        response = await client.get("/api/sync/status")
        assert response.status_code == 503
        data = response.json()
        assert data["code"] == "SYNC_DISABLED"
        assert data["request_id"]
        assert "detail" not in data
        assert response.headers["X-Request-ID"] == data["request_id"]

    @pytest.mark.asyncio
    async def test_unhandled_exception_uses_top_level_500(self):
        from app.main import create_app
        test_app = create_app()

        @test_app.get("/__test__/raise")
        async def raise_unhandled():
            raise RuntimeError("sensitive internal detail")

        transport = ASGITransport(app=test_app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.get("/__test__/raise")
        assert response.status_code == 500
        data = response.json()
        assert data["code"] == "INTERNAL_ERROR"
        assert data["message"] == "Internal server error"
        assert "sensitive" not in response.text
        assert data["request_id"]
        assert response.headers["X-Request-ID"] == data["request_id"]
        assert "detail" not in data

    def test_in_memory_rate_limiter_window(self):
        from app.security import InMemoryRateLimiter, RateRule
        limiter = InMemoryRateLimiter()
        rule = RateRule("test", 2, 10)
        assert limiter.check(rule, "203.0.113.10", now=0) == (True, 0)
        assert limiter.check(rule, "203.0.113.10", now=1) == (True, 0)
        allowed, retry_after = limiter.check(rule, "203.0.113.10", now=2)
        assert not allowed
        assert retry_after == 8
        assert limiter.check(rule, "203.0.113.10", now=11) == (True, 0)

    @pytest.mark.asyncio
    async def test_rate_limit_uses_top_level_429_and_retry_after(self, monkeypatch):
        from app.config import get_config
        from app.main import create_app
        from app.security import rate_limiter
        config = get_config()
        monkeypatch.setattr(config, "RATE_LOGIN_PER_MINUTE", 1)
        rate_limiter._events.clear()
        test_app = create_app()
        transport = ASGITransport(app=test_app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            await client.post("/api/auth/login", json={})
            response = await client.post("/api/auth/login", json={})
        assert response.status_code == 429
        data = response.json()
        assert data["code"] == "RATE_LIMITED"
        assert data["details"]["scope"] == "login"
        assert int(response.headers["Retry-After"]) >= 1
        assert response.headers["X-Request-ID"] == data["request_id"]
        rate_limiter._events.clear()

    @pytest.mark.asyncio
    async def test_content_length_limit_rejects_before_body_parse(self, client):
        response = await client.post(
            "/api/auth/login", content=b"{}", headers={"Content-Length": "51000001"}
        )
        assert response.status_code == 413
        data = response.json()
        assert data["code"] == "REQUEST_TOO_LARGE"
        assert response.headers["X-Request-ID"] == data["request_id"]
