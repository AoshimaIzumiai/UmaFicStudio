"""
依赖注入：数据库连接池、JWT 鉴权
"""

from typing import AsyncGenerator

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text

from app.config import get_config
from app.observability import bind_request_user

# --- Database ---

_engine = None
_session_factory = None


async def init_db():
    global _engine, _session_factory
    config = get_config()
    _engine = create_async_engine(
        config.database_url,
        pool_size=5,
        max_overflow=2,
        pool_recycle=3600,
        echo=(config.APP_ENV == "development"),
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def close_db():
    global _engine, _session_factory
    engine = _engine
    _engine = None
    _session_factory = None
    if engine:
        await engine.dispose()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """请求级数据库会话"""
    if _session_factory is None:
        raise RuntimeError("Database not initialized")
    async with _session_factory() as session:
        yield session


def require_sync_enabled() -> None:
    """紧急关闭云同步网络端点，不影响认证、健康检查或本地数据。"""
    if not get_config().SYNC_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "SYNC_DISABLED", "message": "Cloud sync is temporarily disabled"},
        )


async def check_db() -> bool:
    """健康检查：验证 DB 连接"""
    if _engine is None:
        return False
    try:
        async with _engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


# --- Authentication ---

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> int:
    """
    从 JWT 提取 user_id，并验证 token_version 严格相等。
    返回 user_id (int)。
    """
    config = get_config()

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "Missing authorization token"},
        )

    try:
        payload = jwt.decode(
            credentials.credentials,
            config.JWT_SECRET,
            algorithms=[config.JWT_ALGORITHM],
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "Invalid token"},
        )

    raw_user_id = payload.get("sub")
    try:
        if isinstance(raw_user_id, bool):
            raise ValueError("boolean sub is invalid")
        user_id = int(raw_user_id or 0)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "Invalid token payload"},
        ) from None
    token_version = payload.get("tv", 0)

    if user_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "Invalid token payload"},
        )

    # 查 DB 验证 token_version 严格相等
    result = await db.execute(
        text("SELECT token_version FROM users WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_INVALID", "message": "User not found"},
        )

    if token_version != row[0]:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "TOKEN_REVOKED", "message": "Token has been revoked"},
        )

    bind_request_user(request, user_id)
    return user_id
