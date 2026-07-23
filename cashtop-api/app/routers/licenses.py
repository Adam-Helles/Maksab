import secrets
import string
from typing import List
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.license import LicenseKey
from app.models.store import Store
from app.models.user import User, UserRole
from app.schemas.license import LicenseKeyGenerateRequest, LicenseKeyActivateRequest, LicenseKeyResponse
from app.core.auth import get_current_user, require_admin

router = APIRouter(prefix="/licenses", tags=["🔑 التراخيص والاشتراكات"])

def generate_random_key(length=16):
    chars = string.ascii_uppercase + string.digits
    return '-'.join([''.join(secrets.choice(chars) for _ in range(4)) for _ in range(4)])

@router.post("/generate", response_model=List[LicenseKeyResponse], summary="توليد مفاتيح تفعيل (للمدير العام فقط)")
def generate_keys(
    data: LicenseKeyGenerateRequest,
    db: Session = Depends(get_db),
    # نحن نستخدم role.ADMIN كمدير عام حاليا، ولكن في نظام SaaS حقيقي قد يكون هناك System Admin خاص
    # سنفترض أن المستخدم الأول (المتجر رقم 1) هو صاحب النظام (Super Admin)
    user: User = Depends(require_admin)
):
    if user.store_id != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="فقط مدير النظام الأساسي يمكنه توليد مفاتيح"
        )
    
    if data.days_valid <= 0:
        raise HTTPException(status_code=400, detail="يجب أن تكون مدة الصلاحية أكبر من صفر")

    keys = []
    for _ in range(data.count):
        new_key = LicenseKey(
            key=generate_random_key(),
            days_valid=data.days_valid
        )
        db.add(new_key)
        keys.append(new_key)
    
    db.commit()
    for k in keys:
        db.refresh(k)
        
    return keys

@router.get("/", response_model=List[LicenseKeyResponse], summary="عرض المفاتيح (للمدير العام فقط)")
def list_keys(
    db: Session = Depends(get_db),
    user: User = Depends(require_admin)
):
    if user.store_id != 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="فقط مدير النظام الأساسي يمكنه عرض المفاتيح"
        )
    return db.query(LicenseKey).order_by(LicenseKey.id.desc()).all()


@router.get("/status", summary="حالة اشتراك المتجر")
def license_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    from datetime import datetime, timezone
    store = db.query(Store).filter(Store.id == user.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="المتجر غير موجود")
    
    now = datetime.now(timezone.utc)
    days_until_expiry = None
    if store.subscription_expires_at:
        delta = store.subscription_expires_at - now
        days_until_expiry = max(0, delta.days)
        
    return {
        "store_id": store.id,
        "is_active": store.is_active,
        "subscription_expires_at": store.subscription_expires_at,
        "days_until_expiry": days_until_expiry,
        "server_time": now
    }


@router.post("/activate", summary="تفعيل وتمديد الاشتراك باستخدام مفتاح")
def activate_license(
    data: LicenseKeyActivateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin)
):
    """
    يقوم التاجر بإدخال مفتاح التفعيل لزيادة أيام الصلاحية في حسابه
    """
    key_record = db.query(LicenseKey).filter(LicenseKey.key == data.key.strip()).first()
    
    if not key_record:
        raise HTTPException(status_code=404, detail="مفتاح التفعيل غير صحيح")
        
    if key_record.is_used:
        raise HTTPException(status_code=400, detail="تم استخدام هذا المفتاح مسبقاً")

    store = db.query(Store).filter(Store.id == user.store_id).first()
    if not store:
        raise HTTPException(status_code=404, detail="المحل غير موجود")

    # تحديد وقت البدء: إذا كان المشترك عنده اشتراك فعّال حالياً نضيف فوقه
    now = datetime.now(timezone.utc)
    current_expiry = store.subscription_expires_at

    if current_expiry and current_expiry > now:
        new_expiry = current_expiry + timedelta(days=key_record.days_valid)
    else:
        new_expiry = now + timedelta(days=key_record.days_valid)

    # تحديث المتجر
    store.subscription_expires_at = new_expiry
    store.is_active = True  # تفعيل الحساب في حال كان معلقاً بسبب الانتهاء
    
    # تحديث حالة المفتاح
    key_record.is_used = True
    key_record.used_by_store_id = store.id
    key_record.used_at = now

    db.commit()

    return {
        "detail": "تم تفعيل الاشتراك بنجاح",
        "new_expiry_date": new_expiry
    }
