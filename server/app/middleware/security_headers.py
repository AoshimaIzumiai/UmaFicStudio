"""所有HTTP响应的安全头中间件。"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


STRICT_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
DOCS_CSP = (
    "default-src 'none'; "
    "script-src https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src https://cdn.jsdelivr.net 'unsafe-inline'; "
    "img-src data: https://fastapi.tiangolo.com; "
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


def security_headers_for_path(path: str) -> dict[str, str]:
    headers = {
        "Content-Security-Policy": DOCS_CSP if path == "/api/docs" else STRICT_CSP,
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    }
    if path.startswith("/api/"):
        headers["Cache-Control"] = "no-store"
    return headers


class SecurityHeadersMiddleware:
    """在ASGI响应起始帧统一附加安全头，包括CORS直接响应。"""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        async def send_with_security_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in security_headers_for_path(path).items():
                    headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_security_headers)
