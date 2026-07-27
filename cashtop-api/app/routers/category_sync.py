from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.models.user import User
from app.core.auth import get_current_user, get_current_store_id
from app.schemas.category_sync import (
    CategoryProfilePushRequest,
    CategoryPullResponse,
    CategorySyncOut,
)

router = APIRouter(prefix="/sync/categories", tags=["🔄 مزامنة الفئات"])

@router.post("/profile/push")
def push_category_profiles(
    payload: CategoryProfilePushRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    accepted = []
    overwritten_by_server = []
    rejected_wrong_store = []

    for profile in payload.profiles:
        category = db.query(Category).filter(
            Category.id == profile.id,
            Category.store_id == store_id,
        ).first()

        if category is None:
            rejected_wrong_store.append(profile.id)
            continue

        if category.updated_at is not None and category.updated_at >= profile.updated_at:
            overwritten_by_server.append(profile.id)
            continue

        for field in ["name", "name_ar", "color", "icon"]:
            value = getattr(profile, field)
            if value is not None:
                setattr(category, field, value)

        accepted.append(profile.id)

    db.commit()
    return {
        "accepted": accepted,
        "overwritten_by_server": overwritten_by_server,
        "rejected_wrong_store": rejected_wrong_store,
    }


@router.get("/pull", response_model=CategoryPullResponse)
def pull_categories(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    query = db.query(Category).filter(
        Category.store_id == store_id,
        Category.is_deleted == False,
    )
    if since is not None:
        query = query.filter(Category.updated_at > since)

    categories = query.all()
    return CategoryPullResponse(
        categories=[CategorySyncOut.model_validate(c) for c in categories],
        server_time=datetime.utcnow(),
    )
