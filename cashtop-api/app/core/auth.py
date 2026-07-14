from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.database import get_db
from app.core.security import decode_token
from app.models.user import User, UserRole
from app.models.store import Store

bearer_scheme = HTTPBearer()

def _get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="توكن غير صالح أو منتهي الصلاحية",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exception
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == int(user_id), User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="المستخدم غير موجود أو غير نشط")

    # ─── تحقق من حالة المحل (الاشتراك) ──────────────────────
    store = db.query(Store).filter(Store.id == user.store_id).first()
    if not store or not store.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="حساب المحل معلّق أو غير مفعّل — تواصل مع الدعم",
        )

    # ─── تحقق من انتهاء الاشتراك (Read-Only Mode) ───────────
    if store.subscription_expires_at:
        now = datetime.now(timezone.utc)
        # SQLAlchemy datetime is sometimes offset-naive if fetched from sqlite
        if store.subscription_expires_at.tzinfo is None:
            now = datetime.utcnow()

        if store.subscription_expires_at < now:
            # الاشتراك منتهي، نسمح بـ GET فقط، أو مسار التفعيل
            if request.method != "GET" and not request.url.path.endswith("/licenses/activate"):
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED, # Using 402 for expired subscription to make it distinct on frontend
                    detail="انتهى الاشتراك، الرجاء إدخال مفتاح التفعيل الجديد للاستمرار في إضافة بيانات",
                )

    return user


# ─── Dependencies جاهزة للاستخدام في الـ Routes ────────────
def get_current_user(user: User = Depends(_get_current_user)) -> User:
    """أي مستخدم مسجل دخول"""
    return user


def get_current_store_id(user: User = Depends(_get_current_user)) -> int:
    """
    مصدر الحقيقة الوحيد لـ store_id بأي endpoint.
    ⚠️ لا تقبل store_id أبداً من body/query/path المستخدم — استخدم هاد
    الـ dependency حصراً بكل query أو write operation.
    """
    return user.store_id


def require_admin(user: User = Depends(_get_current_user)) -> User:
    """Admin فقط"""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="هذه العملية للمدير فقط")
    return user


def require_manager_or_above(user: User = Depends(_get_current_user)) -> User:
    """Admin أو Manager"""
    if user.role not in [UserRole.ADMIN, UserRole.MANAGER]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="غير مصرح لك بهذه العملية")
    return user