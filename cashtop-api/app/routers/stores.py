from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.database import get_db
from app.models.store import Store
from app.models.user import User, UserRole
from app.models.license import LicenseKey
from app.schemas.store import StoreSignupRequest
from app.schemas.user import TokenResponse, UserResponse
from app.core.security import hash_password, verify_password, create_access_token
from pydantic import BaseModel
from app.schemas.message import MessageResponse
from app.core.token_service import issue_refresh_token
from app.core.auth import get_current_user
# Duplicate import removed
from app.core.limiter import limiter
from app.config import settings

router = APIRouter(prefix="/stores", tags=["🏪 المحلات"])


@router.post(
    "/signup",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="تسجيل تاجر جديد (محل + أول أدمن)",
)
@limiter.limit(settings.SIGNUP_RATE_LIMIT)
def signup(request: Request, data: StoreSignupRequest, db: Session = Depends(get_db)):
    # ─── 1. التحقق من مفتاح التفعيل أولاً ──────────────────
    # ⚠️ أمني جوهري: بدون هذا الفحص أي شخص يقدر ينشئ محلاً مجاناً
    # ويستنزف موارد النظام. المفتاح يُستهلك مرة واحدة فقط.
    key_record = db.query(LicenseKey).filter(
        LicenseKey.key == data.license_key.strip().upper()
    ).first()

    if not key_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="مفتاح التفعيل غير صحيح — تواصل مع الدعم للحصول على مفتاح صالح",
        )

    if key_record.is_used:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="تم استخدام هذا المفتاح مسبقاً — كل مفتاح صالح لمحل واحد فقط",
        )

    # ─── 2. تحقق مسبق من تفرد المستخدم ────────────────────
    existing_user = db.query(User).filter(User.username == data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="اسم المستخدم مستخدم مسبقاً",
        )

    if data.email:
        existing_email = db.query(User).filter(User.email == data.email).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="البريد الإلكتروني مستخدم مسبقاً",
            )

    # ─── 3. إنشاء المحل + الأدمن + استهلاك المفتاح ─────────
    # احسب تاريخ انتهاء الاشتراك من المفتاح
    now = datetime.now(timezone.utc)
    subscription_expires_at = now + timedelta(days=key_record.days_valid)

    store = Store(
        name=data.store_name.strip(),
        owner_name=data.owner_name,
        phone=data.store_phone,
        is_active=True,
        subscription_expires_at=subscription_expires_at,
    )
    db.add(store)
    db.flush()  # نحتاج store.id قبل ما ننشئ المستخدم

    admin = User(
        store_id=store.id,
        username=data.username,
        full_name=data.full_name.strip(),
        email=data.email,
        phone=data.phone,
        password_hash=hash_password(data.password),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(admin)

    # ─── استهلاك المفتاح بعد إنشاء المحل ──────────────────
    # نعمل flush أولاً عشان نحصل على admin.id + store.id
    db.flush()

    key_record.is_used = True
    key_record.used_by_store_id = store.id
    key_record.used_at = now

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="اسم المستخدم أو البريد الإلكتروني مستخدم مسبقاً",
        )

    db.refresh(admin)

    # ─── تسجيل دخول تلقائي بعد التسجيل ────────────────────
    return TokenResponse(
        access_token=create_access_token(admin.id, admin.role),
        refresh_token=issue_refresh_token(db, admin.id),
        user=UserResponse.model_validate(admin),
    )

# ------------------- Device Transfer Endpoint -------------------

class DeviceTransferRequest(BaseModel):
    new_device_id: str
    password: str

@router.post(
    "/transfer_device",
    response_model=MessageResponse,
    status_code=status.HTTP_200_OK,
    summary="نقل جهاز المتجر إلى هاتف جديد",
)
def transfer_device(
    request: Request,
    payload: DeviceTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Verify store exists
    store = db.query(Store).filter(Store.id == current_user.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="المحل غير موجود")

    # Verify subscription active
    if not store.is_active or (store.subscription_expires_at and store.subscription_expires_at < datetime.utcnow()):
        raise HTTPException(status_code=403, detail="الاشتراك غير نشط")

    # Verify password
    if not verify_password(payload.password, current_user.password_hash):
        raise HTTPException(status_code=403, detail="كلمة المرور غير صحيحة")

    # Update allowed_device_id
    store.allowed_device_id = payload.new_device_id
    db.add(store)
    db.commit()
    return {"detail": "تم نقل الجهاز بنجاح"}


# ------------------- Public Device Transfer (No Auth Required) -------------------

class PublicDeviceTransferRequest(BaseModel):
    username: str
    password: str
    new_device_id: str

@router.post(
    "/transfer_device_public",
    response_model=TokenResponse,
    status_code=status.HTTP_200_OK,
    summary="نقل جهاز المتجر إلى هاتف جديد (بدون توكن)",
)
@limiter.limit("5/minute")
def transfer_device_public(
    request: Request,
    payload: PublicDeviceTransferRequest,
    db: Session = Depends(get_db),
):
    """
    يُستخدم عند محاولة تسجيل الدخول من جهاز جديد وظهور خطأ device mismatch.
    يتحقق من اسم المستخدم وكلمة المرور، ثم ينقل الجهاز ويُرجع توكنات تسجيل الدخول.
    """
    # 1. Verify credentials
    user = db.query(User).filter(
        User.username == payload.username.strip().lower(),
        User.is_active == True
    ).first()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="اسم المستخدم أو كلمة المرور غير صحيحة",
        )

    # 2. Verify store exists
    store = db.query(Store).filter(Store.id == user.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="المحل غير موجود")

    # 3. Verify subscription active
    now = datetime.now(timezone.utc)
    if not store.is_active or (store.subscription_expires_at and store.subscription_expires_at < now):
        raise HTTPException(status_code=403, detail="الاشتراك غير نشط أو منتهي. يرجى التجديد أولاً.")

    # 4. Update allowed_device_id
    store.allowed_device_id = payload.new_device_id
    user.last_login = now
    db.commit()

    # 5. Return tokens for immediate login
    access_token = create_access_token(user.id, user.role)
    try:
        refresh_token_val = issue_refresh_token(db, user.id)
    except Exception:
        db.rollback()
        refresh_token_val = ""

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token_val,
        user=UserResponse.model_validate(user),
    )