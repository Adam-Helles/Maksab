from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.product import Product
from app.schemas.product import ProductCreate, ProductUpdate, ProductResponse, ProductStockAdjust
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id

router = APIRouter(prefix="/products", tags=["📦 المنتجات"])


@router.get("/", response_model=List[ProductResponse], summary="قائمة المنتجات")
def list_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    low_stock: Optional[bool] = None,
    has_expiry: Optional[bool] = None,
    is_active: Optional[bool] = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Product).filter(Product.store_id == store_id, Product.is_deleted == False)

    if is_active is not None:
        q = q.filter(Product.is_active == is_active)
    if category_id:
        q = q.filter(Product.category_id == category_id)
    if supplier_id:
        q = q.filter(Product.supplier_id == supplier_id)
    if has_expiry is not None:
        q = q.filter(Product.has_expiry == has_expiry)
    if search:
        q = q.filter(
            Product.name.ilike(f"%{search}%") |
            Product.name_ar.ilike(f"%{search}%") |
            Product.barcode_piece.ilike(f"%{search}%") |
            Product.barcode_carton.ilike(f"%{search}%")
        )
    if low_stock:
        q = q.filter(Product.stock_quantity <= Product.min_stock_alert)

    return q.order_by(Product.name).offset(skip).limit(limit).all()


@router.get("/barcode/{barcode}", response_model=ProductResponse, summary="بحث بالباركود")
def get_by_barcode(
    barcode: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """يبحث في باركود القطعة وباركود الكرتونة معاً — ضمن محل المستخدم فقط"""
    product = db.query(Product).filter(
        Product.store_id == store_id,
        (Product.barcode_piece == barcode) | (Product.barcode_carton == barcode),
        Product.is_deleted == False,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail=f"لا يوجد منتج بالباركود: {barcode}")
    return product


@router.get("/low-stock", response_model=List[ProductResponse], summary="منتجات قاربت على النفاذ")
def get_low_stock(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    return db.query(Product).filter(
        Product.store_id == store_id,
        Product.stock_quantity <= Product.min_stock_alert,
        Product.is_active == True,
        Product.is_deleted == False,
    ).all()


@router.get("/{product_id}", response_model=ProductResponse, summary="تفاصيل منتج")
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    # ⚠️ الفلترة بـ store_id هون هي يلي بتمنع IDOR: بدونها أي مستخدم
    # بأي محل يقدر يجرب أرقام id متسلسلة (1، 2، 3...) ويشوف منتجات
    # محلات تانية.
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == store_id,
        Product.is_deleted == False,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="المنتج غير موجود")
    return product


@router.post("/", response_model=ProductResponse, status_code=201, summary="إضافة منتج")
def create_product(
    data: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    # تحقق من الباركود ضمن نفس المحل فقط (تاجر تاني ممكن يستخدم نفس الباركود)
    if data.barcode_piece:
        exists = db.query(Product).filter(
            Product.store_id == store_id,
            Product.barcode_piece == data.barcode_piece,
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="باركود القطعة مستخدم مسبقاً بمحلك")
    if data.barcode_carton:
        exists = db.query(Product).filter(
            Product.store_id == store_id,
            Product.barcode_carton == data.barcode_carton,
        ).first()
        if exists:
            raise HTTPException(status_code=400, detail="باركود الكرتونة مستخدم مسبقاً بمحلك")

    # ⚠️ store_id بيتحدد من التوكن فقط، حتى لو data تحمل store_id ما بتاخده
    payload = data.model_dump()
    payload.pop("store_id", None)
    product = Product(**payload, store_id=store_id)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/{product_id}", response_model=ProductResponse, summary="تعديل منتج")
def update_product(
    product_id: int,
    data: ProductUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == store_id,
        Product.is_deleted == False,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="المنتج غير موجود")

    update_data = data.model_dump(exclude_none=True)
    update_data.pop("store_id", None)  # منع تغيير ملكية المنتج بين المحلات
    for k, v in update_data.items():
        setattr(product, k, v)
    db.commit()
    db.refresh(product)
    return product


@router.post("/{product_id}/adjust-stock", summary="تعديل المخزون يدوياً")
def adjust_stock(
    product_id: int,
    data: ProductStockAdjust,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == store_id,
        Product.is_deleted == False,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="المنتج غير موجود")

    qty_change = data.quantity_change
    if data.unit_type == "carton":
        qty_change = data.quantity_change * product.pieces_per_carton

    new_qty = product.stock_quantity + qty_change
    if new_qty < 0:
        raise HTTPException(status_code=400, detail="لا يمكن أن يكون المخزون سالباً")

    previous_stock = product.stock_quantity
    product.stock_quantity = new_qty
    db.commit()

    return {
        "product_id": product_id,
        "product_name": product.name,
        "previous_stock": previous_stock,
        "change": qty_change,
        "new_stock": new_qty,
        "reason": data.reason,
    }


@router.delete("/{product_id}", summary="حذف منتج")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    product = db.query(Product).filter(
        Product.id == product_id,
        Product.store_id == store_id,
    ).first()
    if not product:
        raise HTTPException(status_code=404, detail="المنتج غير موجود")
    product.is_deleted = True
    product.is_active = False
    db.commit()
    return {"message": "تم حذف المنتج"}