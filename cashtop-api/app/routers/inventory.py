from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.product import Product
from app.models.stock_movement import StockMovement, MovementType
from app.models.product_batch import ProductBatch
from app.schemas.inventory import (
    StockMovementCreate, StockMovementResponse,
    BatchCreate, BatchResponse,
    BarcodeGenerateRequest, BarcodeGenerateResponse,
    BarcodeValidateRequest, BarcodeValidateResponse,
    LowStockAlert, ExpiryAlertResponse,
)
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id
from app.services.inventory import move_stock, add_purchase_batch
from app.utils.barcode import generate_ean13, generate_carton_barcode, validate_barcode, generate_internal_code
from app.utils.expiry import get_expiry_alerts, get_low_stock_alerts

router = APIRouter(prefix="/inventory", tags=["📦 المخزون المتقدم"])


# ══════════════════════════════════════════════════════════
#  حركات المخزون
# ══════════════════════════════════════════════════════════

@router.get("/movements", response_model=List[StockMovementResponse], summary="سجل حركات المخزون")
def list_movements(
    product_id: Optional[int] = None,
    movement_type: Optional[MovementType] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(StockMovement).filter(StockMovement.store_id == store_id)
    if product_id:
        q = q.filter(StockMovement.product_id == product_id)
    if movement_type:
        q = q.filter(StockMovement.movement_type == movement_type)
    return q.order_by(StockMovement.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/movements/product/{product_id}", response_model=List[StockMovementResponse], summary="حركات منتج محدد")
def product_movements(
    product_id: int,
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    product = db.query(Product).filter(Product.id == product_id, Product.store_id == store_id).first()
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    return (
        db.query(StockMovement)
        .filter(StockMovement.product_id == product_id, StockMovement.store_id == store_id)
        .order_by(StockMovement.created_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/movements", response_model=StockMovementResponse, status_code=201, summary="تعديل مخزون يدوي")
def create_manual_movement(
    data: StockMovementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    """
    للتعديل اليدوي فقط: adjustment_in / adjustment_out / damaged / expired.
    عمليات البيع والشراء تُسجَّل تلقائياً عبر الفواتير.
    """
    try:
        movement = move_stock(
            db=db,
            product_id=data.product_id,
            movement_type=data.movement_type,
            quantity=data.quantity,
            store_id=store_id,   # ⚠️ جديد — move_stock نفسها بتتحقق إنه المنتج يخص هالمحل
            unit_type=data.unit_type,
            user_id=current_user.id,
            notes=data.notes,
            reference=data.reference,
        )
        db.commit()
        db.refresh(movement)
        return movement
    except ValueError as e:
        raise HTTPException(400, str(e))


# ══════════════════════════════════════════════════════════
#  الدُفع (Batches)
# ══════════════════════════════════════════════════════════

@router.get("/batches", response_model=List[BatchResponse], summary="قائمة الدُفع")
def list_batches(
    product_id: Optional[int] = None,
    expiring_in_days: Optional[int] = None,
    active_only: bool = True,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from datetime import date, timedelta
    q = db.query(ProductBatch).filter(ProductBatch.store_id == store_id)
    if product_id:
        q = q.filter(ProductBatch.product_id == product_id)
    if active_only:
        q = q.filter(ProductBatch.is_active == True, ProductBatch.quantity > 0)
    if expiring_in_days is not None:
        cutoff = date.today() + timedelta(days=expiring_in_days)
        q = q.filter(ProductBatch.expiry_date <= cutoff)
    return q.order_by(ProductBatch.expiry_date.asc().nullslast()).offset(skip).limit(limit).all()


@router.post("/batches/purchase", response_model=dict, status_code=201, summary="إضافة دُفعة شراء")
def add_batch_purchase(
    data: BatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    """
    يضيف دُفعة شراء جديدة:
    - يزيد المخزون
    - يسجّل حركة دخول (purchase)
    - يخلق سجل دُفعة إذا كان المنتج له تاريخ انتهاء
    - يحدّث متوسط التكلفة تلقائياً
    """
    # ⚠️ التحقق من المورد (لو محدد) إنه يخص نفس المحل
    if data.supplier_id:
        from app.models.supplier import Supplier
        supplier = db.query(Supplier).filter(
            Supplier.id == data.supplier_id, Supplier.store_id == store_id,
        ).first()
        if not supplier:
            raise HTTPException(404, "المورد غير موجود أو لا ينتمي لمحلك")

    try:
        movement, batch = add_purchase_batch(
            db=db,
            product_id=data.product_id,
            quantity=data.quantity,
            store_id=store_id,   # ⚠️ جديد
            unit_type=data.unit_type,
            cost_price=data.cost_price,
            expiry_date=data.expiry_date,
            batch_number=data.batch_number,
            supplier_id=data.supplier_id,
            user_id=current_user.id,
            notes=data.notes,
        )
        db.commit()
        product = db.query(Product).filter(Product.id == data.product_id, Product.store_id == store_id).first()
        return {
            "success": True,
            "movement_id": movement.id,
            "batch_id": batch.id if batch else None,
            "product": {
                "id": product.id,
                "name": product.name,
                "new_stock": product.stock_quantity,
                "new_cost_price": product.cost_price,
            },
        }
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.patch("/batches/{batch_id}", response_model=BatchResponse, summary="تعديل دُفعة")
def update_batch(
    batch_id: int,
    expiry_date: Optional[str] = None,
    batch_number: Optional[str] = None,
    notes: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    batch = db.query(ProductBatch).filter(
        ProductBatch.id == batch_id, ProductBatch.store_id == store_id,
    ).first()
    if not batch:
        raise HTTPException(404, "الدُفعة غير موجودة")
    if expiry_date:
        from datetime import date
        batch.expiry_date = date.fromisoformat(expiry_date)
    if batch_number is not None:
        batch.batch_number = batch_number
    if notes is not None:
        batch.notes = notes
    db.commit()
    db.refresh(batch)
    return batch


# ══════════════════════════════════════════════════════════
#  التنبيهات
#  ⚠️ get_expiry_alerts و get_low_stock_alerts بملف app/utils/expiry.py
#  لسا ما شفتهم — لازم يتفلتروا بـ store_id هني كمان (ابعتيه لي).
#  حالياً بمررلهم store_id افتراضاً إنه راح تصير أول باراميتر عندهم،
#  عدّليها حسب الشكل الفعلي لما تبعتي الملف.
# ══════════════════════════════════════════════════════════

@router.get("/alerts/expiry", response_model=ExpiryAlertResponse, summary="تنبيهات انتهاء الصلاحية")
def expiry_alerts(
    days_ahead: int = Query(30, ge=1, le=365, description="كم يوم قادم تريد التنبيه عنه"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    return get_expiry_alerts(db, store_id, days_ahead)


@router.get("/alerts/low-stock", response_model=List[LowStockAlert], summary="تنبيهات المخزون المنخفض")
def low_stock_alerts(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    return get_low_stock_alerts(db, store_id)


@router.get("/alerts/summary", summary="ملخص التنبيهات (للـ Dashboard)")
def alerts_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    low_stock = get_low_stock_alerts(db, store_id)
    expiry = get_expiry_alerts(db, store_id, days_ahead=30)
    return {
        "low_stock_count": len(low_stock),
        "critical_stock_count": sum(1 for p in low_stock if p["severity"] == "critical"),
        "expired_count": expiry["summary"]["total_expired"],
        "expiring_soon_count": expiry["summary"]["total_expiring_soon"],
        "total_alerts": len(low_stock) + expiry["summary"]["total_expired"] + expiry["summary"]["total_expiring_soon"],
    }


# ══════════════════════════════════════════════════════════
#  أدوات الباركود
# ══════════════════════════════════════════════════════════

@router.post("/barcode/generate", response_model=BarcodeGenerateResponse, summary="توليد باركود EAN-13 جديد")
def generate_barcode(
    data: BarcodeGenerateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    """
    يولّد زوج باركود (قطعة + كرتونة) غير مستخدمَين ضمن نفس المحل.
    ⚠️ الباركود صار unique ضمن المحل فقط (شوف تعديل models/product.py) —
    فالفحص هون لازم يتفلتر بالمحل، وإلا ممكن نرفض باركود فعلياً متاح
    لهالتاجر بس مستخدم بمحل تاني.
    """
    from app.models.product import Product
    for _ in range(20):
        piece = generate_ean13(data.prefix)
        carton = generate_carton_barcode(piece)
        exists = db.query(Product).filter(
            Product.store_id == store_id,
            (Product.barcode_piece == piece) |
            (Product.barcode_carton == piece) |
            (Product.barcode_piece == carton) |
            (Product.barcode_carton == carton)
        ).first()
        if not exists:
            return BarcodeGenerateResponse(barcode_piece=piece, barcode_carton=carton, valid=True)
    raise HTTPException(500, "تعذّر توليد باركود فريد، حاول مرة أخرى")


@router.post("/barcode/validate", response_model=BarcodeValidateResponse, summary="التحقق من صحة باركود")
def validate_barcode_endpoint(data: BarcodeValidateRequest):
    # لا يلمس الداتابيس — لا حاجة لفلترة store_id
    result = validate_barcode(data.barcode)
    return BarcodeValidateResponse(**result)


@router.get("/barcode/lookup/{barcode}", summary="بحث شامل بالباركود")
def barcode_lookup(
    barcode: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    يبحث في باركود القطعة والكرتونة معاً ويرجع تفاصيل المنتج.
    ⚠️ لازم يتفلتر بـ store_id — وإلا كاشير يمسح باركود بجواله يقدر
    يشوف اسم/سعر/تكلفة منتج تاجر تاني لو الباركود اتصادف اتشابه (أو
    لو حاول يخمّن IDs).
    """
    from app.models.product import Product
    product = db.query(Product).filter(
        Product.store_id == store_id,
        (Product.barcode_piece == barcode) | (Product.barcode_carton == barcode),
        Product.is_deleted == False,
        Product.is_active == True,
    ).first()

    if not product:
        raise HTTPException(404, f"لا يوجد منتج بالباركود: {barcode}")

    scanned_unit = "piece" if product.barcode_piece == barcode else "carton"
    unit_price = product.retail_price if scanned_unit == "piece" else product.carton_price

    return {
        "found": True,
        "scanned_unit": scanned_unit,
        "product": {
            "id": product.id,
            "name": product.name,
            "name_ar": product.name_ar,
            "barcode_piece": product.barcode_piece,
            "barcode_carton": product.barcode_carton,
            "pieces_per_carton": product.pieces_per_carton,
            "retail_price": product.retail_price,
            "wholesale_price": product.wholesale_price,
            "carton_price": product.carton_price,
            "cost_price": product.cost_price,
            "unit_price": unit_price,
            "stock_quantity": product.stock_quantity,
            "stock_in_cartons": product.stock_in_cartons,
            "is_low_stock": product.is_low_stock,
            "tax_rate": product.tax_rate,
            "has_expiry": product.has_expiry,
            "expiry_date": product.expiry_date.isoformat() if product.expiry_date else None,
        },
    }


@router.get("/barcode/internal/{product_id}", summary="توليد باركود داخلي للمنتج")
def get_internal_barcode(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """للمنتجات التي ليس لها باركود — يولّد كوداً داخلياً"""
    product = db.query(Product).filter(Product.id == product_id, Product.store_id == store_id).first()
    if not product:
        raise HTTPException(404, "المنتج غير موجود")
    return {
        "product_id": product_id,
        "product_name": product.name,
        "internal_code": generate_internal_code(product_id),
        "existing_barcode_piece": product.barcode_piece,
        "existing_barcode_carton": product.barcode_carton,
    }


# ══════════════════════════════════════════════════════════
#  إحصائيات المخزون
# ══════════════════════════════════════════════════════════

@router.get("/stats", summary="إحصائيات المخزون العامة")
def inventory_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from app.models.product import Product

    products = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_active == True, Product.is_deleted == False,
    ).all()

    total_products = len(products)
    total_stock_value = sum(p.stock_quantity * p.cost_price for p in products)
    total_retail_value = sum(p.stock_quantity * p.retail_price for p in products)
    total_units = sum(p.stock_quantity for p in products)
    low_stock_count = sum(1 for p in products if p.is_low_stock)
    out_of_stock = sum(1 for p in products if p.stock_quantity == 0)

    return {
        "total_products": total_products,
        "total_units_in_stock": round(total_units, 2),
        "total_stock_cost_value": round(total_stock_value, 2),
        "total_stock_retail_value": round(total_retail_value, 2),
        "potential_profit": round(total_retail_value - total_stock_value, 2),
        "low_stock_products": low_stock_count,
        "out_of_stock_products": out_of_stock,
    }