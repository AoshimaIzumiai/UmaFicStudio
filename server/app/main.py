"""
UmaFicStudio Sync API — FastAPI 入口
"""

from contextlib import asynccontextmanager
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import get_config
from app.middleware.security_headers import (
    SecurityHeadersMiddleware,
    security_headers_for_path,
)
from app.observability import log_request
from app.security import get_rate_rule, rate_limiter
from app.routers import auth, sync, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化 DB 连接池，关闭时释放"""
    from app.deps import init_db, close_db
    await init_db()
    yield
    await close_db()


def create_app() -> FastAPI:
    config = get_config()

    app = FastAPI(
        title="UmaFicStudio Sync API",
        version="1.0.0",
        docs_url="/api/docs" if config.APP_ENV != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # CORS 位于请求日志内层；预检响应仍会被记录。安全头稍后置于最外层。
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.CORS_ORIGINS,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
    )

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        started_at = time.perf_counter()
        request.state.request_id = str(uuid.uuid4())[:8]
        request.state.log_user = "anonymous"
        request_id = request.state.request_id
        response = None

        try:
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    too_large = int(content_length) > config.MAX_HTTP_BODY_BYTES
                except ValueError:
                    too_large = True
                if too_large:
                    response = JSONResponse(
                        status_code=413,
                        content={
                            "code": "REQUEST_TOO_LARGE", "message": "Request body is too large",
                            "details": {"max_bytes": config.MAX_HTTP_BODY_BYTES},
                            "request_id": request_id,
                        },
                    )

            if response is None:
                rule = get_rate_rule(request.method, request.url.path, config)
                if rule:
                    client_ip = request.client.host if request.client else "unknown"
                    allowed, retry_after = rate_limiter.check(rule, client_ip)
                    if not allowed:
                        response = JSONResponse(
                            status_code=429,
                            content={
                                "code": "RATE_LIMITED", "message": "Too many requests",
                                "details": {"scope": rule.name}, "request_id": request_id,
                            },
                            headers={"Retry-After": str(retry_after)},
                        )

            if response is None:
                response = await call_next(request)

            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            status_code = response.status_code if response is not None else 500
            try:
                log_request(
                    request,
                    status=status_code,
                    latency_ms=(time.perf_counter() - started_at) * 1000,
                )
            except Exception:
                # 可观测性失败不得影响API响应，也不得回退到记录请求内容。
                pass

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        request_id = request.state.request_id
        default_codes = {
            400: "BAD_REQUEST", 401: "TOKEN_INVALID", 403: "FORBIDDEN",
            404: "NOT_FOUND", 409: "CONFLICT", 413: "REQUEST_TOO_LARGE",
            422: "VALIDATION_ERROR", 429: "RATE_LIMITED",
        }
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": detail.get("code", default_codes.get(exc.status_code, "HTTP_ERROR")),
                "message": detail.get("message", str(exc.detail)),
                "details": detail.get("details"),
                "request_id": request_id,
            },
            headers={**(exc.headers or {}), "X-Request-ID": request_id},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = [
            {"location": list(error["loc"]), "message": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": errors},
                "request_id": request.state.request_id,
            },
            headers={"X-Request-ID": request.state.request_id},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "details": None,
                "request_id": request.state.request_id,
            },
            headers={
                **security_headers_for_path(request.url.path),
                "X-Request-ID": request.state.request_id,
            },
        )

    # 安全头置于最外层，覆盖CORS直接响应和全部错误路径。
    app.add_middleware(SecurityHeadersMiddleware)

    # 路由注册
    app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
    app.include_router(sync.router, prefix="/api/sync", tags=["Sync"])
    app.include_router(admin.router, prefix="/api/admin", tags=["Admin"])

    # 健康检查（不带 /api 前缀）
    @app.get("/health/live", tags=["Health"])
    async def health_live():
        return PlainTextResponse("ok")

    @app.get("/health/ready", tags=["Health"])
    async def health_ready():
        from app.deps import check_db
        if await check_db():
            return PlainTextResponse("ok")
        return PlainTextResponse("unavailable", status_code=503)

    return app


app = create_app()
