import hashlib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..config import REFRESH_TOKEN_EXPIRE_DAYS
from ..database import get_db
from ..repositories.token_repo import RefreshTokenRepository
from ..repositories.user_repo import UserRepository

router = APIRouter(prefix="/auth", tags=["auth"])

WWW_AUTHENTICATE = {"WWW-Authenticate": "Bearer"}


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_tokens(db: Session, user: models.User, request: Request) -> schemas.TokenResponse:
    access_token = create_access_token(user.id, user.role)
    refresh_token, jti = create_refresh_token(user.id, user.role)
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    RefreshTokenRepository(db).create(
        user_id=user.id,
        jti=jti,
        token_hash=_hash_token(refresh_token),
        expires_at=expires_at,
        user_agent=(request.headers.get("user-agent") or "")[:255],
        ip_address=request.client.host if request.client else None,
    )
    return schemas.TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
    )


def _valid_user(db: Session, username: str) -> models.User | None:
    return UserRepository(db).get_by_username(username.lower())


@router.post("/login", response_model=schemas.TokenResponse)
def login(data: schemas.LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = _valid_user(db, data.username)
    if user is None or not user.is_active or not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers=WWW_AUTHENTICATE,
        )
    return _issue_tokens(db, user, request)


@router.post("/refresh", response_model=schemas.TokenResponse)
def refresh(data: schemas.RefreshRequest, request: Request, db: Session = Depends(get_db)):
    payload = decode_token(data.refresh_token, expected_type="refresh")
    jti = payload.get("jti")
    stored = RefreshTokenRepository(db).get_valid(_hash_token(data.refresh_token), jti)
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers=WWW_AUTHENTICATE,
        )
    user = UserRepository(db).get_by_id(stored.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers=WWW_AUTHENTICATE,
        )

    repo = RefreshTokenRepository(db)
    repo.revoke(stored)
    return _issue_tokens(db, user, request)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    data: schemas.LogoutRequest | None = None,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    repo = RefreshTokenRepository(db)
    if data is not None and data.refresh_token:
        stored = repo.get_by_token_hash(_hash_token(data.refresh_token))
        if stored is not None and stored.user_id == user.id and not stored.revoked:
            repo.revoke(stored)
    else:
        repo.revoke_all_for_user(user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user


@router.post("/change-password")
def change_password(
    data: schemas.PasswordChange,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(data.old_password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    user.hashed_password = hash_password(data.new_password)
    db.commit()
    RefreshTokenRepository(db).revoke_all_for_user(user.id)
    return {"success": True, "message": "Password updated successfully"}
