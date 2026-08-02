# app/schemas/offline_purchase.py

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator


class OfflinePurchaseItemIn(BaseModel):
    product_id: str
    quantity: float
    unit_type: str = "piece"
    unit_price: float

    @field_validator("quantity")
    @classmethod
    def qty_positive(cls, v):
        if v <= 0:
            raise ValueError("الكمية يجب أن تكون أكبر من صفر")
        return v

    @field_validator("unit_price")
    @classmethod
    def price_non_negative(cls, v):
        if v < 0:
            raise ValueError("السعر لا يمكن أن يكون سالباً")
        return v


class OfflinePurchaseIn(BaseModel):
    id: str  # UUID يتولّد بالجهاز — بيصير Invoice.client_uuid
    supplier_id: Optional[str] = None
    payment_method: str = "cash"
    items: List[OfflinePurchaseItemIn]
    client_created_at: datetime

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("لازم صنف واحد على الأقل")
        return v


class OfflinePurchasePushRequest(BaseModel):
    purchases: List[OfflinePurchaseIn]


class OfflinePurchaseResult(BaseModel):
    id: str
    server_invoice_id: Optional[int] = None
    status: str  # "accepted" | "already_applied" | "rejected"
    needs_review: bool = False
    reason: Optional[str] = None


class OfflinePurchasePushResponse(BaseModel):
    results: List[OfflinePurchaseResult]
