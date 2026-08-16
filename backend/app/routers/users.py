import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_current_user, hash_password
from ..database import get_db
from ..permissions import require_permission
from ..repositories.audit_repo import AuditLogRepository
from ..repositories.user_repo import UserRepository

router = APIRouter(prefix="/users", tags=["users"])

_SKIP_DEACTIVATE_ROLES = {models.Role.SUPER_ADMIN.value}


def _can_deactivate_target(current: models.User, target: models.User) -> bool:
    if target.role in _SKIP_DEACTIVATE_ROLES and current.id != target.id:
        return False
    return True


@router.get("", response_model=schemas.Paginated[schemas.UserOut])
def list_users(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    search: str | None = Query(default=None),
    role: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("user.manage")),
):
    repo = UserRepository(db)
    query = db.query(models.User)
    if search:
        from sqlalchemy import or_

        query = query.filter(
            or_(
                models.User.username.ilike(f"%{search}%"),
                models.User.full_name.ilike(f"%{search}%"),
                models.User.email.ilike(f"%{search}%"),
            )
        )
    if role:
        query = query.filter(models.User.role == role)

    total = query.count()
    users = (
        query.order_by(models.User.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.Paginated[schemas.UserOut](
        items=users,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=math.ceil(total / page_size) if total else 0,
    )


@router.post("", response_model=schemas.UserOut, status_code=201)
def create_user(
    data: schemas.UserCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("user.manage")),
):
    repo = UserRepository(db)
    if repo.get_by_username(data.username):
        raise HTTPException(status_code=400, detail="Username already taken")
    if repo.get_by_email(data.email):
        raise HTTPException(status_code=400, detail="Email already registered")

    user = repo.create(
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        role=data.role,
        is_active=data.is_active,
        hashed_password=hash_password(data.password),
    )
    AuditLogRepository(db).log(
        action="user.create",
        entity_type="user",
        entity_id=user.id,
        user_id=current.id,
        details=f"Created user {user.username} with role {user.role}",
    )
    return user


@router.get("/me/sessions", response_model=list[schemas.LoginSessionOut])
def my_sessions(
    db: Session = Depends(get_db),
    current: models.User = Depends(get_current_user),
):
    return UserRepository(db).get_sessions(current.id)


@router.get("/{user_id}", response_model=schemas.UserOut)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("user.manage")),
):
    user = UserRepository(db).get_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("user.manage")),
):
    repo = UserRepository(db)
    user = repo.get_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    payload = data.model_dump(exclude_unset=True)

    if "username" in payload and payload["username"] != user.username:
        if repo.get_by_username(payload["username"]):
            raise HTTPException(status_code=400, detail="Username already taken")
    if "email" in payload and payload["email"] and payload["email"] != user.email:
        if repo.get_by_email(payload["email"]):
            raise HTTPException(status_code=400, detail="Email already registered")

    if payload.get("is_active") is False and not _can_deactivate_target(current, user):
        raise HTTPException(
            status_code=400,
            detail="Super admin accounts cannot be deactivated",
        )

    if "password" in payload:
        payload["hashed_password"] = hash_password(payload.pop("password"))

    updated = repo.update(user, **{k: v for k, v in payload.items() if v is not None})
    AuditLogRepository(db).log(
        action="user.update",
        entity_type="user",
        entity_id=user.id,
        user_id=current.id,
        details=f"Updated user {user.username}",
    )
    return updated


@router.delete("/{user_id}", status_code=204)
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_permission("user.manage")),
):
    repo = UserRepository(db)
    user = repo.get_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    if not _can_deactivate_target(current, user):
        raise HTTPException(
            status_code=400,
            detail="Super admin accounts cannot be deactivated",
        )

    repo.update(user, is_active=False)
    AuditLogRepository(db).log(
        action="user.deactivate",
        entity_type="user",
        entity_id=user.id,
        user_id=current.id,
        details=f"Deactivated user {user.username}",
    )
    return None


@router.get("/{user_id}/sessions", response_model=list[schemas.LoginSessionOut])
def user_sessions(
    user_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("user.manage")),
):
    repo = UserRepository(db)
    if repo.get_by_id(user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    return repo.get_sessions(user_id)


@router.get("/{user_id}/activity", response_model=schemas.Paginated[schemas.AuditLogOut])
def user_activity(
    user_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_permission("user.manage")),
):
    repo = UserRepository(db)
    if repo.get_by_id(user_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    items, total, total_pages = AuditLogRepository(db).get_all(
        user_id=user_id, page=page, page_size=page_size
    )
    return schemas.Paginated[schemas.AuditLogOut](
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
