"""R7 JWT与SQL注入安全回归；无需真实数据库。"""

import base64
import json
from datetime import datetime

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.config import get_config
from app.deps import get_db
from app.main import create_app
from app.models.schemas import PushChange


class _EmptyResult:
    def fetchone(self):
        return None


class _RowResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _RecordingDb:
    def __init__(self):
        self.calls = []

    async def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))
        return _EmptyResult()


def _app_with_db(db):
    app = create_app()

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    return app


def _unsigned_token(payload: dict) -> str:
    def encode(value: dict) -> str:
        raw = json.dumps(value, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    return f"{encode({'alg': 'none', 'typ': 'JWT'})}.{encode(payload)}."


class _AuthenticatedDb:
    async def execute(self, statement, params=None):
        sql = " ".join(str(statement).split())
        if sql.startswith("SELECT token_version FROM users"):
            return _RowResult((1,))
        if sql.startswith("SELECT id, username, token_version, created_at, last_login_at"):
            return _RowResult((42, "loguser", 1, datetime(2026, 8, 30, 12, 0), None))
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.mark.asyncio
async def test_authenticated_response_reuses_request_id_and_never_exposes_raw_log_user():
    token = jwt.encode(
        {"sub": "42", "username": "loguser", "tv": 1},
        get_config().JWT_SECRET,
        algorithm="HS256",
    )
    app = _app_with_db(_AuthenticatedDb())
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "token",
    [
        jwt.encode(
            {"sub": "1", "tv": 1},
            "attacker-controlled-wrong-secret",
            algorithm="HS256",
        ),
        _unsigned_token({"sub": "1", "tv": 1}),
        jwt.encode(
            {"sub": "not-an-integer", "tv": 1},
            get_config().JWT_SECRET,
            algorithm="HS256",
        ),
        jwt.encode(
            {"sub": True, "tv": 1},
            get_config().JWT_SECRET,
            algorithm="HS256",
        ),
    ],
)
async def test_forged_or_malformed_jwt_is_401_without_database_query(token):
    db = _RecordingDb()
    app = _app_with_db(db)
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 401
    assert response.json()["code"] == "TOKEN_INVALID"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"
    assert token not in response.text
    assert db.calls == []


@pytest.mark.asyncio
async def test_username_sql_injection_is_bound_parameter_and_cannot_bypass_login():
    injection = "x' OR 1=1 --"
    db = _RecordingDb()
    app = _app_with_db(db)
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/auth/login",
            json={"username": injection, "password": "Password7"},
        )

    assert response.status_code == 401
    assert response.json()["code"] == "CREDENTIALS_INVALID"
    assert len(db.calls) == 1
    statement, params = db.calls[0]
    assert injection not in statement
    assert ":username" in statement
    assert params == {"username": injection}
    assert injection not in response.text


@pytest.mark.parametrize(
    "malicious_id",
    ["x' OR 1=1 --", "x; DROP TABLE users", "../other-user", "<script>alert(1)</script>"],
)
def test_record_id_injection_payloads_are_rejected_by_schema(malicious_id):
    with pytest.raises(ValidationError):
        PushChange(
            op_id="security_probe",
            id=malicious_id,
            action="upsert",
            data={"id": malicious_id},
        )
