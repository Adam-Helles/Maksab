# app/core/token_service.py
#
# منطق إصدار وإلغاء الـ refresh tokens — مفصول عن الـ routers عشان
# نفس المنطق يستخدم من login و signup و refresh بدون تكرار.

import uuid
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.config import settings
from app.core.security import create_refresh_token
from app.models.refresh_token import RefreshToken


def issue_refresh_token(db: Session, user_id: int) -> str:
    """
    يولّد refresh token جديد، يخزّن سجله بالداتابيز كـ active،
    ويرجّع نص التوكن الجاهز للإرسال للعميل.
    """
    jti = str(uuid.uuid4())
    token = create_refresh_token(user_id, jti)

    # UTC ساذج (naive) عمداً — راجع الملاحظة بـ app/models/refresh_token.py
    expires_at = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    db.add(
        RefreshToken(
            jti=jti,
            user_id=user_id,
            expires_at=expires_at,
            is_revoked=False,
        )
    )
    db.commit()
    return token


def revoke_all_user_tokens(db: Session, user_id: int) -> None:
    """
    يلغي كل الـ refresh tokens النشطة لمستخدم معيّن — بيستخدم عند كشف
    محاولة إعادة استخدام توكن ملغى (مؤشر سرقة) لعمل logout من كل الأجهزة.
    """
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.is_revoked == False,
    ).update({"is_revoked": True})
    db.commit()