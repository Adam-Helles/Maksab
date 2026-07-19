"""
خدمة الفواتير — المنطق المركزي لـ POS
يتحكم في: إنشاء الفاتورة، إضافة الأصناف، الخصومات،
تعليق الفاتورة، الإكمال، الإلغاء، والدفع الجزئي.
"""
from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.invoice import (
    Invoice, InvoiceItem, Payment,
    InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod
)
from app.models.product import Product
from app.models.customer import Customer
from app.models.supplier import Supplier
from app.models.stock_movement import MovementType
from app.services.inventory import move_stock
from app.utils.invoice_number import (
    generate_invoice_number, generate_purchase_number, generate_return_number
)
from app.schemas.invoice import InvoiceCreate, InvoiceAddItem


# ══════════════════════════════════════════════════════════
#  دالة مساعدة: حساب سعر الوحدة
# ══════════════════════════════════════════════════════════

def _resolve_unit_price(product: Product, unit_type: str, override_price: Optional[float]) -> float:
    """يرجع السعر المناسب للوحدة المطلوبة"""
    if override_price is not None:
        return override_price
    if unit_type == "carton":
        return product.carton_price
    return product.retail_price


def _qty_in_pieces(quantity: float, unit_type: str, pieces_per_carton: int) -> float:
    return quantity * pieces_per_carton if unit_type == "carton" else quantity


# ══════════════════════════════════════════════════════════
#  إنشاء الفاتورة
# ══════════════════════════════════════════════════════════

def create_invoice(
    db: Session,
    data: InvoiceCreate,
    user_id: int,
    store_id: int,
    base_url: str = "http://localhost:8000",
) -> Invoice:
    """
    ينشئ فاتورة جديدة.
    - as_draft=True  → تُحفظ معلّقة، لا يُخصم من المخزون
    - as_draft=False → تكتمل فوراً ويُخصم من المخزون

    ⚠️ store_id إجباري وبيتحدد من التوكن (عبر الراوتر) — كل عنصر
    بالفاتورة (عميل، مورد، منتجات) لازم يتحقق إنه يخص نفس المحل قبل
    ما نسمح باستخدامه، وإلا مستخدم بمحل يقدر يلمس بيانات/أرصدة تاجر تاني.
    """
    # ── توليد رقم الفاتورة (مفلتر بالمحل) ──────────────────
    if data.invoice_type == InvoiceType.PURCHASE:
        inv_number = generate_purchase_number(db, store_id)
    elif data.invoice_type in (InvoiceType.SALE_RETURN, InvoiceType.PURCHASE_RETURN):
        inv_number = generate_return_number(db, store_id)
    else:
        inv_number = generate_invoice_number(db, store_id)

    # ── التحقق من العميل + إنه يخص نفس المحل ────────────────
    customer = None
    if data.customer_id:
        # ⚠️ فلترة store_id إجبارية: بدونها مستخدم يقدر يبعت customer_id
        # لعميل تاجر تاني ويعدّل دينه فعلياً بعد شوي بـ _apply_stock_and_debt
        customer = db.query(Customer).filter(
            Customer.id == data.customer_id,
            Customer.store_id == store_id,
        ).first()
        if not customer:
            raise ValueError("العميل غير موجود أو لا ينتمي لمحلك")
        if not data.as_draft and data.payment_method == PaymentMethod.CREDIT:
            if not customer.can_buy_on_credit:
                raise ValueError(
                    f"العميل '{customer.name}' تجاوز حده الائتماني "
                    f"(الدين الحالي: {customer.current_debt:.2f} | الحد: {customer.credit_limit:.2f})"
                )

    # ── التحقق من المورد + إنه يخص نفس المحل ────────────────
    if data.supplier_id:
        supplier = db.query(Supplier).filter(
            Supplier.id == data.supplier_id,
            Supplier.store_id == store_id,
        ).first()
        if not supplier:
            raise ValueError("المورد غير موجود أو لا ينتمي لمحلك")

    # ── بناء أصناف الفاتورة ─────────────────────────────
    items_db = []
    for item_data in data.items:
        # ⚠️ فلترة store_id إجبارية على المنتج — وإلا مستخدم يضيف منتج
        # تاجر تاني لفاتورته (تسريب سعر/تكلفة + حركة مخزون غلط)
        product = db.query(Product).filter(
            Product.id == item_data.product_id,
            Product.store_id == store_id,
            Product.is_active == True,
            Product.is_deleted == False,
        ).first()
        if not product:
            raise ValueError(f"المنتج {item_data.product_id} غير موجود أو غير نشط أو لا ينتمي لمحلك")

        unit_price = _resolve_unit_price(product, item_data.unit_type, item_data.unit_price)
        qty_pieces = _qty_in_pieces(item_data.quantity, item_data.unit_type, product.pieces_per_carton)

        # التحقق من المخزون (فقط للبيع وليس للمسودة)
        if not data.as_draft and data.invoice_type == InvoiceType.SALE:
            if product.stock_quantity < qty_pieces:
                raise ValueError(
                    f"مخزون '{product.name}' غير كافٍ — متوفر: {product.stock_quantity} | مطلوب: {qty_pieces}"
                )

        subtotal_item = item_data.quantity * unit_price
        after_discount = subtotal_item - item_data.discount_amount
        tax_amount = after_discount * (product.tax_rate / 100)
        total_item = after_discount + tax_amount

        items_db.append(InvoiceItem(
            store_id=store_id,   # ⚠️ جديد
            product_id=product.id,
            quantity=item_data.quantity,
            unit_type=item_data.unit_type,
            unit_price=unit_price,
            cost_price=product.cost_price,
            discount_amount=item_data.discount_amount,
            tax_amount=round(tax_amount, 3),
            total=round(total_item, 3),
        ))

    # ── حساب إجماليات الفاتورة ──────────────────────────
    subtotal = sum(i.total for i in items_db)

    # ✅ حماية: الخصم والضريبة يجب أن تكون في نطاق منطقي
    safe_discount_percent = max(0.0, min(100.0, data.discount_percent))
    safe_discount_amount  = max(0.0, data.discount_amount)
    safe_tax_percent      = max(0.0, min(100.0, data.tax_percent))

    line_discount = safe_discount_percent / 100 * subtotal
    total_after_discount = subtotal - line_discount - safe_discount_amount
    # ⚠️ حماية: منع الإجمالي من أن يصبح سالباً (لو خصم المبلغ أكبر من قيمة الفاتورة)
    total_after_discount = max(0.0, total_after_discount)
    tax_amount = total_after_discount * (safe_tax_percent / 100)
    total = round(total_after_discount + tax_amount, 3)

    paid = min(data.paid_amount, total)
    remaining = round(total - paid, 3)

    # ── تحديد حالة الدفع ────────────────────────────────
    if data.as_draft:
        pay_status = PaymentStatus.UNPAID
    elif paid >= total:
        pay_status = PaymentStatus.PAID
    elif paid > 0:
        pay_status = PaymentStatus.PARTIAL
    else:
        pay_status = PaymentStatus.UNPAID

    status = InvoiceStatus.DRAFT if data.as_draft else InvoiceStatus.COMPLETED

    # ── إنشاء الفاتورة ───────────────────────────────────
    invoice = Invoice(
        store_id=store_id,   # ⚠️ جديد
        invoice_number=inv_number,
        invoice_type=data.invoice_type,
        status=status,
        payment_status=pay_status,
        payment_method=data.payment_method,
        customer_id=data.customer_id,
        supplier_id=data.supplier_id,
        created_by=user_id,
        subtotal=round(subtotal, 3),
        discount_percent=data.discount_percent,
        discount_amount=data.discount_amount,
        tax_percent=data.tax_percent,
        tax_amount=round(tax_amount, 3),
        total=total,
        paid_amount=round(paid, 3),
        remaining_amount=remaining,
        notes=data.notes,
        invoice_date=data.invoice_date,
    )
    invoice.items = items_db
    db.add(invoice)
    db.flush()  # نحصل على ID قبل commit

    # ── تسجيل الدفعة إذا كان هناك مبلغ مدفوع ───────────
    if paid > 0 and not data.as_draft:
        payment = Payment(
            store_id=store_id,   # ⚠️ جديد
            invoice_id=invoice.id,
            amount=paid,
            method=data.payment_method,
            received_by=user_id,
        )
        db.add(payment)

    # ── خصم المخزون + تحديث دين العميل (فواتير مكتملة فقط) ──
    if not data.as_draft:
        _apply_stock_and_debt(db, invoice, items_db, user_id)

    db.commit()
    db.refresh(invoice)
    return invoice


# ══════════════════════════════════════════════════════════
#  تأثير على المخزون والديون
# ══════════════════════════════════════════════════════════

def _apply_stock_and_debt(db: Session, invoice: Invoice, items: list, user_id: int):
    """
    يطبّق خصم/إضافة المخزون وتحديث دين العميل/المورد.

    ملاحظة أمنية: ما ضفنا فلترة store_id هون لأنه كل product_id/customer_id/
    supplier_id يلي وصل لهاد الدالة انفحص فعلياً بمحل المستخدم بدالة
    create_invoice (أو بـ invoice المُتحقق منها مسبقاً بالراوتر عبر
    _get_owned_invoice). طالما هاد الدالة ما بتستقبل قيم خام من request
    مباشرة، منيح.
    """

    for item in items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            continue

        if invoice.invoice_type == InvoiceType.SALE:
            move_stock(
                db=db,
                product_id=item.product_id,
                movement_type=MovementType.SALE,
                quantity=item.quantity,
                store_id=invoice.store_id,   # ⚠️ جديد
                unit_type=item.unit_type,
                user_id=user_id,
                invoice_id=invoice.id,
                unit_cost=item.cost_price,
            )
        elif invoice.invoice_type == InvoiceType.PURCHASE:
            move_stock(
                db=db,
                product_id=item.product_id,
                movement_type=MovementType.PURCHASE,
                quantity=item.quantity,
                store_id=invoice.store_id,   # ⚠️ جديد
                unit_type=item.unit_type,
                user_id=user_id,
                invoice_id=invoice.id,
                unit_cost=item.unit_price,
            )
        elif invoice.invoice_type == InvoiceType.SALE_RETURN:
            move_stock(
                db=db,
                product_id=item.product_id,
                movement_type=MovementType.RETURN_FROM_CUSTOMER,
                quantity=item.quantity,
                store_id=invoice.store_id,   # ⚠️ جديد
                unit_type=item.unit_type,
                user_id=user_id,
                invoice_id=invoice.id,
            )
        elif invoice.invoice_type == InvoiceType.PURCHASE_RETURN:
            move_stock(
                db=db,
                product_id=item.product_id,
                movement_type=MovementType.RETURN_TO_SUPPLIER,
                quantity=item.quantity,
                store_id=invoice.store_id,   # ⚠️ جديد
                unit_type=item.unit_type,
                user_id=user_id,
                invoice_id=invoice.id,
            )

    # ── تحديث دين العميل ────────────────────────────────
    if invoice.customer_id and invoice.invoice_type == InvoiceType.SALE:
        customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
        if customer:
            customer.current_debt += invoice.remaining_amount

    # ── تحديث رصيد المورد ───────────────────────────────
    if invoice.supplier_id and invoice.invoice_type == InvoiceType.PURCHASE:
        supplier = db.query(Supplier).filter(Supplier.id == invoice.supplier_id).first()
        if supplier:
            supplier.balance += invoice.remaining_amount


# ══════════════════════════════════════════════════════════
#  إكمال فاتورة معلّقة (draft → completed)
# ══════════════════════════════════════════════════════════

def complete_draft_invoice(db: Session, invoice: Invoice, user_id: int, paid_amount: float = 0.0) -> Invoice:
    """
    ملاحظة: invoice هون وصلت من الراوتر عبر _get_owned_invoice، يعني
    مضمون إنها تخص محل المستخدم قبل ما توصل هون. ما محتاجين store_id
    إضافي بهاي الدالة.
    """
    if invoice.status != InvoiceStatus.DRAFT:
        raise ValueError("الفاتورة ليست في حالة مسودة")

    # تحقق من المخزون
    for item in invoice.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product and invoice.invoice_type == InvoiceType.SALE:
            qty_pieces = _qty_in_pieces(item.quantity, item.unit_type, product.pieces_per_carton)
            if product.stock_quantity < qty_pieces:
                raise ValueError(
                    f"مخزون '{product.name}' غير كافٍ — متوفر: {product.stock_quantity} | مطلوب: {qty_pieces}"
                )

    paid = min(paid_amount, invoice.total)
    remaining = round(invoice.total - paid, 3)

    invoice.paid_amount = round(paid, 3)
    invoice.remaining_amount = remaining
    invoice.status = InvoiceStatus.COMPLETED

    if paid >= invoice.total:
        invoice.payment_status = PaymentStatus.PAID
    elif paid > 0:
        invoice.payment_status = PaymentStatus.PARTIAL
    else:
        invoice.payment_status = PaymentStatus.UNPAID

    if paid > 0:
        payment = Payment(
            store_id=invoice.store_id,   # ⚠️ جديد — نأخذه من الفاتورة نفسها
            invoice_id=invoice.id,
            amount=paid,
            method=invoice.payment_method,
            received_by=user_id,
        )
        db.add(payment)

    _apply_stock_and_debt(db, invoice, invoice.items, user_id)
    db.commit()
    db.refresh(invoice)
    return invoice


# ══════════════════════════════════════════════════════════
#  إلغاء فاتورة
# ══════════════════════════════════════════════════════════

def cancel_invoice(db: Session, invoice: Invoice, user_id: int, reason: str = "") -> Invoice:
    """invoice هون كمان وصلت مُتحقق منها مسبقاً عبر _get_owned_invoice بالراوتر."""
    if invoice.status == InvoiceStatus.CANCELLED:
        raise ValueError("الفاتورة ملغاة مسبقاً")

    was_completed = invoice.status == InvoiceStatus.COMPLETED

    invoice.status = InvoiceStatus.CANCELLED
    invoice.notes = f"[ملغاة] {reason}\n{invoice.notes or ''}".strip()

    # إعادة المخزون إذا كانت مكتملة
    if was_completed:
        for item in invoice.items:
            if invoice.invoice_type == InvoiceType.SALE:
                move_stock(
                    db=db,
                    product_id=item.product_id,
                    movement_type=MovementType.RETURN_FROM_CUSTOMER,
                    quantity=item.quantity,
                    store_id=invoice.store_id,   # ⚠️ جديد
                    unit_type=item.unit_type,
                    user_id=user_id,
                    invoice_id=invoice.id,
                    notes=f"إلغاء فاتورة {invoice.invoice_number}",
                )

        # إلغاء دين العميل
        if invoice.customer_id:
            customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
            if customer:
                customer.current_debt = max(0, customer.current_debt - invoice.remaining_amount)

    db.commit()
    db.refresh(invoice)
    return invoice


# ══════════════════════════════════════════════════════════
#  إضافة دفعة لفاتورة موجودة
# ══════════════════════════════════════════════════════════

def add_payment_to_invoice(
    db: Session,
    invoice: Invoice,
    amount: float,
    method: PaymentMethod,
    user_id: int,
    notes: str = "",
) -> Payment:
    """invoice هون كمان وصلت مُتحقق منها مسبقاً عبر _get_owned_invoice بالراوتر."""
    if invoice.status != InvoiceStatus.COMPLETED:
        raise ValueError("لا يمكن إضافة دفعة لفاتورة غير مكتملة")
    if invoice.payment_status == PaymentStatus.PAID:
        raise ValueError("الفاتورة مدفوعة بالكامل")

    actual_amount = min(amount, invoice.remaining_amount)

    payment = Payment(
        store_id=invoice.store_id,   # ⚠️ جديد — نأخذه من الفاتورة نفسها
        invoice_id=invoice.id,
        amount=actual_amount,
        method=method,
        received_by=user_id,
        notes=notes,
    )
    db.add(payment)

    invoice.paid_amount = round(invoice.paid_amount + actual_amount, 3)
    invoice.remaining_amount = round(invoice.total - invoice.paid_amount, 3)

    if invoice.remaining_amount <= 0:
        invoice.payment_status = PaymentStatus.PAID
        invoice.remaining_amount = 0
        if invoice.customer_id:
            customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
            if customer:
                customer.current_debt = max(0, customer.current_debt - actual_amount)
    else:
        invoice.payment_status = PaymentStatus.PARTIAL
        if invoice.customer_id:
            customer = db.query(Customer).filter(Customer.id == invoice.customer_id).first()
            if customer:
                customer.current_debt = max(0, customer.current_debt - actual_amount)

    db.commit()
    db.refresh(payment)
    return payment


# ══════════════════════════════════════════════════════════
#  بناء روابط الفاتورة
# ══════════════════════════════════════════════════════════

def build_invoice_urls(invoice: Invoice, base_url: str) -> dict:
    share_url = f"{base_url}/api/v1/invoices/public/{invoice.unique_token}"
    whatsapp_text = (
        f"فاتورتك من محلنا 🧾\n"
        f"رقم الفاتورة: {invoice.invoice_number}\n"
        f"الإجمالي: {invoice.total:.2f}\n"
        f"المدفوع: {invoice.paid_amount:.2f}\n"
        f"المتبقي: {invoice.remaining_amount:.2f}\n"
        f"رابط الفاتورة: {share_url}"
    )
    import urllib.parse
    whatsapp_url = f"https://wa.me/?text={urllib.parse.quote(whatsapp_text)}"
    return {"share_url": share_url, "whatsapp_url": whatsapp_url}