"""
认证路由：注册、登录、用户信息、改密码、删除账号
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user
from app.models.schemas import (
    RegisterRequest, LoginRequest, AuthResponse,
    ChangePasswordRequest, ChangePasswordResponse,
    DeleteAccountRequest,
)
from app.observability import bind_request_user
from app.services.auth_service import (
    normalize_username, get_user_by_username, get_user_by_id,
    create_user, create_token, verify_password,
    update_password, update_last_login, delete_user,
)

router = APIRouter()


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(
    body: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """注册新用户"""
    normalized = normalize_username(body.username)

    # 检查用户名是否已存在
    existing = await get_user_by_username(db, normalized)
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"code": "USERNAME_EXISTS", "message": "用户名已被注册",
                    "request_id": request.state.request_id},
        )

    # 创建用户
    user = await create_user(db, normalized, body.password)
    token = create_token(user["id"], user["username"], user["token_version"])
    bind_request_user(request, user["id"])

    return AuthResponse(
        token=token,
        user={"id": user["id"], "username": user["username"]},
    )


@router.post("/login", response_model=AuthResponse)
async def login(
    body: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """用户登录"""
    user = await get_user_by_username(db, body.username)

    # 统一错误响应（不区分用户名不存在和密码错误）
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIALS_INVALID", "message": "用户名或密码错误",
                    "request_id": request.state.request_id},
        )

    await update_last_login(db, user["id"])
    token = create_token(user["id"], user["username"], user["token_version"])
    bind_request_user(request, user["id"])

    return AuthResponse(
        token=token,
        user={"id": user["id"], "username": user["username"]},
    )


@router.get("/me")
async def me(
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户信息"""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(401, detail={"code": "TOKEN_INVALID", "message": "User not found"})

    return {
        "id": user["id"],
        "username": user["username"],
        "created_at": user["created_at"].isoformat() if user["created_at"] else None,
        "request_id": request.state.request_id,
    }


@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """修改密码（所有旧 token 失效）"""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(401, detail={"code": "TOKEN_INVALID", "message": "User not found"})

    # 需要获取 password_hash 来验证旧密码
    from sqlalchemy import text
    result = await db.execute(
        text("SELECT password_hash FROM users WHERE id = :uid"), {"uid": user_id}
    )
    pw_hash = result.scalar()
    if not verify_password(body.old_password, pw_hash):
        raise HTTPException(
            status_code=401,
            detail={"code": "CREDENTIALS_INVALID", "message": "旧密码错误",
                    "request_id": request.state.request_id},
        )

    # 更新密码 + 递增 token_version
    new_tv = await update_password(db, user_id, body.new_password)
    new_token = create_token(user_id, user["username"], new_tv)

    return ChangePasswordResponse(
        success=True,
        new_token=new_token,
        request_id=request.state.request_id,
    )


@router.delete("/account")
async def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除账号及所有云端数据"""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(401, detail={"code": "TOKEN_INVALID", "message": "User not found"})

    # 确认用户名匹配
    if normalize_username(body.confirm_username) != user["username"]:
        raise HTTPException(
            status_code=400,
            detail={"code": "VALIDATION_ERROR", "message": "用户名确认不匹配",
                    "request_id": request.state.request_id},
        )

    await delete_user(db, user_id)
    return {"success": True, "request_id": request.state.request_id}
