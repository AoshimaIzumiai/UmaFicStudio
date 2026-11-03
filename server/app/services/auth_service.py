"""
认证服务：bcrypt 密码哈希、JWT 生成、token_version 管理、用户名规范化
"""

import unicodedata
from datetime import datetime, timezone

import bcrypt
import jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_config


def normalize_username(username: str) -> str:
    """
    Unicode NFC 规范化用户名。
    确保不同输入方式（合成/分解）的同一用户名被视为相同。
    """
    return unicodedata.normalize("NFC", username.strip())


def hash_password(password: str) -> str:
    """bcrypt 哈希，cost=12"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """验证密码"""
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: int, username: str, token_version: int) -> str:
    """
    生成 JWT。
    payload: { sub: user_id, username, tv: token_version, iat }
    无 exp — 通过 token_version 控制失效。
    """
    config = get_config()
    payload = {
        "sub": str(user_id),
        "username": username,
        "tv": token_version,
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


async def get_user_by_username(db: AsyncSession, username: str) -> dict | None:
    """按用户名查找用户（NFC 规范化后查询）"""
    normalized = normalize_username(username)
    result = await db.execute(
        text("SELECT id, username, password_hash, token_version, created_at, last_login_at "
             "FROM users WHERE username = :username"),
        {"username": normalized},
    )
    row = result.fetchone()
    if not row:
        return None
    return {
        "id": row[0], "username": row[1], "password_hash": row[2],
        "token_version": row[3], "created_at": row[4], "last_login_at": row[5],
    }


async def get_user_by_id(db: AsyncSession, user_id: int) -> dict | None:
    """按 ID 查找用户"""
    result = await db.execute(
        text("SELECT id, username, token_version, created_at, last_login_at "
             "FROM users WHERE id = :uid"),
        {"uid": user_id},
    )
    row = result.fetchone()
    if not row:
        return None
    return {
        "id": row[0], "username": row[1], "token_version": row[2],
        "created_at": row[3], "last_login_at": row[4],
    }


async def create_user(db: AsyncSession, username: str, password: str) -> dict:
    """创建新用户，返回 { id, username, token_version }"""
    normalized = normalize_username(username)
    pw_hash = hash_password(password)
    result = await db.execute(
        text("INSERT INTO users (username, password_hash, token_version) "
             "VALUES (:username, :pw_hash, 1)"),
        {"username": normalized, "pw_hash": pw_hash},
    )
    await db.commit()
    user_id = result.lastrowid
    return {"id": user_id, "username": normalized, "token_version": 1}


async def update_password(db: AsyncSession, user_id: int, new_password: str) -> int:
    """更新密码并递增 token_version，返回新 token_version"""
    pw_hash = hash_password(new_password)
    await db.execute(
        text("UPDATE users SET password_hash = :pw_hash, "
             "token_version = token_version + 1 WHERE id = :uid"),
        {"pw_hash": pw_hash, "uid": user_id},
    )
    await db.commit()
    # 查询新的 token_version
    result = await db.execute(
        text("SELECT token_version FROM users WHERE id = :uid"),
        {"uid": user_id},
    )
    return result.scalar()


async def update_last_login(db: AsyncSession, user_id: int):
    """更新最后登录时间"""
    await db.execute(
        text("UPDATE users SET last_login_at = NOW() WHERE id = :uid"),
        {"uid": user_id},
    )
    await db.commit()


async def delete_user(db: AsyncSession, user_id: int):
    """删除用户及所有关联数据（CASCADE）"""
    await db.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
    await db.commit()
