# app/routers/offline_sync.py

from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.invoice import Invoice
from app.core.auth import get_current_user, get_current_store_id
from app.schemas.offline_purchase import (
    OfflinepurchasePushRequest,
    OfflinepurchasePushResponse,
    NeedsReviewInvoiceOut,
)
from app.services.offline_purchase import sync_offline_purchase

router = APIRouter(prefix="/sync/offline-purchases", tags=["🔄 مزامنة البيع الأوفلاين"])


@router.post("/push", response_model=OfflinepurchasePushResponse, summary="مزامنة مبيعات أوفلاين")
def push_offline_purchases(
    payload: OfflinepurchasePushRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    results = [
        sync_offline_purchase(db, store_id, current_user.id, purchase)
        for purchase in payload.purchases
    ]
    return OfflinepurchasePushResponse(results=results)


@router.get("/needs-review", response_model=List[NeedsReviewInvoiceOut], summary="فواتير تحتاج مراجعة يدوية")
def list_needs_review(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    فواتير بيع أوفلاين اتزامنت بس المخزون كان ناقص وقتها — التاجر
    لازم يراجعها ويصحح رصيد المخزون يدوياً (عبر شاشة تعديل المخزون
    الموجودة أصلاً).
    """
    return (
        db.query(Invoice)
        .filter(Invoice.store_id == store_id, Invoice.needs_review == True)
        .order_by(Invoice.created_at.desc())
        .all()
    )
