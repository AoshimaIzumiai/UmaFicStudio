"""
pytest conftest：提供测试客户端和通用 fixture
"""

import os
import pytest
from httpx import ASGITransport, AsyncClient

# 测试环境
os.environ["APP_ENV"] = "test"
os.environ["JWT_SECRET"] = "test_secret_key_for_testing_only"
os.environ["ADMIN_KEY"] = "test_admin_key"
os.environ["DB_NAME"] = "umafic_test"


@pytest.fixture
async def client():
    """异步测试客户端"""
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def auth_headers():
    """生成带 JWT 的认证头（用于需要鉴权的接口测试）"""
    import jwt
    token = jwt.encode(
        {"sub": "1", "username": "testuser", "tv": 1},
        "test_secret_key_for_testing_only",
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}
