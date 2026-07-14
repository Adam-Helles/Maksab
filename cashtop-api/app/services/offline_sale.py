# app/services/offline_sale.py
#
# منطق تحويل "بيع أوفلاين" (بسيط، بدون خصم يدوي) إلى فاتورة حقيقية
# كاملة (Invoice + InvoiceItem) بنفس آلية الفاتورة الأونلاين — عشان
# يضل المخزون والدين والتقارير كلهم مصدر حقيقة واحد.

from typing import List
from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceItem, InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod
from app.models.product import Product
from app.models.customer import Customer
from app.models.stock_movement import MovementType
from app.services.inventory import move_stock
from app.utils.invoice_number import generate_invoice_number
from app.schemas.offline_sale import OfflineSaleIn, OfflineSaleResult


def sync_offline_sale(
    db: Session,
    store_id: int,
    user_id: int,
    sale: OfflineSaleIn,
) -> OfflineSaleResult:
    """
    يعالج بيع أوفلاين واحد ويحوّله لفاتورة حقيقية.
    Idempotent عبر client_uuid — استدعاء نفس الـ sale.id مرتين ما بينشئ
    فاتورتين، بيرجع نفس النتيجة الأولى.
    """
    # ── idempotency: هاد البيع اتزامن قبل هيك؟ ──────────────
    existing = db.query(Invoice).filter(Invoice.client_uuid == sale.id).first()
    if existing is not None:
        return OfflineSaleResult(
            id=sale.id,
            server_invoice_id=existing.id,
            status="already_applied",
            needs_review=existing.needs_review,
            reason=existing.review_notes,
        )

    # ── التحقق من العميل ─────────────────────────────────────
    customer = db.query(Customer).filter(
        Customer.id == sale.customer_id,
        Customer.store_id == store_id,
    ).first()
    if customer is None:
        return OfflineSaleResult(
            id=sale.id,
            status="rejected",
            reason="العميل غير موجود أو لا ينتمي لمحلك",
        )

    # ── بناء أصناف الفاتورة (تجاهل أي منتج مش موجود/مش لهاد المحل) ──
    items_db: List[InvoiceItem] = []
    products_by_item: List[Product] = []
    skipped_notes: List[str] = []

    for item_in in sale.items:
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
        return OfflineSaleResult(
            id=sale.id,
            status="rejected",
            reason="لا يوجد صنف صالح واحد بهاي العملية — " + "؛ ".join(skipped_notes),
        )

    # ── إنشاء الفاتورة (بيع بالآجل — مدفوع = 0) ──────────────
    subtotal = round(sum(i.total for i in items_db), 3)
    total = subtotal  # بدون خصم/ضريبة على مستوى الفاتورة بالنسخة الأولى

    invoice = Invoice(
        store_id=store_id,
        client_uuid=sale.id,
        invoice_number=generate_invoice_number(db, store_id),
        invoice_type=InvoiceType.SALE,
        status=InvoiceStatus.COMPLETED,
        payment_status=PaymentStatus.UNPAID,
        payment_method=PaymentMethod.CREDIT,
        customer_id=customer.id,
        created_by=user_id,
        subtotal=subtotal,
        total=total,
        paid_amount=0.0,
        remaining_amount=total,
        invoice_date=sale.client_created_at.date(),
        notes="بيع بالآجل — تمت المزامنة من جهاز أوفلاين",
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
                movement_type=MovementType.SALE,
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

    # ── تحديث دين العميل ──────────────────────────────────────
    # البضاعة طلعت فعلاً من المحل وقت البيع الأوفلاين — الدين حقيقي
    # بغض النظر عن دقة رصيد المخزون وقت المزامنة.
    customer.current_debt += invoice.remaining_amount

    if review_notes:
        invoice.needs_review = True
        invoice.review_notes = " | ".join(review_notes)

    db.commit()
    db.refresh(invoice)

    return OfflineSaleResult(
        id=sale.id,
        server_invoice_id=invoice.id,
        status="accepted",
        needs_review=invoice.needs_review,
        reason=invoice.review_notes,
    )