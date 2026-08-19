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
from datetime import datetime, timezone
import enum
import uuid
from pydantic import BaseModel
from typing import List

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
    store_id: str = Depends(get_current_store_id),
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
                notes       = f"دفعة نقدية (أوفلاين) - {payment.id}",
            ))

        accepted.append(payment.id)

    db.commit()
    return {
        "accepted": accepted,
        "already_applied": already_applied,
        "rejected_wrong_store": rejected_wrong_store,
    }



class PaymentCancelRequest(BaseModel):
    payment_ids: List[str]

@router.post("/payments/cancel")
def cancel_payments(
    payload: PaymentCancelRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: str = Depends(get_current_store_id),
):
    from app.models.invoice import Invoice, Payment, PaymentStatus
    
    accepted = []
    
    for pid in payload.payment_ids:
        # Find the DebtPayment
        dp = db.query(DebtPayment).filter(DebtPayment.id == pid, DebtPayment.store_id == store_id).first()
        if not dp:
            # Already cancelled or wrong store
            accepted.append(pid)
            continue
            
        # We DO NOT modify customer.current_debt here, because universal_sync.py 
        # will receive the exact current_debt from the mobile app's explicit customer push.
        # But we MUST reverse the invoice payments!
        
        # Find associated Payments
        # Either matched by exact ID in notes, or if old payment, matched by exact time and amount
        payments = db.query(Payment).filter(
            Payment.store_id == store_id,
            Payment.notes.like(f"%{pid}%")
        ).all()
        
        # Fallback for old payments without ID in notes
        if not payments:
            # Try to find payments created within a small window of server_applied_at
            from datetime import timedelta
            window_start = dp.server_applied_at - timedelta(seconds=2)
            window_end = dp.server_applied_at + timedelta(seconds=2)
            
            payments = db.query(Payment).filter(
                Payment.store_id == store_id,
                Payment.notes == "دفعة نقدية (أوفلاين)",
                Payment.created_at >= window_start,
                Payment.created_at <= window_end
            ).all()
            
            # Since multiple payments might exist in that window, filter those that sum exactly to dp.amount?
            # It's safer to just take payments that belong to this customer.
            # But Payment only has invoice_id. Let's filter by customer via Invoice.
            valid_payments = []
            for p in payments:
                inv = db.query(Invoice).filter(Invoice.id == p.invoice_id, Invoice.customer_id == dp.customer_id).first()
                if inv:
                    valid_payments.append(p)
            payments = valid_payments
            
        # Reverse the payments
        for p in payments:
            inv = db.query(Invoice).filter(Invoice.id == p.invoice_id).first()
            if inv:
                inv.paid_amount = max(0.0, inv.paid_amount - p.amount)
                inv.remaining_amount = inv.remaining_amount + p.amount
                
                if inv.remaining_amount > 0:
                    if inv.paid_amount > 0:
                        inv.payment_status = PaymentStatus.PARTIAL
                    else:
                        inv.payment_status = PaymentStatus.UNPAID
            
            db.delete(p)
            
        db.delete(dp)
        accepted.append(pid)
        
    db.commit()
    return {"accepted": accepted}

@router.post("/debts/push")
def push_debts(
    payload: DebtPushRequest,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: str = Depends(get_current_store_id),
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
    store_id: str = Depends(get_current_store_id),
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
    store_id: str = Depends(get_current_store_id),
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