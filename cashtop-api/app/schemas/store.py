from pydantic import BaseModel, field_validator
from typing import Optional


class StoreSignupRequest(BaseModel):
    # ─── بيانات المحل ───────────────────────────────────
    store_name: str
    owner_name: Optional[str] = None
    store_phone: Optional[str] = None

    # ─── بيانات أول مستخدم (أدمن المحل) ─────────────────
    username: str
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    password: str

    # ─── مفتاح التفعيل (إلزامي) ──────────────────────────
    # ⚠️ أمني: بدون هذا المفتاح أي شخص يقدر ينشئ محلاً ويستنزف
    # موارد النظام. المفتاح يتحقق منه بالباكيند عبر جدول LicenseKey.
    license_key: str

    @field_validator("store_name")
    @classmethod
    def store_name_clean(cls, v):
        v = v.strip()
        if len(v) < 2:
            raise ValueError("اسم المحل يجب أن يكون حرفين على الأقل")
        return v

    @field_validator("username")
    @classmethod
    def username_clean(cls, v):
        v = v.strip().lower()
        if len(v) < 3:
            raise ValueError("اسم المستخدم يجب أن يكون 3 أحرف على الأقل")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("كلمة المرور يجب أن تكون 8 أحرف على الأقل")
        return v

    @field_validator("license_key")
    @classmethod
    def license_key_clean(cls, v):
        v = v.strip().upper()
        if not v:
            raise ValueError("مفتاح التفعيل مطلوب")
        return v