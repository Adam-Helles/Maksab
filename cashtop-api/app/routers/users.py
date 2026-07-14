from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.user import UserCreate, UserUpdate, UserResponse, UserChangePassword
from app.core.auth import get_current_user, require_admin, get_current_store_id
from app.core.security import hash_password, verify_password

router = APIRouter(prefix="/users", tags=["👥 المستخدمون"])


@router.get("/", response_model=List[UserResponse], summary="قائمة المستخدمين")
def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    store_id: int = Depends(get_current_store_id),
):
    # ⚠️ بدون فلترة store_id، أدمن أي محل كان يشوف مستخدمي كل التجار
    q = db.query(User).filter(User.store_id == store_id)
    if is_active is not None:
        q = q.filter(User.is_active == is_active)
    return q.offset(skip).limit(limit).all()


@router.post("/", response_model=UserResponse, status_code=201, summary="إضافة مستخدم")
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    store_id: int = Depends(get_current_store_id),
):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="اسم المستخدم موجود مسبقاً")
    if data.email and db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="البريد الإلكتروني مستخدم مسبقاً")

    user = User(
        store_id=store_id,   # ⚠️ جديد — أي مستخدم جديد ينضم لنفس محل الأدمن الذي أنشأه
        username=data.username,
        full_name=data.full_name,
        email=data.email,
        phone=data.phone,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UserResponse, summary="بيانات مستخدم")
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    # المستخدم يرى بياناته فقط، الأدمن يرى مستخدمي محله فقط
    if current_user.role != UserRole.ADMIN and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="غير مصرح")
    # ⚠️ فلترة store_id إجبارية — وإلا أدمن بمحل A يقدر يشوف بيانات
    # مستخدم بمحل B لو خمّن الـ id الصح
    user = db.query(User).filter(User.id == user_id, User.store_id == store_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return user


@router.patch("/{user_id}", response_model=UserResponse, summary="تعديل مستخدم")
def update_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
    store_id: int = Depends(get_current_store_id),
):
    user = db.query(User).filter(User.id == user_id, User.store_id == store_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    # ⚠️ منع تغيير store_id حتى لو انبعت بالـ payload — ما بنسمح
    # لمستخدم ينتقل بين محلات عبر هالـ endpoint
    update_data = data.model_dump(exclude_none=True)
    update_data.pop("store_id", None)
    for field, value in update_data.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/change-password", summary="تغيير كلمة المرور")
def change_password(
    user_id: int,
    data: UserChangePassword,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    if current_user.role != UserRole.ADMIN and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="غير مصرح")

    user = db.query(User).filter(User.id == user_id, User.store_id == store_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")

    user.password_hash = hash_password(data.new_password)
    db.commit()
    return {"message": "تم تغيير كلمة المرور بنجاح"}


@router.delete("/{user_id}", summary="حذف مستخدم")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
    store_id: int = Depends(get_current_store_id),
):
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="لا يمكنك حذف حسابك أنت")
    user = db.query(User).filter(User.id == user_id, User.store_id == store_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    user.is_active = False
    db.commit()
    return {"message": "تم تعطيل المستخدم"}