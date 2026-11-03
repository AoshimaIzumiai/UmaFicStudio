"""管理员接口最小安全边界测试，不连接数据库、不修改生产。"""

import logging

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient

from app.config import get_config
from app.main import create_app
from app.routers.admin import _verify_admin


def _admin_check_app():
    app = create_app()

    @app.get("/__test__/admin-check")
    async def admin_check(request: Request):
        _verify_admin(request)
        return {"ok": True}

    return app


@pytest.mark.asyncio
async def test_public_source_is_denied_even_with_valid_key(caplog):
    app = _admin_check_app()
    transport = ASGITransport(
        app=app, client=("203.0.113.25", 43100), raise_app_exceptions=False
    )
    caplog.set_level(logging.WARNING, logger="umafic.security")

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/__test__/admin-check",
            headers={"X-Admin-Key": get_config().ADMIN_KEY},
        )

    assert response.status_code == 403
    error = response.json()
    assert error["code"] == "FORBIDDEN"
    assert error["message"] == "Admin API is localhost only"
    assert "detail" not in error
    assert error["request_id"] == response.headers["X-Request-ID"]
    assert "reason=source" in caplog.text
    assert get_config().ADMIN_KEY not in caplog.text
    assert get_config().ADMIN_KEY not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_key", [
    b"wrong-secret-sentinel",
    "异常密钥".encode("utf-8"),
    b"",
])
async def test_bad_or_non_ascii_key_is_403_not_500_and_never_logged(bad_key, caplog):
    app = _admin_check_app()
    transport = ASGITransport(
        app=app, client=("127.0.0.1", 43101), raise_app_exceptions=False
    )
    caplog.set_level(logging.WARNING, logger="umafic.security")

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/__test__/admin-check",
            headers=[(b"X-Admin-Key", bad_key)],
        )

    assert response.status_code == 403
    error = response.json()
    assert error["code"] == "FORBIDDEN"
    assert error["message"] == "Invalid admin key"
    assert error["request_id"] == response.headers["X-Request-ID"]
    assert "detail" not in error
    assert "reason=key" in caplog.text
    assert "wrong-secret-sentinel" not in caplog.text
    assert "wrong-secret-sentinel" not in response.text


@pytest.mark.asyncio
async def test_localhost_with_valid_key_is_allowed(caplog):
    app = _admin_check_app()
    transport = ASGITransport(
        app=app, client=("127.0.0.1", 43102), raise_app_exceptions=False
    )
    caplog.set_level(logging.WARNING, logger="umafic.security")

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/__test__/admin-check",
            headers={"X-Admin-Key": get_config().ADMIN_KEY},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert response.headers["X-Request-ID"]
    assert "admin_access_denied" not in caplog.text
