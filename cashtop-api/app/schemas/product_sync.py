from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class ProductSyncOut(BaseModel):
    id: str
    name: str
    name_ar: Optional[str] = None
    barcode_piece: Optional[str] = None
    barcode_carton: Optional[str] = None
    retail_price: float
    carton_price: float
    cost_price: float
    tax_rate: float
    pieces_per_carton: int
    stock_quantity: float
    category_id: Optional[str] = None
    supplier_id: Optional[str] = None
    is_active: bool
    updated_at: datetime

    class Config:
        from_attributes = True


class ProductPullResponse(BaseModel):
    products: List[ProductSyncOut]
    server_time: datetime


class ProductProfileUpdateIn(BaseModel):
    id: str
    name: Optional[str] = None
    name_ar: Optional[str] = None
    barcode_piece: Optional[str] = None
    barcode_carton: Optional[str] = None
    retail_price: Optional[float] = None
    carton_price: Optional[float] = None
    cost_price: Optional[float] = None
    tax_rate: Optional[float] = None
    pieces_per_carton: Optional[int] = None
    stock_quantity: Optional[float] = None
    is_active: Optional[bool] = None
    updated_at: datetime


class ProductProfilePushRequest(BaseModel):
    profiles: List[ProductProfileUpdateIn]
