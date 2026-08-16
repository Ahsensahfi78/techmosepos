from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .. import models
from ..auth import decode_token
from ..database import SessionLocal

PUBLIC_EXACT = {"/", "/ws", "/auth/login", "/auth/refresh"}
PUBLIC_PREFIXES = ("/docs", "/redoc", "/openapi.json")


def _is_public(path: str) -> bool:
    if path in PUBLIC_EXACT:
        return True
    return path.startswith(PUBLIC_PREFIXES)


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or _is_public(request.url.path):
            return await call_next(request)

        authorization = request.headers.get("Authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return self._unauthorized("Not authenticated")

        try:
            payload = decode_token(token, expected_type="access")
            user_id = int(payload.get("sub", 0))
        except Exception:
            return self._unauthorized("Invalid or expired token")

        db = SessionLocal()
        try:
            user = db.get(models.User, user_id)
        finally:
            db.close()

        if user is None or not user.is_active:
            return self._unauthorized("User not found or inactive")

        request.state.user = user
        return await call_next(request)

    @staticmethod
    def _unauthorized(detail: str) -> JSONResponse:
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": detail, "detail": detail},
            headers={"WWW-Authenticate": "Bearer"},
        )
