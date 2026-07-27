# app/services/offline_purchase.py
#
# منطق تحويل "شراء أوفلاين" إلى فاتورة حقيقية (Invoice PURCHASE)
# بنفس آلية الفاتورة الأونلاين — عشان يضل المخزون والتقارير
# كلهم مصدر حقيقة واحد. Idempotent عبر client_uuid.

from typing import List
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceItem, InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod
from app.models.product import Product
from app.models.supplier import Supplier
from app.models.stock_movement import MovementType
from app.services.inventory import move_stock
from app.utils.invoice_number import generate_invoice_number
from app.schemas.offline_purchase import OfflinePurchaseIn, OfflinePurchaseResult


def sync_offline_purchase(
    db: Session,
    store_id: int,
    user_id: int,
    purchase: OfflinePurchaseIn,
) -> OfflinePurchaseResult:
    """
    يعالج فاتورة شراء أوفلاين واحدة ويحوّلها لفاتورة حقيقية.
    Idempotent عبر client_uuid — استدعاء نفس الـ purchase.id مرتين
    ما بينشئ فاتورتين، بيرجع نفس النتيجة الأولى.
    """
    # ── idempotency: هاد الشراء اتزامن قبل هيك؟ ──────────────
    existing = db.query(Invoice).filter(Invoice.client_uuid == purchase.id).first()
    if existing is not None:
        return OfflinePurchaseResult(
            id=purchase.id,
            server_invoice_id=existing.id,
            status="already_applied",
            needs_review=existing.needs_review,
            reason=existing.review_notes,
        )

    # ── التحقق من المورد (اختياري) ─────────────────────────────
    supplier_obj = None
    if purchase.supplier_id is not None:
        supplier_obj = db.query(Supplier).filter(
            Supplier.id == purchase.supplier_id,
            Supplier.store_id == store_id,
        ).first()
        if supplier_obj is None:
            return OfflinePurchaseResult(
                id=purchase.id,
                status="rejected",
                reason="المورد غير موجود أو لا ينتمي لمحلك",
            )

    # ── بناء أصناف الفاتورة (تجاهل أي منتج مش موجود/مش لهاد المحل) ──
    items_db: List[InvoiceItem] = []
    products_by_item: List[Product] = []
    skipped_notes: List[str] = []

    for item_in in purchase.items:
        product = db.query(Product).filter(
            Product.id == item_in.product_id,
            Product.store_id == store_id,
            Product.is_active == True,
            Product.is_deleted == False,
        ).first()
        if product is None:
            skipped_notes.append(f"منتج غير موجود (id={item_in.product_id}) — تم تجاهل الصنف")
            continue

        subtotal_item = item_in.quantity * item_in.unit_price
        # فاتورة الشراء: الضريبة لا تُحتسب على التكلفة بهذه المرحلة
        total_item = subtotal_item

        items_db.append(InvoiceItem(
            store_id=store_id,
            product_id=product.id,
            quantity=item_in.quantity,
            unit_type=item_in.unit_type,
            unit_price=item_in.unit_price,
            cost_price=item_in.unit_price,  # سعر الشراء = التكلفة الجديدة
            discount_amount=0.0,
            tax_amount=0.0,
            total=round(total_item, 3),
        ))
        products_by_item.append(product)

    if not items_db:
        return OfflinePurchaseResult(
            id=purchase.id,
            status="rejected",
            reason="لا يوجد صنف صالح واحد بهاي العملية — " + "؛ ".join(skipped_notes),
        )

    # ── إنشاء فاتورة الشراء ───────────────────────────────────
    subtotal = round(sum(i.total for i in items_db), 3)
    total = subtotal

    is_cash = purchase.payment_method != "credit"
    paid_amount = total if is_cash else 0.0
    remaining_amount = 0.0 if is_cash else total
    payment_status = PaymentStatus.PAID if is_cash else PaymentStatus.UNPAID
    payment_method_enum = PaymentMethod.CASH if is_cash else PaymentMethod.CREDIT
    notes_text = "شراء نقدي — تمت المزامنة من جهاز أوفلاين"

    invoice = Invoice(
        store_id=store_id,
        client_uuid=purchase.id,
        invoice_number=generate_invoice_number(db, store_id),
        invoice_type=InvoiceType.PURCHASE,
        status=InvoiceStatus.COMPLETED,
        payment_status=payment_status,
        payment_method=payment_method_enum,
        supplier_id=supplier_obj.id if supplier_obj else None,
        created_by=user_id,
        subtotal=subtotal,
        total=total,
        paid_amount=paid_amount,
        remaining_amount=remaining_amount,
        invoice_date=purchase.client_created_at.date(),
        notes=notes_text,
    )
    invoice.items = items_db
    db.add(invoice)
    db.flush()  # نحتاج invoice.id قبل حركات المخزون

    # ── زيادة المخزون (شراء يزيد المخزون) ──────────────────────
    review_notes = list(skipped_notes)
    for item, product in zip(items_db, products_by_item):
        try:
            move_stock(
                db=db,
                product_id=product.id,
                movement_type=MovementType.PURCHASE,
                quantity=item.quantity,
                store_id=store_id,
                unit_type=item.unit_type,
                user_id=user_id,
                invoice_id=invoice.id,
                unit_cost=item.cost_price,
                notes="شراء أوفلاين",
            )
        except ValueError as e:
            review_notes.append(str(e))

    if review_notes:
        invoice.needs_review = True
        invoice.review_notes = " | ".join(review_notes)

    db.commit()
    db.refresh(invoice)

    return OfflinePurchaseResult(
        id=purchase.id,
        server_invoice_id=invoice.id,
        status="accepted",
        needs_review=invoice.needs_review,
        reason=invoice.review_notes,
    )
