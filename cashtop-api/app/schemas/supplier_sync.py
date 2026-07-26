# app/schemas/supplier_sync.py

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class SupplierPaymentEventIn(BaseModel):
    id: str  # UUID من الموبايل
    supplier_id: int
    amount: float
    method: str = "cash"
    client_created_at: datetime


class SupplierPaymentPushRequest(BaseModel):
    payments: List[SupplierPaymentEventIn]


class SupplierDebtEventIn(BaseModel):
    id: str  # UUID من الموبايل
    supplier_id: int
    amount: float
    notes: Optional[str] = None
    client_created_at: datetime


class SupplierDebtPushRequest(BaseModel):
    debts: List[SupplierDebtEventIn]


class SupplierProfileUpdateIn(BaseModel):
    id: int
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    updated_at: datetime


class SupplierProfilePushRequest(BaseModel):
    profiles: List[SupplierProfileUpdateIn]


class SupplierSyncOut(BaseModel):
    id: int
    name: str
    company: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    balance: float
    is_active: bool
    updated_at: datetime

    class Config:
        from_attributes = True


class SupplierPullResponse(BaseModel):
    suppliers: List[SupplierSyncOut]
    server_time: datetime
