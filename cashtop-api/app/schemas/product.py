from pydantic import BaseModel, model_validator
from typing import Optional
from datetime import date, datetime
from app.models.product import UnitType


class ProductCreate(BaseModel):
    name: str
    name_ar: Optional[str] = None
    description: Optional[str] = None
    barcode_piece: Optional[str] = None
    barcode_carton: Optional[str] = None

    base_unit: UnitType = UnitType.PIECE
    pieces_per_carton: int = 1

    cost_price: float = 0.0
    retail_price: float = 0.0
    wholesale_price: float = 0.0
    carton_price: float = 0.0

    stock_quantity: float = 0.0
    min_stock_alert: float = 5.0

    has_expiry: bool = False
    expiry_date: Optional[date] = None

    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    tax_rate: float = 0.0
    is_featured: bool = False

    @model_validator(mode="after")
    def auto_calculate_prices(self):
        """احسب سعر التجزئة من الكرتونة إذا لم يُعطَ"""
        if self.carton_price > 0 and self.retail_price == 0 and self.pieces_per_carton > 0:
            self.retail_price = round(self.carton_price / self.pieces_per_carton, 3)
        if self.retail_price > 0 and self.wholesale_price == 0:
            self.wholesale_price = round(self.retail_price * 0.9, 3)  # جملة = 90% من التجزئة
        return self


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    name_ar: Optional[str] = None
    description: Optional[str] = None
    barcode_piece: Optional[str] = None
    barcode_carton: Optional[str] = None
    pieces_per_carton: Optional[int] = None
    cost_price: Optional[float] = None
    retail_price: Optional[float] = None
    wholesale_price: Optional[float] = None
    carton_price: Optional[float] = None
    stock_quantity: Optional[float] = None
    min_stock_alert: Optional[float] = None
    has_expiry: Optional[bool] = None
    expiry_date: Optional[date] = None
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    tax_rate: Optional[float] = None
    is_active: Optional[bool] = None
    is_featured: Optional[bool] = None


class ProductResponse(BaseModel):
    id: int
    name: str
    name_ar: Optional[str]
    description: Optional[str]
    barcode_piece: Optional[str]
    barcode_carton: Optional[str]
    base_unit: UnitType
    pieces_per_carton: int
    cost_price: float
    retail_price: float
    wholesale_price: float
    carton_price: float
    piece_price_from_carton: float     # محسوبة
    stock_quantity: float
    stock_in_cartons: float            # محسوبة
    min_stock_alert: float
    is_low_stock: bool                 # محسوبة
    profit_margin: float               # محسوبة
    has_expiry: bool
    expiry_date: Optional[date]
    category_id: Optional[int]
    supplier_id: Optional[int]
    tax_rate: float
    is_active: bool
    is_featured: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ProductStockAdjust(BaseModel):
    """تعديل المخزون يدوياً"""
    quantity_change: float   # + للإضافة، - للخصم
    reason: str              # سبب التعديل
    unit_type: str = "piece" # piece أو carton
