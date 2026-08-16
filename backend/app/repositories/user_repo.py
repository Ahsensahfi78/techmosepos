from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: int) -> Optional[models.User]:
        return self.db.get(models.User, user_id)

    def get_by_username(self, username: str) -> Optional[models.User]:
        return self.db.query(models.User).filter(models.User.username == username).first()

    def get_by_email(self, email: str) -> Optional[models.User]:
        return self.db.query(models.User).filter(models.User.email == email).first()

    def get_all(self, search: Optional[str] = None, skip: int = 0, limit: int = 50):
        query = self.db.query(models.User)
        if search:
            query = query.filter(
                or_(
                    models.User.username.ilike(f"%{search}%"),
                    models.User.full_name.ilike(f"%{search}%"),
                    models.User.email.ilike(f"%{search}%"),
                )
            )
        return query.order_by(models.User.created_at.desc()).offset(skip).limit(limit).all()

    def count(self, search: Optional[str] = None) -> int:
        query = self.db.query(models.User)
        if search:
            query = query.filter(
                or_(
                    models.User.username.ilike(f"%{search}%"),
                    models.User.full_name.ilike(f"%{search}%"),
                )
            )
        return query.count()

    def create(self, **kwargs) -> models.User:
        user = models.User(**kwargs)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update(self, user: models.User, **kwargs) -> models.User:
        for key, value in kwargs.items():
            if value is not None:
                setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def delete(self, user: models.User) -> None:
        self.db.delete(user)
        self.db.commit()

    def get_sessions(self, user_id: int, limit: int = 50):
        return (
            self.db.query(models.RefreshToken)
            .filter(models.RefreshToken.user_id == user_id)
            .order_by(models.RefreshToken.created_at.desc())
            .limit(limit)
            .all()
        )
