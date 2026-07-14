from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.user import User
from app.models.invoice import Invoice, InvoiceItem, Payment, InvoiceStatus, InvoiceType, PaymentMethod
from app.schemas.invoice import (
    InvoiceCreate, InvoiceResponse, InvoiceListResponse,
    InvoiceAddItem, InvoiceUpdateDiscount,
    PaymentAdd, PaymentResponse,
    PublicInvoiceResponse, PublicInvoiceItem,
)
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id
from app.services.invoice import (
    create_invoice, complete_draft_invoice,
    cancel_invoice, add_payment_to_invoice,
    build_invoice_urls,
)

router = APIRouter(prefix="/invoices", tags=["🧾 الفواتير / POS"])


# ══════════════════════════════════════════════════════════
#  مساعد: بناء InvoiceResponse مع الروابط
# ══════════════════════════════════════════════════════════

def _build_response(invoice: Invoice, request: Request, db: Session) -> dict:
    base_url = str(request.base_url).rstrip("/")
    urls = build_invoice_urls(invoice, base_url)

    items_out = []
    for item in invoice.items:
        from app.models.product import Product
        product = db.query(Product).filter(Product.id == item.product_id).first()
        items_out.append({
            "id": item.id,
            "product_id": item.product_id,
            "product_name": product.name if product else "—",
            "quantity": item.quantity,
            "unit_type": item.unit_type,
            "unit_price": item.unit_price,
            "cost_price": item.cost_price,
            "discount_amount": item.discount_amount,
            "tax_amount": item.tax_amount,
            "total": item.total,
        })

    return {
        **{c.name: getattr(invoice, c.name) for c in Invoice.__table__.columns},
        "items": items_out,
        "payments": [
            {c.name: getattr(p, c.name) for c in Payment.__table__.columns}
            for p in invoice.payments
        ],
        "share_url": urls["share_url"],
        "whatsapp_url": urls["whatsapp_url"],
    }


def _get_owned_invoice(db: Session, invoice_id: int, store_id: int) -> Invoice:
    """
    مساعد مشترك: يجيب الفاتورة فقط إذا كانت تخص محل المستخدم الحالي.
    ⚠️ استخدم هاد الدالة حصراً بدل db.query(Invoice).filter(Invoice.id == ...)
    مباشرة — هيك ما بننسى فلتر store_id بأي endpoint جديد مستقبلاً.
    """
    invoice = db.query(Invoice).filter(
        Invoice.id == invoice_id,
        Invoice.store_id == store_id,
    ).first()
    if not invoice:
        raise HTTPException(404, "الفاتورة غير موجودة")
    return invoice


# ══════════════════════════════════════════════════════════
#  إنشاء فاتورة (POS)
# ══════════════════════════════════════════════════════════

@router.post("/", status_code=201, summary="إنشاء فاتورة جديدة")
def create(
    data: InvoiceCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    ينشئ فاتورة بيع أو شراء.

    ⚠️ معلّق: create_invoice() بملف services/invoice.py لازم تتعدّل
    تقبل store_id وتحطه على الفاتورة، وتمرره لـ generate_invoice_number()
    (يلي صار يطلب store_id إجباري). ما قدرت أعدّلها لأنه لسا ما شفت
    محتوى services/invoice.py الفعلي — ابعتيه لأكمل هالجزء.
    """
    try:
        invoice = create_invoice(db, data, current_user.id, store_id)  # ⚠️ store_id مضاف — يحتاج تعديل مطابق بـ service
        return _build_response(invoice, request, db)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ══════════════════════════════════════════════════════════
#  قائمة الفواتير
# ══════════════════════════════════════════════════════════

@router.get("/", response_model=List[InvoiceListResponse], summary="قائمة الفواتير")
def list_invoices(
    invoice_type: Optional[InvoiceType] = None,
    status: Optional[InvoiceStatus] = None,
    customer_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Invoice).filter(Invoice.store_id == store_id)
    if invoice_type:
        q = q.filter(Invoice.invoice_type == invoice_type)
    if status:
        q = q.filter(Invoice.status == status)
    if customer_id:
        q = q.filter(Invoice.customer_id == customer_id)
    if supplier_id:
        q = q.filter(Invoice.supplier_id == supplier_id)
    if date_from:
        from datetime import date
        q = q.filter(Invoice.created_at >= date.fromisoformat(date_from))
    if date_to:
        from datetime import date
        q = q.filter(Invoice.created_at <= date.fromisoformat(date_to))
    return q.order_by(Invoice.created_at.desc()).offset(skip).limit(limit).all()


# ══════════════════════════════════════════════════════════
#  الفواتير المعلّقة (drafts)
# ══════════════════════════════════════════════════════════

@router.get("/drafts", response_model=List[InvoiceListResponse], summary="الفواتير المعلّقة")
def list_drafts(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    return (
        db.query(Invoice)
        .filter(Invoice.store_id == store_id, Invoice.status == InvoiceStatus.DRAFT)
        .order_by(Invoice.created_at.desc())
        .all()
    )


# ══════════════════════════════════════════════════════════
#  تفاصيل فاتورة
# ══════════════════════════════════════════════════════════

@router.get("/{invoice_id}", summary="تفاصيل فاتورة")
def get_invoice(
    invoice_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    return _build_response(invoice, request, db)


# ══════════════════════════════════════════════════════════
#  إضافة صنف لفاتورة معلّقة
# ══════════════════════════════════════════════════════════

@router.post("/{invoice_id}/items", summary="إضافة صنف لفاتورة معلّقة")
def add_item(
    invoice_id: int,
    data: InvoiceAddItem,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    if invoice.status != InvoiceStatus.DRAFT:
        raise HTTPException(400, "لا يمكن تعديل فاتورة مكتملة أو ملغاة")

    # ⚠️ المنتج المضاف لازم يخص نفس محل الفاتورة — وإلا مستخدم بمحل A
    # يقدر يضيف منتج بمحل B لفاتورته (تسريب أسماء/أسعار منتجات تاجر تاني)
    from app.models.product import Product
    product = db.query(Product).filter(
        Product.id == data.product_id,
        Product.store_id == store_id,
        Product.is_active == True,
        Product.is_deleted == False,
    ).first()
    if not product:
        raise HTTPException(404, "المنتج غير موجود")

    from app.services.invoice import _resolve_unit_price, _qty_in_pieces
    unit_price = _resolve_unit_price(product, data.unit_type, data.unit_price)
    subtotal_item = data.quantity * unit_price
    after_discount = subtotal_item - data.discount_amount
    tax_amount = after_discount * (product.tax_rate / 100)
    total_item = after_discount + tax_amount

    existing = next(
        (i for i in invoice.items
         if i.product_id == data.product_id and i.unit_type == data.unit_type),
        None
    )
    if existing:
        existing.quantity += data.quantity
        existing.total = round(existing.quantity * existing.unit_price - existing.discount_amount, 3)
    else:
        new_item = InvoiceItem(
            store_id=store_id,   # ⚠️ جديد
            invoice_id=invoice.id,
            product_id=product.id,
            quantity=data.quantity,
            unit_type=data.unit_type,
            unit_price=unit_price,
            cost_price=product.cost_price,
            discount_amount=data.discount_amount,
            tax_amount=round(tax_amount, 3),
            total=round(total_item, 3),
        )
        db.add(new_item)
        db.flush()
        invoice.items.append(new_item)

    invoice.recalculate()
    db.commit()
    return _build_response(invoice, request, db)


# ══════════════════════════════════════════════════════════
#  حذف صنف من فاتورة معلّقة
# ══════════════════════════════════════════════════════════

@router.delete("/{invoice_id}/items/{item_id}", summary="حذف صنف من فاتورة معلّقة")
def remove_item(
    invoice_id: int,
    item_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    if invoice.status != InvoiceStatus.DRAFT:
        raise HTTPException(400, "لا يمكن تعديل فاتورة مكتملة أو ملغاة")

    item = db.query(InvoiceItem).filter(
        InvoiceItem.id == item_id,
        InvoiceItem.invoice_id == invoice_id,
        InvoiceItem.store_id == store_id,
    ).first()
    if not item:
        raise HTTPException(404, "الصنف غير موجود في الفاتورة")

    db.delete(item)
    db.flush()

    invoice.items = [i for i in invoice.items if i.id != item_id]
    invoice.recalculate()
    db.commit()
    return _build_response(invoice, request, db)


# ══════════════════════════════════════════════════════════
#  تعديل الخصم والضريبة
# ══════════════════════════════════════════════════════════

@router.patch("/{invoice_id}/discount", summary="تعديل الخصم والضريبة")
def update_discount(
    invoice_id: int,
    data: InvoiceUpdateDiscount,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    if invoice.status != InvoiceStatus.DRAFT:
        raise HTTPException(400, "لا يمكن تعديل فاتورة مكتملة")

    invoice.discount_percent = data.discount_percent
    invoice.discount_amount = data.discount_amount
    invoice.tax_percent = data.tax_percent
    invoice.recalculate()
    db.commit()
    return _build_response(invoice, request, db)


# ══════════════════════════════════════════════════════════
#  إكمال فاتورة معلّقة
# ══════════════════════════════════════════════════════════

@router.post("/{invoice_id}/complete", summary="إكمال فاتورة معلّقة")
def complete_invoice(
    invoice_id: int,
    request: Request,
    paid_amount: float = Query(default=0.0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    try:
        invoice = complete_draft_invoice(db, invoice, current_user.id, paid_amount)
        return _build_response(invoice, request, db)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ══════════════════════════════════════════════════════════
#  إلغاء فاتورة
# ══════════════════════════════════════════════════════════

@router.post("/{invoice_id}/cancel", summary="إلغاء فاتورة")
def cancel(
    invoice_id: int,
    request: Request,
    reason: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    try:
        invoice = cancel_invoice(db, invoice, current_user.id, reason)
        return _build_response(invoice, request, db)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ══════════════════════════════════════════════════════════
#  إضافة دفعة
# ══════════════════════════════════════════════════════════

@router.post("/{invoice_id}/payments", response_model=PaymentResponse, summary="إضافة دفعة")
def add_payment(
    invoice_id: int,
    data: PaymentAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """يضيف دفعة جزئية أو كاملة على فاتورة آجلة"""
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    try:
        payment = add_payment_to_invoice(
            db, invoice,
            amount=data.amount,
            method=data.method,
            user_id=current_user.id,
            notes=data.notes or "",
        )
        return payment
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{invoice_id}/payments", response_model=List[PaymentResponse], summary="سجل دفعات فاتورة")
def invoice_payments(
    invoice_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    invoice = _get_owned_invoice(db, invoice_id, store_id)
    return invoice.payments


# ══════════════════════════════════════════════════════════
#  رابط الفاتورة العام (بدون auth) — للمشاركة عبر واتساب
# ══════════════════════════════════════════════════════════

@router.get("/public/{token}", summary="عرض الفاتورة العامة (بدون تسجيل دخول)")
def public_invoice(token: str, db: Session = Depends(get_db)):
    """
    ✅ هاد الـ endpoint بدون auth بالتصميم — للمشاركة مع العميل.
    ما يحتاج فلترة store_id لأنه البحث أصلاً بـ unique_token (UUID غير
    قابل للتخمين)، مش بـ id متسلسل. آمن كما هو.
    """
    invoice = db.query(Invoice).filter(Invoice.unique_token == token).first()
    if not invoice or invoice.status == InvoiceStatus.DRAFT:
        raise HTTPException(404, "الفاتورة غير موجودة أو غير متاحة")

    from app.models.product import Product
    from app.models.customer import Customer

    customer_name = None
    if invoice.customer_id:
        customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
        customer_name = customer.name if customer else None

    items_out = []
    for item in invoice.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        items_out.append({
            "product_name": product.name if product else "—",
            "quantity": item.quantity,
            "unit_type": "قطعة" if item.unit_type == "piece" else "كرتونة",
            "unit_price": item.unit_price,
            "discount_amount": item.discount_amount,
            "total": item.total,
        })

    return {
        "invoice_number": invoice.invoice_number,
        "invoice_date": invoice.invoice_date or invoice.created_at.date(),
        "created_at": invoice.created_at,
        "status": invoice.status,
        "items": items_out,
        "subtotal": invoice.subtotal,
        "discount_percent": invoice.discount_percent,
        "discount_amount": invoice.discount_amount,
        "tax_percent": invoice.tax_percent,
        "tax_amount": invoice.tax_amount,
        "total": invoice.total,
        "paid_amount": invoice.paid_amount,
        "remaining_amount": invoice.remaining_amount,
        "payment_status": invoice.payment_status,
        "notes": invoice.notes,
        "customer_name": customer_name,
    }


# ══════════════════════════════════════════════════════════
#  إحصائيات POS اليوم
# ══════════════════════════════════════════════════════════

@router.get("/stats/today", summary="إحصائيات اليوم")
def today_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from datetime import date
    from sqlalchemy import func
    from app.models.product import Product

    today = date.today()

    invoices_today = (
        db.query(Invoice)
        .filter(
            Invoice.store_id == store_id,
            func.date(Invoice.created_at) == today,
            Invoice.invoice_type == InvoiceType.SALE,
            Invoice.status == InvoiceStatus.COMPLETED,
        )
        .all()
    )

    total_sales     = sum(i.total          for i in invoices_today)
    total_collected = sum(i.paid_amount    for i in invoices_today)
    total_remaining = sum(i.remaining_amount for i in invoices_today)

    total_profit     = 0.0
    total_items_sold = 0
    for inv in invoices_today:
        for item in inv.items:
            cost   = item.cost_price * item.quantity
            profit = item.total - cost
            total_profit     += profit
            total_items_sold += 1

    return {
        "date":            today.isoformat(),
        "invoices_count":  len(invoices_today),
        "total_sales":     round(total_sales, 2),
        "total_collected": round(total_collected, 2),
        "total_remaining": round(total_remaining, 2),
        "total_profit":    round(total_profit, 2),
        "profit_margin":   round((total_profit / total_sales * 100) if total_sales > 0 else 0, 2),
        "items_sold":      total_items_sold,
    }