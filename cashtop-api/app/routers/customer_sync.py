# app/routers/customer_sync.py
#
# ⚠️ هاد الملف يفترض إنه Customer عندها عمود store_id (لسا ما شفت
# models/customer.py — ابعتلي ياه لأتأكد وأعدّل الموديل نفسه بنفس
# الطريقة يلي عدّلت فيها User و Product). المنطق هون جاهز ومبني على
# الافتراض إنه العمود موجود أو رح تضيفه.

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.customer import Customer
from app.models.debt_payment import DebtPayment
from app.models.user import User
from app.core.auth import get_current_user, get_current_store_id
from app.schemas.customer_sync import (
    PaymentPushRequest,
    ProfilePushRequest,
    CustomerPullResponse,
    CustomerSyncOut,
    DebtPushRequest,
)

router = APIRouter(prefix="/sync/customers", tags=["🔄 مزامنة العملاء"])


@router.post("/payments/push")
def push_payments(
    payload: PaymentPushRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    كل دفعة = حدث مستقل يُطبَّق فوق آخر رصيد، مش رقم نهائي يستبدل current_debt.

    ⚠️ إصلاح أمني: قبل، ما في أي تحقق إنه العميل يخص محل المستخدم —
    أي مستخدم بأي محل كان يقدر يبعت customer_id لعميل بمحل تاني ويسجل
    عليه دفعة وهمية تنقص دينه. هلأ منتحقق إنه customer.store_id ==
    store_id المستخدم قبل أي عملية.
    """
    accepted = []
    already_applied = []
    rejected_wrong_store = []

    for payment in payload.payments:
        existing = db.query(DebtPayment).filter(DebtPayment.id == payment.id).first()
        if existing is not None:
            already_applied.append(payment.id)
            continue

        customer = db.query(Customer).filter(
            Customer.id == payment.customer_id,
            Customer.store_id == store_id,   # ⚠️ التحقق الحاسم
        ).first()
        if customer is None:
            # إما العميل مش موجود، أو موجود بس بمحل تاني — بالحالتين نرفض
            rejected_wrong_store.append(payment.id)
            continue

        db.add(
            DebtPayment(
                id=payment.id,
                store_id=store_id,   # ⚠️ جديد — دفاع بالعمق على جدول الدفعات نفسه
                customer_id=payment.customer_id,
                amount=payment.amount,
                method=payment.method,
                client_created_at=payment.client_created_at,
            )
        )
        customer.current_debt = max(0.0, customer.current_debt - payment.amount)
        
        # Distribute the payment over unpaid invoices
        from app.models.invoice import Invoice, InvoiceType, InvoiceStatus, PaymentStatus, Payment
        
        unpaid_invoices = db.query(Invoice).filter(
            Invoice.customer_id    == payment.customer_id,
            Invoice.store_id       == store_id,
            Invoice.invoice_type   == InvoiceType.SALE,
            Invoice.remaining_amount > 0,
            Invoice.status         == InvoiceStatus.COMPLETED,
        ).order_by(Invoice.created_at.asc()).all()

        remaining_payment = payment.amount
        for unpaid in unpaid_invoices:
            if remaining_payment <= 0:
                break
                
            apply = min(remaining_payment, unpaid.remaining_amount)
            unpaid.paid_amount      = round(unpaid.paid_amount + apply, 2)
            unpaid.remaining_amount = round(unpaid.remaining_amount - apply, 2)
            remaining_payment       = round(remaining_payment - apply, 2)
            
            if unpaid.remaining_amount <= 0:
                unpaid.payment_status = PaymentStatus.PAID
                
            db.add(Payment(
                store_id    = store_id,
                invoice_id  = unpaid.id,
                amount      = apply,
                method      = payment.method,
                received_by = _.id,
                notes       = "دفعة نقدية (أوفلاين)",
            ))

        accepted.append(payment.id)

    db.commit()
    return {
        "accepted": accepted,
        "already_applied": already_applied,
        "rejected_wrong_store": rejected_wrong_store,
    }


@router.post("/debts/push")
def push_debts(
    payload: DebtPushRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    إضافة ديون يدوية — يتم تسجيلها كفاتورة آجل (Invoice) مع بند واحد عام.
    هذا يضمن أن الديون تظهر بشكل صحيح في كشف الحساب والتقارير المالية.
    """
    from app.models.invoice import Invoice, InvoiceItem, InvoiceType, InvoiceStatus, PaymentStatus, PaymentMethod
    from app.models.product import Product
    import uuid

    accepted = []
    already_applied = []
    rejected_wrong_store = []

    # 1. التأكد من وجود "منتج عام" لتسجيل الديون عليه
    general_product = db.query(Product).filter(
        Product.store_id == store_id,
        Product.name == "دين يدوي / عام",
        Product.is_deleted == False
    ).first()
    
    if not general_product:
        general_product = Product(
            store_id=store_id,
            name="دين يدوي / عام",
            barcode=str(uuid.uuid4())[:8],
            category="خدمات",
            unit_price=0.0,
            cost_price=0.0,
            stock_quantity=999999,
            notes="منتج تلقائي لتسجيل الديون اليدوية للعملاء",
        )
        db.add(general_product)
        db.commit()
        db.refresh(general_product)

    for debt in payload.debts:
        # Check if already processed (since we don't have a dedicated table for manual debts, 
        # we can check if an invoice with this unique_token exists)
        existing = db.query(Invoice).filter(Invoice.unique_token == debt.id).first()
        if existing is not None:
            already_applied.append(debt.id)
            continue

        customer = db.query(Customer).filter(
            Customer.id == debt.customer_id,
            Customer.store_id == store_id,
        ).first()
        
        if customer is None:
            rejected_wrong_store.append(debt.id)
            continue

        # Generate a unique invoice number
        count = db.query(Invoice).filter(Invoice.store_id == store_id).count()
        inv_number = f"D-{count + 1001}"

        invoice = Invoice(
            store_id=store_id,
            invoice_number=inv_number,
            unique_token=debt.id,
            invoice_type=InvoiceType.SALE,
            status=InvoiceStatus.COMPLETED,
            payment_status=PaymentStatus.UNPAID,
            payment_method=PaymentMethod.CREDIT,
            customer_id=debt.customer_id,
            created_by=_.id,
            subtotal=debt.amount,
            total=debt.amount,
            paid_amount=0.0,
            remaining_amount=debt.amount,
            notes=debt.notes or "دين يدوي مسجل من التطبيق",
            created_at=debt.client_created_at
        )
        db.add(invoice)
        db.flush() # To get invoice ID

        item = InvoiceItem(
            store_id=store_id,
            invoice_id=invoice.id,
            product_id=general_product.id,
            quantity=1.0,
            unit_price=debt.amount,
            cost_price=0.0,
            total=debt.amount,
            notes=debt.notes or "دين يدوي"
        )
        db.add(item)
        
        customer.current_debt = round(customer.current_debt + debt.amount, 2)
        accepted.append(debt.id)

    db.commit()
    return {
        "accepted": accepted,
        "already_applied": already_applied,
        "rejected_wrong_store": rejected_wrong_store,
    }



@router.post("/profile/push")
def push_profiles(
    payload: ProfilePushRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    تعديلات بيانات العميل — Last-Write-Wins بمقارنة updated_at.
    """
    accepted = []
    overwritten_by_server = []
    rejected_wrong_store = []

    for profile in payload.profiles:
        customer = db.query(Customer).filter(
            Customer.id == profile.id,
            Customer.store_id == store_id,   # ⚠️ التحقق الحاسم
        ).first()
        if customer is None:
            rejected_wrong_store.append(profile.id)
            continue

        if customer.updated_at is not None and customer.updated_at >= profile.updated_at:
            overwritten_by_server.append(profile.id)
            continue

        for field in ["name", "phone", "phone2", "email", "address", "notes"]:
            value = getattr(profile, field)
            if value is not None:
                setattr(customer, field, value)

        accepted.append(profile.id)

    db.commit()
    return {
        "accepted": accepted,
        "overwritten_by_server": overwritten_by_server,
        "rejected_wrong_store": rejected_wrong_store,
    }


@router.get("/pull", response_model=CustomerPullResponse)
def pull_customers(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    يرجّع كل عميل تغيّر (بيانات أو دين) بعد آخر مزامنة — ضمن محل
    المستخدم فقط. قبل هالتعديل كان بيرجع عملاء كل المحلات بالنظام.
    """
    query = db.query(Customer).filter(
        Customer.store_id == store_id,
        Customer.is_deleted == False,
    )
    if since is not None:
        query = query.filter(Customer.updated_at > since)

    customers = query.all()
    return CustomerPullResponse(
        customers=[CustomerSyncOut.model_validate(c) for c in customers],
        server_time=datetime.utcnow(),
    )


# بـ main.py ضيف:
# from app.routers import customer_sync
# app.include_router(customer_sync.router, prefix="/api/v1")