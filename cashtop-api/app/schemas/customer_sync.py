# app/schemas/customer_sync.py

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


# ─── دفعات (events) ─────────────────────────────────────────
class PaymentEventIn(BaseModel):
    id: str  # UUID من الجهاز
    customer_id: int
    amount: float
    method: str = "cash"
    client_created_at: datetime


class PaymentPushRequest(BaseModel):
    payments: List[PaymentEventIn]


# ─── تعديل بيانات العميل (last-write-wins آمن، بدون current_debt) ──
class ProfileUpdateIn(BaseModel):
    id: int
    name: Optional[str] = None
    phone: Optional[str] = None
    phone2: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None
    updated_at: datetime  # وقت التعديل بالجهاز


class ProfilePushRequest(BaseModel):
    profiles: List[ProfileUpdateIn]


# ─── سحب أي تحديثات من السيرفر ──────────────────────────────
class CustomerSyncOut(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    phone2: Optional[str]
    email: Optional[str]
    address: Optional[str]
    notes: Optional[str]
    credit_limit: float
    current_debt: float
    is_active: bool
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomerPullResponse(BaseModel):
    customers: List[CustomerSyncOut]
    server_time: datetime