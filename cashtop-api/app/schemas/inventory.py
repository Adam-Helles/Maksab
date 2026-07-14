from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import date, datetime
from app.models.stock_movement import MovementType


# ══════════════════════════════════════════════════════════
#  Stock Movement Schemas
# ══════════════════════════════════════════════════════════

class StockMovementCreate(BaseModel):
    """لتعديل يدوي من الـ API (adjustment فقط)"""
    product_id: int
    movement_type: MovementType
    quantity: float
    unit_type: str = "piece"       # piece | carton
    notes: Optional[str] = None
    reference: Optional[str] = None

    @field_validator("movement_type")
    @classmethod
    def only_manual_types(cls, v):
        allowed = {MovementType.ADJUSTMENT_IN, MovementType.ADJUSTMENT_OUT, MovementType.DAMAGED, MovementType.EXPIRED}
        if v not in allowed:
            raise ValueError("هذا النوع يُنشأ تلقائياً من الفواتير، لا يدوياً")
        return v

    @field_validator("unit_type")
    @classmethod
    def valid_unit(cls, v):
        if v not in ("piece", "carton"):
            raise ValueError("unit_type يجب أن يكون piece أو carton")
        return v


class StockMovementResponse(BaseModel):
    id: int
    product_id: int
    movement_type: MovementType
    quantity: float
    unit_type: str
    quantity_in_pieces: float
    stock_before: float
    stock_after: float
    unit_cost: float
    invoice_id: Optional[int]
    user_id: int
    notes: Optional[str]
    reference: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════
#  Product Batch Schemas
# ══════════════════════════════════════════════════════════

class BatchCreate(BaseModel):
    product_id: int
    quantity: float
    unit_type: str = "piece"
    cost_price: float = 0.0
    expiry_date: Optional[date] = None
    batch_number: Optional[str] = None
    supplier_id: Optional[int] = None
    notes: Optional[str] = None


class BatchResponse(BaseModel):
    id: int
    product_id: int
    batch_number: Optional[str]
    quantity: float
    cost_price: float
    expiry_date: Optional[date]
    is_expired: bool
    days_until_expiry: Optional[int]
    supplier_id: Optional[int]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════
#  Barcode Schemas
# ══════════════════════════════════════════════════════════

class BarcodeGenerateRequest(BaseModel):
    prefix: str = "20"   # 20-29 للاستخدام الداخلي


class BarcodeValidateRequest(BaseModel):
    barcode: str


class BarcodeValidateResponse(BaseModel):
    barcode: str
    type: str
    valid: bool


class BarcodeGenerateResponse(BaseModel):
    barcode_piece: str
    barcode_carton: str
    valid: bool


# ══════════════════════════════════════════════════════════
#  Alert Schemas
# ══════════════════════════════════════════════════════════

class LowStockAlert(BaseModel):
    id: int
    name: str
    barcode: Optional[str]
    current_stock: float
    min_stock_alert: float
    stock_in_cartons: float
    supplier_id: Optional[int]
    category: Optional[str]
    severity: str   # critical | warning


class ExpiryAlertSummary(BaseModel):
    total_expired: int
    total_expiring_soon: int


class ExpiryAlertResponse(BaseModel):
    check_date: str
    days_ahead: int
    summary: ExpiryAlertSummary
    expired: dict
    expiring_soon: dict
