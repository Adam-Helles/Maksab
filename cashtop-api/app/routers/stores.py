from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models.store import Store
from app.models.user import User, UserRole
from app.schemas.store import StoreSignupRequest
from app.schemas.user import TokenResponse, UserResponse
from app.core.security import hash_password, create_access_token
from app.core.token_service import issue_refresh_token
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
    # ─── تحقق مسبق قبل أي كتابة بالداتابيس ────────────────
    # ملاحظة: username/email فريدين globally حالياً (نفس قيد User.username الحالي)
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

    # ─── إنشاء المحل + الأدمن بمعاملة واحدة ───────────────
    store = Store(
        name=data.store_name.strip(),
        owner_name=data.owner_name,
        phone=data.store_phone,
        is_active=True,
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