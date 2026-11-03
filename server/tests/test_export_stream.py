"""流式导出契约测试：响应启动前完成查询/序列化，禁止返回截断的 200 JSON。"""

import json
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.deps import get_current_user, get_db
from app.main import create_app
from app.models.schemas import SYNCABLE_MODULES


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _ExportDB:
    def __init__(self, rows_by_module=None, failure=None):
        self.rows_by_module = rows_by_module or {}
        self.failure = failure
        self.calls = []

    async def execute(self, _statement, params):
        self.calls.append(params["mod"])
        if self.failure:
            raise self.failure
        return _Rows(self.rows_by_module.get(params["mod"], []))


def _export_app(db):
    app = create_app()

    async def current_user():
        return 73

    async def database():
        yield db

    app.dependency_overrides[get_current_user] = current_user
    app.dependency_overrides[get_db] = database
    return app


@pytest.mark.asyncio
async def test_export_stream_is_complete_safe_json_with_utc_timestamp():
    db = _ExportDB({
        "horses": [
            ('horse_"quoted', {"name": "競馬", "note": "line\nnext"}),
            ("horse_json", '{"name":"文字列JSON"}'),
        ],
    })
    app = _export_app(db)
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/sync/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["content-disposition"].startswith("attachment; filename=umafic_export_")
    assert int(response.headers["content-length"]) == len(response.content)
    payload = response.json()
    assert payload["version"] == "1.0"
    assert payload["exported_at"].endswith("Z")
    datetime.fromisoformat(payload["exported_at"].replace("Z", "+00:00"))
    assert set(payload["modules"]) == set(SYNCABLE_MODULES)
    assert payload["modules"]["horses"][0] == {
        "id": 'horse_"quoted', "data": {"name": "競馬", "note": "line\nnext"},
    }
    assert payload["modules"]["horses"][1]["data"] == {"name": "文字列JSON"}
    assert db.calls == sorted(SYNCABLE_MODULES)
    assert json.loads(response.content) == payload


@pytest.mark.asyncio
async def test_export_query_failure_uses_top_level_500_before_stream_starts():
    sentinel = "sensitive-export-db-detail"
    db = _ExportDB(failure=RuntimeError(sentinel))
    app = _export_app(db)
    transport = ASGITransport(app=app, raise_app_exceptions=False)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/sync/export")

    assert response.status_code == 500
    error = response.json()
    assert error["code"] == "INTERNAL_ERROR"
    assert error["message"] == "Internal server error"
    assert error["request_id"] == response.headers["X-Request-ID"]
    assert "detail" not in error
    assert sentinel not in response.text
