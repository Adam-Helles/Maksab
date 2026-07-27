# app/schemas/offline_purchase.py

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator


class OfflinepurchaseItemIn(BaseModel):
    product_id: int
    quantity: float
    unit_type: str = "piece"
    unit_price: float  # يجي من الجهاز مباشرة (نفس ثقة override بالفاتورة الأونلاين)

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


class OfflinepurchaseIn(BaseModel):
    id: str  # UUID يتولّد بالجهاز — بيصير Invoice.client_uuid
    supplier_id: Optional[int] = None
    payment_method: str = "credit"
    items: List[OfflinepurchaseItemIn]
    client_created_at: datetime

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("لازم صنف واحد على الأقل")
        return v


class OfflinepurchasePushRequest(BaseModel):
    purchases: List[OfflinepurchaseIn]


class OfflinePurchaseResult(BaseModel):
    id: str  # نفس الـ client uuid — عشان الجهاز يعرف يطابقه مع سجله المحلي
    server_invoice_id: Optional[int] = None
    status: str  # "accepted" | "already_applied" | "rejected"
    needs_review: bool = False
    reason: Optional[str] = None


class OfflinepurchasePushResponse(BaseModel):
    results: List[OfflinePurchaseResult]


class NeedsReviewInvoiceOut(BaseModel):
    id: int
    invoice_number: str
    supplier_id: Optional[int]
    total: float
    review_notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
