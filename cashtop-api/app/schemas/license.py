from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class LicenseKeyGenerateRequest(BaseModel):
    days_valid: str
    count: Optional[int] = 1  # How many keys to generate

class LicenseKeyActivateRequest(BaseModel):
    key: str

class LicenseKeyResponse(BaseModel):
    id: str
    key: str
    days_valid: str
    is_used: bool
    used_at: Optional[datetime]
    used_by_store_id: Optional[int]

    class Config:
        from_attributes = True
