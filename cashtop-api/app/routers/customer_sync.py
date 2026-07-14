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
        accepted.append(payment.id)

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