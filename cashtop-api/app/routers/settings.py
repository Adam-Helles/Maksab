from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.settings import StoreSettings
from app.schemas.settings import StoreSettingsOut, StoreSettingsUpdate
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id

router = APIRouter(prefix="/settings", tags=["⚙️ إعدادات النظام"])


def _get_or_create(db: Session, store_id: int) -> StoreSettings:
    """
    ⚠️ إصلاح جوهري: كانت الإعدادات صف واحد ثابت (id=1) يتشاركه كل
    التجار على النظام — يعني أي تاجر يعدّل اسم المحل أو العملة كان
    فعلياً يغيّرها لكل التجار الآخرين بالمنصة كلها!

    صار كل محل له صف إعدادات خاص فيه، مربوط بـ store_id (unique).

    ⚠️ هاد يتطلب تعديل app/models/settings.py نفسه — لسا ما شفته،
    فترضت إنه بيصير فيه عمود store_id (ForeignKey لـ stores.id, unique=True).
    ابعتيلي الملف الفعلي لأتأكد وأعدّله بدقة.
    """
    settings = db.query(StoreSettings).filter(StoreSettings.store_id == store_id).first()
    if not settings:
        settings = StoreSettings(store_id=store_id, store_name="محلي", currency="₪")
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("/", response_model=StoreSettingsOut, summary="جلب إعدادات المحل")
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    return _get_or_create(db, store_id)


@router.patch("/", response_model=StoreSettingsOut, summary="تحديث إعدادات المحل")
def update_settings(
    payload: StoreSettingsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    settings = _get_or_create(db, store_id)
    update_data = payload.dict(exclude_unset=True)
    update_data.pop("store_id", None)   # منع تغيير ملكية الإعدادات
    for field, value in update_data.items():
        setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return settings