from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ─── Category ─────────────────────────────────────────────
class CategoryCreate(BaseModel):
    name: str
    name_ar: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = "#3B82F6"
    icon: Optional[str] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    name_ar: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_active: Optional[bool] = None


class CategoryResponse(BaseModel):
    id: int
    name: str
    name_ar: Optional[str]
    description: Optional[str]
    color: Optional[str]
    icon: Optional[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Supplier ─────────────────────────────────────────────
class SupplierCreate(BaseModel):
    name: str
    company: Optional[str] = None
    phone: Optional[str] = None
    phone2: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    notes: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    phone2: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierResponse(BaseModel):
    id: int
    name: str
    company: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    address: Optional[str]
    balance: float
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Customer ─────────────────────────────────────────────
class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    phone2: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    credit_limit: float = 0.0
    notes: Optional[str] = None


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    phone2: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    credit_limit: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class CustomerResponse(BaseModel):
    id: int
    name: str
    phone: Optional[str]
    email: Optional[str]
    address: Optional[str]
    credit_limit: float
    current_debt: float
    available_credit: float
    can_buy_on_credit: bool
    loyalty_points: float
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
