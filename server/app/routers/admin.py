"""
管理员路由：密码重置（仅 localhost 可访问）
"""

import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_config
from app.deps import get_db
from app.models.schemas import AdminResetPasswordRequest
from app.observability import anonymize_user_id
from app.services.auth_service import (
    get_user_by_username, update_password,
)


logger = logging.getLogger("umafic.security")
router = APIRouter()


def _verify_admin(request: Request):
    """验证管理员密钥和来源 IP"""
    config = get_config()

    # 来源限制：仅 localhost
    client_ip = request.client.host if request.client else ""
    if client_ip not in ("127.0.0.1", "::1", "testclient"):
        logger.warning(
            "admin_access_denied request_id=%s source=%s reason=source",
            getattr(request.state, "request_id", "unknown"), client_ip,
        )
        raise HTTPException(403, detail={
            "code": "FORBIDDEN", "message": "Admin API is localhost only",
        })

    # 密钥验证（常量时间比较，日志不记录密钥）。
    admin_key = request.headers.get("X-Admin-Key", "")
    if not hmac.compare_digest(admin_key.encode("utf-8"), config.ADMIN_KEY.encode("utf-8")):
        logger.warning(
            "admin_access_denied request_id=%s source=%s reason=key",
            getattr(request.state, "request_id", "unknown"), client_ip,
        )
        raise HTTPException(403, detail={
            "code": "FORBIDDEN", "message": "Invalid admin key",
        })

    request.state.log_user = "admin"


@router.post("/reset-password")
async def reset_password(
    body: AdminResetPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """管理员重置用户密码（同时递增 token_version，使所有旧 token 失效）"""
    _verify_admin(request)

    user = await get_user_by_username(db, body.username)
    if not user:
        raise HTTPException(404, detail={
            "code": "NOT_FOUND", "message": "用户不存在",
            "request_id": request.state.request_id,
        })

    # 更新密码 + token_version（与改密码相同逻辑）
    await update_password(db, user["id"], body.new_password)
    logger.info(
        "admin_password_reset request_id=%s source=%s target_user=%s",
        getattr(request.state, "request_id", "unknown"),
        request.client.host if request.client else "unknown",
        anonymize_user_id(user["id"]),
    )

    return {"success": True, "request_id": request.state.request_id}
