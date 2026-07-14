from typing import Optional
from pydantic import BaseModel


class StoreSettingsUpdate(BaseModel):
    store_name: Optional[str] = None
    logo_url: Optional[str] = None
    currency: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    invoice_footer_note: Optional[str] = None


class StoreSettingsOut(BaseModel):
    id: int
    store_name: str
    logo_url: Optional[str] = None
    currency: str
    phone: Optional[str] = None
    address: Optional[str] = None
    tax_number: Optional[str] = None
    invoice_footer_note: Optional[str] = None

    class Config:
        from_attributes = True  # لو المشروع على Pydantic v1 استبدلها بـ: orm_mode = True