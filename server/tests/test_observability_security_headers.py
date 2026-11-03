"""R7 结构化请求日志与安全响应头测试。"""

import json
import logging

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.observability import anonymize_user_id, bind_request_user


SECURITY_HEADERS = {
    "content-security-policy",
    "referrer-policy",
    "x-frame-options",
    "x-content-type-options",
    "permissions-policy",
}


def _log_test_app():
    app = create_app()

    @app.post("/__test__/echo")
    async def echo(payload: dict, request: Request):
        bind_request_user(request, 42)
        return {"accepted": bool(payload)}

    @app.get("/__test__/validated")
    async def validated(value: int):
        return {"value": value}

    @app.get("/__test__/raise")
    async def raise_unhandled():
        raise RuntimeError("sensitive-test-error")

    return app


@pytest.mark.asyncio
async def test_structured_request_log_uses_allowlist_and_anonymous_user(caplog):
    app = _log_test_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    caplog.set_level(logging.INFO, logger="umafic.request")

    token = "TOKEN_SHOULD_NEVER_BE_LOGGED"
    payload_secret = "PAYLOAD_SHOULD_NEVER_BE_LOGGED"
    query_secret = "QUERY_SHOULD_NEVER_BE_LOGGED"
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            f"/__test__/echo?secret={query_secret}",
            headers={"Authorization": f"Bearer {token}"},
            json={"secret": payload_secret},
        )

    assert response.status_code == 200
    records = [
        record for record in caplog.records
        if record.name == "umafic.request" and '"event":"http_request"' in record.getMessage()
    ]
    assert len(records) == 1
    event = json.loads(records[0].getMessage())
    assert set(event) == {
        "event", "request_id", "method", "route", "status", "latency_ms", "user",
    }
    assert event["method"] == "POST"
    assert event["route"] == "/__test__/echo"
    assert event["status"] == 200
    assert event["latency_ms"] >= 0
    assert event["request_id"] == response.headers["X-Request-ID"]
    assert event["user"] == anonymize_user_id(42)
    assert event["user"].startswith("user_")
    assert event["user"] != "42"
    logged = records[0].getMessage()
    assert token not in logged
    assert payload_secret not in logged
    assert query_secret not in logged
    assert "authorization" not in logged.lower()


@pytest.mark.asyncio
async def test_unauthenticated_request_log_uses_route_template_not_query(caplog):
    app = create_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    caplog.set_level(logging.INFO, logger="umafic.request")

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health/live?token=PRIVATE_QUERY_VALUE")

    assert response.status_code == 200
    records = [record for record in caplog.records if record.name == "umafic.request"]
    assert len(records) == 1
    event = json.loads(records[0].getMessage())
    assert event["route"] == "/health/live"
    assert event["user"] == "anonymous"
    assert "PRIVATE_QUERY_VALUE" not in records[0].getMessage()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path", "kwargs", "expected_status"),
    [
        ("GET", "/health/live", {}, 200),
        ("GET", "/does-not-exist", {}, 404),
        ("GET", "/__test__/validated?value=invalid", {}, 422),
        ("GET", "/__test__/raise", {}, 500),
        (
            "OPTIONS",
            "/api/auth/login",
            {"headers": {
                "Origin": "https://umaficstudio.com",
                "Access-Control-Request-Method": "POST",
            }},
            200,
        ),
    ],
)
async def test_security_headers_cover_success_error_validation_and_preflight(
    method, path, kwargs, expected_status
):
    app = _log_test_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.request(method, path, **kwargs)

    assert response.status_code == expected_status
    assert SECURITY_HEADERS <= set(response.headers)
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert "camera=()" in response.headers["Permissions-Policy"]
    if path.startswith("/api/"):
        assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_api_csp_is_strict_but_development_docs_remain_usable():
    app = create_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        api_response = await client.get("/openapi.json")
        docs_response = await client.get("/api/docs")

    assert api_response.status_code == 200
    assert api_response.headers["Content-Security-Policy"].startswith("default-src 'none'")
    assert "unsafe-inline" not in api_response.headers["Content-Security-Policy"]
    assert docs_response.status_code == 200
    docs_csp = docs_response.headers["Content-Security-Policy"]
    assert "https://cdn.jsdelivr.net" in docs_csp
    assert "script-src" in docs_csp
    assert "frame-ancestors 'none'" in docs_csp


@pytest.mark.asyncio
async def test_malicious_origin_gets_no_cors_allow_origin_but_keeps_security_headers():
    app = create_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.status_code == 400
    assert "Access-Control-Allow-Origin" not in response.headers
    assert SECURITY_HEADERS <= set(response.headers)


@pytest.mark.asyncio
async def test_structured_log_covers_cors_preflight(caplog):
    app = create_app()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    caplog.set_level(logging.INFO, logger="umafic.request")

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/api/auth/login",
            headers={
                "Origin": "https://umaficstudio.com",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.status_code == 200
    records = [record for record in caplog.records if record.name == "umafic.request"]
    assert len(records) == 1
    event = json.loads(records[0].getMessage())
    assert event["method"] == "OPTIONS"
    assert event["route"] == "/api/auth/login"
    assert event["status"] == 200
    assert event["user"] == "anonymous"
