"""结构化请求日志与匿名用户标识。

日志只包含固定元数据，不读取请求头、查询字符串或请求/响应 payload。
"""

import hashlib
import hmac
import json
import logging
from typing import Any

from fastapi import Request

from app.config import get_config


request_logger = logging.getLogger("umafic.request")


def anonymize_user_id(user_id: int) -> str:
    """生成稳定但不可逆的日志用户标识，不暴露数据库 user_id。"""
    secret = get_config().JWT_SECRET.encode("utf-8")
    digest = hmac.new(
        secret,
        f"umafic-log-user:{int(user_id)}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"user_{digest[:16]}"


def bind_request_user(request: Request, user_id: int) -> str:
    """在鉴权成功后将匿名标识绑定到当前请求。"""
    anonymous_id = anonymize_user_id(user_id)
    request.state.log_user = anonymous_id
    return anonymous_id


def build_request_log_event(
    request: Request,
    *,
    status: int,
    latency_ms: float,
) -> dict[str, Any]:
    """构造白名单日志事件；禁止加入 headers、query 或 payload。"""
    route = request.scope.get("route")
    route_template = getattr(route, "path", None) or request.url.path
    return {
        "event": "http_request",
        "request_id": getattr(request.state, "request_id", "unknown"),
        "method": request.method,
        "route": route_template,
        "status": int(status),
        "latency_ms": round(max(latency_ms, 0.0), 3),
        "user": getattr(request.state, "log_user", "anonymous"),
    }


def log_request(request: Request, *, status: int, latency_ms: float) -> None:
    """以单行JSON写入请求日志，便于journald与告警规则解析。"""
    event = build_request_log_event(
        request,
        status=status,
        latency_ms=latency_ms,
    )
    request_logger.info(
        json.dumps(event, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
    )
