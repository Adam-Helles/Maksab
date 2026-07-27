# app/services/offline_purchase.py
#
# منطق تحويل "بيع أوفلاين" (بسيط، بدون خصم يدوي) إلى فاتورة حقيقية
# كاملة (Invoice + InvoiceItem) بنفس آلية الفاتورة الأونلاين — عشان
# يضل المخزون والدين والتقارير كلهم مصدر حقيقة واحد.

from typing import List
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceItem, InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod
from app.models.product import Product
from app.models.supplier import supplier
from app.models.stock_movement import MovementType
from app.services.inventory import move_stock
from app.utils.invoice_number import generate_invoice_number
from app.schemas.offline_purchase import OfflinepurchaseIn, OfflinePurchaseResult


def sync_offline_purchase(
    db: Session,
    store_id: int,
    user_id: int,
    purchase: OfflinepurchaseIn,
) -> OfflinePurchaseResult:
    """
    يعالج بيع أوفلاين واحد ويحوّله لفاتورة حقيقية.
    Idempotent عبر client_uuid — استدعاء نفس الـ purchase.id مرتين ما بينشئ
    فاتورتين، بيرجع نفس النتيجة الأولى.
    """
    # ── idempotency: هاد البيع اتزامن قبل هيك؟ ──────────────
    existing = db.query(Invoice).filter(Invoice.client_uuid == purchase.id).first()
    if existing is not None:
        return OfflinePurchaseResult(
            id=purchase.id,
            server_invoice_id=existing.id,
            status="already_applied",
            needs_review=existing.needs_review,
            reason=existing.review_notes,
        )

    # ── التحقق من العميل (مطلوب للآجل، اختياري للكاش) ─────────
    supplier = None
    if purchase.supplier_id is not None:
        supplier = db.query(supplier).filter(
            supplier.id == purchase.supplier_id,
            supplier.store_id == store_id,
        ).first()
        if supplier is None:
            return OfflinePurchaseResult(
                id=purchase.id,
                status="rejected",
                reason="العميل غير موجود أو لا ينتمي لمحلك",
            )
    elif purchase.payment_method == "credit":
        return OfflinePurchaseResult(
            id=purchase.id,
            status="rejected",
            reason="البيع الآجل يتطلب اختيار عميل",
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
        tax_amount = subtotal_item * (product.tax_rate / 100)
        total_item = subtotal_item + tax_amount

        items_db.append(InvoiceItem(
            store_id=store_id,
            product_id=product.id,
            quantity=item_in.quantity,
            unit_type=item_in.unit_type,
            unit_price=item_in.unit_price,
            cost_price=product.cost_price,
            discount_amount=0.0,
            tax_amount=round(tax_amount, 3),
            total=round(total_item, 3),
        ))
        products_by_item.append(product)

    if not items_db:
        return OfflinePurchaseResult(
            id=purchase.id,
            status="rejected",
            reason="لا يوجد صنف صالح واحد بهاي العملية — " + "؛ ".join(skipped_notes),
        )

    # ── إنشاء الفاتورة ────────────────────────────────────────
    subtotal = round(sum(i.total for i in items_db), 3)
    total = subtotal  # بدون خصم/ضريبة على مستوى الفاتورة بالنسخة الأولى

    is_cash = purchase.payment_method == "cash"
    paid_amount = total if is_cash else 0.0
    remaining_amount = 0.0 if is_cash else total
    payment_status = PaymentStatus.PAID if is_cash else PaymentStatus.UNPAID
    payment_method_enum = PaymentMethod.CASH if is_cash else PaymentMethod.CREDIT
    notes_text = "بيع نقدي — تمت المزامنة من جهاز أوفلاين" if is_cash else "بيع بالآجل — تمت المزامنة من جهاز أوفلاين"

    invoice = Invoice(
        store_id=store_id,
        client_uuid=purchase.id,
        invoice_number=generate_invoice_number(db, store_id),
        invoice_type=InvoiceType.PURCHASE,
        status=InvoiceStatus.COMPLETED,
        payment_status=payment_status,
        payment_method=payment_method_enum,
        supplier_id=supplier.id if supplier else None,
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

    # ── خصم المخزون — لو نقص، ما نرفض الفاتورة، منعلّمها للمراجعة ──
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
                notes="بيع بالآجل أوفلاين",
            )
        except ValueError as e:
            review_notes.append(str(e))

    # ── تحديث دين العميل (للبيع الآجل فقط) ─────────────────────
    # البضاعة طلعت فعلاً من المحل وقت البيع الأوفلاين — الدين حقيقي
    if supplier and invoice.remaining_amount > 0:
        supplier.current_debt += invoice.remaining_amount

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
