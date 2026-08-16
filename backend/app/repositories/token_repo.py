from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from .. import models


class RefreshTokenRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        user_id: int,
        jti: str,
        token_hash: str,
        expires_at: datetime,
        user_agent: Optional[str] = None,
        ip_address: Optional[str] = None,
    ) -> models.RefreshToken:
        token = models.RefreshToken(
            user_id=user_id,
            jti=jti,
            token_hash=token_hash,
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        self.db.add(token)
        self.db.commit()
        self.db.refresh(token)
        return token

    def get_by_token_hash(self, token_hash: str) -> Optional[models.RefreshToken]:
        return (
            self.db.query(models.RefreshToken)
            .filter(models.RefreshToken.token_hash == token_hash)
            .first()
        )

    def get_valid(self, token_hash: str, jti: str) -> Optional[models.RefreshToken]:
        now = datetime.utcnow()
        return (
            self.db.query(models.RefreshToken)
            .filter(
                models.RefreshToken.token_hash == token_hash,
                models.RefreshToken.jti == jti,
                models.RefreshToken.revoked == False,
                models.RefreshToken.expires_at >= now,
            )
            .first()
        )

    def revoke(self, token: models.RefreshToken) -> None:
        token.revoked = True
        token.revoked_at = datetime.utcnow()
        self.db.commit()

    def revoke_all_for_user(self, user_id: int) -> int:
        now = datetime.utcnow()
        result = (
            self.db.query(models.RefreshToken)
            .filter(
                models.RefreshToken.user_id == user_id,
                models.RefreshToken.revoked == False,
            )
            .update(
                {
                    models.RefreshToken.revoked: True,
                    models.RefreshToken.revoked_at: now,
                },
                synchronize_session=False,
            )
        )
        self.db.commit()
        return result

    def delete_expired(self, now: Optional[datetime] = None) -> int:
        result = (
            self.db.query(models.RefreshToken)
            .filter(models.RefreshToken.expires_at < (now or datetime.utcnow()))
            .delete(synchronize_session=False)
        )
        self.db.commit()
        return result
