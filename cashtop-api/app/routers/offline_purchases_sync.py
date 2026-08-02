# app/routers/offline_purchases_sync.py

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.core.auth import get_current_user, get_current_store_id
from app.schemas.offline_purchase import (
    OfflinePurchasePushRequest,
    OfflinePurchasePushResponse,
)
from app.services.offline_purchase import sync_offline_purchase

router = APIRouter(prefix="/sync/offline-purchases", tags=["🔄 مزامنة المشتريات الأوفلاين"])


@router.post("/push", response_model=OfflinePurchasePushResponse, summary="مزامنة مشتريات أوفلاين")
def push_offline_purchases(
    payload: OfflinePurchasePushRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: str = Depends(get_current_store_id),
):
    results = [
        sync_offline_purchase(db, store_id, current_user.id, purchase)
        for purchase in payload.purchases
    ]
    return OfflinePurchasePushResponse(results=results)
