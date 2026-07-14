from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.category import Category
from app.models.supplier import Supplier
from app.models.customer import Customer
from app.schemas.entities import (
    CategoryCreate, CategoryUpdate, CategoryResponse,
    SupplierCreate, SupplierUpdate, SupplierResponse,
    CustomerCreate, CustomerUpdate, CustomerResponse,
)
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id


# ══════════════════════════════════════════════════════════
#  CATEGORIES
#  ⚠️ يفترض إنه Category عندها عمود store_id — لسا ما شفت
#  app/models/category.py فعلياً، ابعتيه لأتأكد وأعدّل الموديل نفسه.
# ══════════════════════════════════════════════════════════
cat_router = APIRouter(prefix="/categories", tags=["🗂️ الأصناف"])


@cat_router.get("/", response_model=List[CategoryResponse])
def list_categories(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Category).filter(Category.store_id == store_id)
    if active_only:
        q = q.filter(Category.is_active == True)
    return q.order_by(Category.name).all()


@cat_router.post("/", response_model=CategoryResponse, status_code=201)
def create_category(
    data: CategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    exists = db.query(Category).filter(
        Category.store_id == store_id,
        Category.name == data.name,
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="الصنف موجود مسبقاً بمحلك")
    cat = Category(**data.model_dump(), store_id=store_id)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@cat_router.patch("/{cat_id}", response_model=CategoryResponse)
def update_category(
    cat_id: int,
    data: CategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    cat = db.query(Category).filter(Category.id == cat_id, Category.store_id == store_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="الصنف غير موجود")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(cat, k, v)
    db.commit()
    db.refresh(cat)
    return cat


@cat_router.delete("/{cat_id}")
def delete_category(
    cat_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    cat = db.query(Category).filter(Category.id == cat_id, Category.store_id == store_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="الصنف غير موجود")
    if cat.products:
        cat.is_active = False
        db.commit()
        return {"message": "تم إلغاء تفعيل الصنف (يحتوي على منتجات)"}
    db.delete(cat)
    db.commit()
    return {"message": "تم حذف الصنف"}


# ══════════════════════════════════════════════════════════
#  SUPPLIERS
#  ⚠️ يفترض إنه Supplier عندها عمود store_id — نفس ملاحظة Category.
# ══════════════════════════════════════════════════════════
sup_router = APIRouter(prefix="/suppliers", tags=["🏭 الموردون"])


@sup_router.get("/", response_model=List[SupplierResponse])
def list_suppliers(
    skip: int = 0, limit: int = 50,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Supplier).filter(Supplier.store_id == store_id, Supplier.is_deleted == False)
    if search:
        q = q.filter(Supplier.name.ilike(f"%{search}%"))
    return q.offset(skip).limit(limit).all()


@sup_router.post("/", response_model=SupplierResponse, status_code=201)
def create_supplier(
    data: SupplierCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    sup = Supplier(**data.model_dump(), store_id=store_id)
    db.add(sup)
    db.commit()
    db.refresh(sup)
    return sup


@sup_router.get("/{sup_id}", response_model=SupplierResponse)
def get_supplier(
    sup_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    sup = db.query(Supplier).filter(
        Supplier.id == sup_id, Supplier.store_id == store_id, Supplier.is_deleted == False,
    ).first()
    if not sup:
        raise HTTPException(status_code=404, detail="المورد غير موجود")
    return sup


@sup_router.patch("/{sup_id}", response_model=SupplierResponse)
def update_supplier(
    sup_id: int, data: SupplierUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    sup = db.query(Supplier).filter(
        Supplier.id == sup_id, Supplier.store_id == store_id, Supplier.is_deleted == False,
    ).first()
    if not sup:
        raise HTTPException(status_code=404, detail="المورد غير موجود")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(sup, k, v)
    db.commit()
    db.refresh(sup)
    return sup


@sup_router.delete("/{sup_id}")
def delete_supplier(
    sup_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    sup = db.query(Supplier).filter(Supplier.id == sup_id, Supplier.store_id == store_id).first()
    if not sup:
        raise HTTPException(status_code=404, detail="المورد غير موجود")
    sup.is_deleted = True
    db.commit()
    return {"message": "تم حذف المورد"}


# ══════════════════════════════════════════════════════════
#  CUSTOMERS
# ══════════════════════════════════════════════════════════
cust_router = APIRouter(prefix="/customers", tags=["👤 العملاء"])


@cust_router.get("/", response_model=List[CustomerResponse])
def list_customers(
    skip: int = 0, limit: int = 50,
    search: Optional[str] = None,
    has_debt: Optional[bool] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Customer).filter(Customer.store_id == store_id, Customer.is_deleted == False)
    if search:
        q = q.filter(
            (Customer.name.ilike(f"%{search}%")) |
            (Customer.phone.ilike(f"%{search}%"))
        )
    if has_debt is True:
        q = q.filter(Customer.current_debt > 0)
    return q.offset(skip).limit(limit).all()


@cust_router.post("/", response_model=CustomerResponse, status_code=201)
def create_customer(
    data: CustomerCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    cust = Customer(**data.model_dump(), store_id=store_id)
    db.add(cust)
    db.commit()
    db.refresh(cust)
    return cust


@cust_router.get("/{cust_id}", response_model=CustomerResponse)
def get_customer(
    cust_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    # ⚠️ الفلترة بـ store_id هون هي يلي بتمنع أي مستخدم من تصفح بيانات
    # عملاء تجار تانيين عبر تجربة IDs متسلسلة.
    cust = db.query(Customer).filter(
        Customer.id == cust_id, Customer.store_id == store_id, Customer.is_deleted == False,
    ).first()
    if not cust:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    return cust


@cust_router.patch("/{cust_id}", response_model=CustomerResponse)
def update_customer(
    cust_id: int, data: CustomerUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    cust = db.query(Customer).filter(
        Customer.id == cust_id, Customer.store_id == store_id, Customer.is_deleted == False,
    ).first()
    if not cust:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(cust, k, v)
    db.commit()
    db.refresh(cust)
    return cust


@cust_router.delete("/{cust_id}")
def delete_customer(
    cust_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    cust = db.query(Customer).filter(Customer.id == cust_id, Customer.store_id == store_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="العميل غير موجود")
    cust.is_deleted = True
    db.commit()
    return {"message": "تم حذف العميل"}