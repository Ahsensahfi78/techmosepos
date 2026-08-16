import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from . import models
from .config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, REFRESH_TOKEN_EXPIRE_DAYS, SECRET_KEY
from .database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _build_payload(user_id: int, role: str, token_type: str, expires: timedelta) -> dict:
    return {
        "sub": str(user_id),
        "role": role,
        "jti": str(uuid.uuid4()),
        "type": token_type,
        "exp": datetime.utcnow() + expires,
    }


def create_access_token(user_id: int, role: str) -> str:
    payload = _build_payload(
        user_id,
        role,
        "access",
        timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: int, role: str) -> tuple[str, str]:
    """Return the encoded refresh token and its ``jti`` claim."""
    payload = _build_payload(
        user_id,
        role,
        "refresh",
        timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM), payload["jti"]


def decode_token(token: str, expected_type: Optional[str] = None) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    if expected_type and payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )
    return payload


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    payload = decode_token(credentials.credentials, expected_type="access")
    user_id = int(payload.get("sub", 0))
    user = db.get(models.User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


def require_roles(*allowed_roles: str):
    def role_checker(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user
    return role_checker
