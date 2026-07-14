from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.refresh_token import RefreshToken
from app.schemas.user import LoginRequest, TokenResponse, UserResponse, RefreshTokenRequest
from app.core.security import verify_password, create_access_token, decode_token
from app.core.auth import get_current_user
from app.core.token_service import issue_refresh_token, revoke_all_user_tokens
from app.core.limiter import limiter
from app.config import settings
from jose import JWTError

router = APIRouter(prefix="/auth", tags=["🔐 المصادقة"])


@router.post("/login", response_model=TokenResponse, summary="تسجيل الدخول")
@limiter.limit(settings.LOGIN_RATE_LIMIT)
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(
        User.username == data.username.strip().lower(),
        User.is_active == True
    ).first()

    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="اسم المستخدم أو كلمة المرور غير صحيحة",
        )

    # تحديث آخر دخول
    user.last_login = datetime.now(timezone.utc)
    db.commit()

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=issue_refresh_token(db, user.id),
        user=UserResponse.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse, summary="تجديد التوكن")
def refresh_token_endpoint(payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    """
    Refresh Token Rotation:
    كل استخدام لـ refresh token بيلغيه فوراً ويولّد وحدة جديدة مكانه.
    لو حدا حاول يستخدم توكن ملغى مسبقاً (يعني نسخة قديمة انسرقت واستُخدمت
    قبله أو بعده) — منعتبرها مؤشر سرقة ومنقفل كل جلسات المستخدم فوراً.
    """
    try:
        data = decode_token(payload.refresh_token)
        if data.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="توكن غير صالح")
        user_id = int(data["sub"])
        jti = data.get("jti")
        if not jti:
            raise HTTPException(status_code=401, detail="توكن غير صالح")
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="توكن منتهي الصلاحية")

    record = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()

    if record is None:
        raise HTTPException(status_code=401, detail="توكن غير معروف")

    if record.is_revoked:
        # ⚠️ إعادة استخدام توكن ملغى = مؤشر سرقة محتمل
        revoke_all_user_tokens(db, record.user_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="تم اكتشاف استخدام غير طبيعي للجلسة — تم تسجيل الخروج من جميع الأجهزة لأسباب أمنية، الرجاء تسجيل الدخول من جديد",
        )

    if record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="انتهت صلاحية الجلسة، الرجاء تسجيل الدخول من جديد")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=401, detail="المستخدم غير موجود")

    # ─── Rotation: نلغي القديم قبل ما نولّد الجديد ────────
    new_refresh_token = issue_refresh_token(db, user.id)
    new_jti = decode_token(new_refresh_token)["jti"]

    record.is_revoked = True
    record.replaced_by = new_jti
    db.commit()

    return TokenResponse(
        access_token=create_access_token(user.id, user.role),
        refresh_token=new_refresh_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/logout", summary="تسجيل الخروج")
def logout(payload: RefreshTokenRequest, db: Session = Depends(get_db)):
    """
    يلغي الـ refresh token الحالي فقط (نفس الجهاز). لا يفشل حتى لو
    التوكن غير صالح أصلاً — تسجيل الخروج لازم ينجح من ناحية العميل دايماً.
    """
    try:
        data = decode_token(payload.refresh_token)
        jti = data.get("jti")
    except JWTError:
        return {"detail": "تم تسجيل الخروج"}

    if jti:
        record = db.query(RefreshToken).filter(RefreshToken.jti == jti).first()
        if record:
            record.is_revoked = True
            db.commit()

    return {"detail": "تم تسجيل الخروج"}


@router.get("/me", response_model=UserResponse, summary="بياناتي")
def get_me(current_user: User = Depends(get_current_user)):
    return current_user