# app/schemas/offline_sale.py

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator


class OfflineSaleItemIn(BaseModel):
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


class OfflineSaleIn(BaseModel):
    id: str  # UUID يتولّد بالجهاز — بيصير Invoice.client_uuid
    customer_id: int  # بيع بالآجل دايماً مرتبط بعميل محدد
    items: List[OfflineSaleItemIn]
    client_created_at: datetime

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("لازم صنف واحد على الأقل")
        return v


class OfflineSalePushRequest(BaseModel):
    sales: List[OfflineSaleIn]


class OfflineSaleResult(BaseModel):
    id: str  # نفس الـ client uuid — عشان الجهاز يعرف يطابقه مع سجله المحلي
    server_invoice_id: Optional[int] = None
    status: str  # "accepted" | "already_applied" | "rejected"
    needs_review: bool = False
    reason: Optional[str] = None


class OfflineSalePushResponse(BaseModel):
    results: List[OfflineSaleResult]


class NeedsReviewInvoiceOut(BaseModel):
    id: int
    invoice_number: str
    customer_id: Optional[int]
    total: float
    review_notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True