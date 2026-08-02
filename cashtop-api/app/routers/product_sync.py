from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.models.user import User
from app.core.auth import get_current_user, get_current_store_id
from app.schemas.product_sync import (
    ProductProfilePushRequest,
    ProductPullResponse,
    ProductSyncOut,
)

router = APIRouter(prefix="/sync/products", tags=["🔄 مزامنة المنتجات"])

@router.post("/profile/push")
def push_product_profiles(
    payload: ProductProfilePushRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: str = Depends(get_current_store_id),
):
    accepted = []
    overwritten_by_server = []
    rejected_wrong_store = []

    for profile in payload.profiles:
        product = db.query(Product).filter(
            Product.id == profile.id,
            Product.store_id == store_id,
        ).first()

        if product is None:
            rejected_wrong_store.append(profile.id)
            continue

        if product.updated_at is not None and product.updated_at >= profile.updated_at:
            overwritten_by_server.append(profile.id)
            continue

        fields_to_update = [
            "name", "name_ar", "barcode_piece", "barcode_carton", 
            "retail_price", "carton_price", "cost_price", "tax_rate", 
            "pieces_per_carton", "stock_quantity", "is_active"
        ]
        
        for field in fields_to_update:
            value = getattr(profile, field)
            if value is not None:
                setattr(product, field, value)

        accepted.append(profile.id)

    db.commit()
    return {
        "accepted": accepted,
        "overwritten_by_server": overwritten_by_server,
        "rejected_wrong_store": rejected_wrong_store,
    }


@router.get("/pull", response_model=ProductPullResponse)
def pull_products(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: str = Depends(get_current_store_id),
):
    query = db.query(Product).filter(
        Product.store_id == store_id,
        Product.is_deleted == False,
    )
    if since is not None:
        query = query.filter(Product.updated_at > since)

    products = query.all()
    return ProductPullResponse(
        products=[ProductSyncOut.model_validate(p) for p in products],
        server_time=datetime.utcnow(),
    )
