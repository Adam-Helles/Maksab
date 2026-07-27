from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class CategorySyncOut(BaseModel):
    id: int
    name: str
    name_ar: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_active: bool
    updated_at: datetime

    class Config:
        from_attributes = True


class CategoryPullResponse(BaseModel):
    categories: List[CategorySyncOut]
    server_time: datetime


class CategoryProfileUpdateIn(BaseModel):
    id: int
    name: Optional[str] = None
    name_ar: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    updated_at: datetime


class CategoryProfilePushRequest(BaseModel):
    profiles: List[CategoryProfileUpdateIn]
