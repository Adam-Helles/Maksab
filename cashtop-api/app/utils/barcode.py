"""
مولّد الباركود — يولّد EAN-13 صالح أو Code128 ويتحقق من صحته
"""
import random
import re
from typing import Optional


def ean13_check_digit(first_12: str) -> str:
    """يحسب رقم التحقق للـ EAN-13"""
    digits = [int(d) for d in first_12]
    total = sum(
        d * (1 if i % 2 == 0 else 3)
        for i, d in enumerate(digits)
    )
    check = (10 - (total % 10)) % 10
    return str(check)


def generate_ean13(prefix: str = "20") -> str:
    """
    يولّد EAN-13 عشوائي صالح.
    prefix='20' → منتجات محلية (prefixes 20-29 مخصصة للاستخدام الداخلي)
    """
    first_12 = prefix + "".join([str(random.randint(0, 9)) for _ in range(10)])
    return first_12 + ean13_check_digit(first_12)


def generate_carton_barcode(piece_barcode: str) -> str:
    """
    يولّد باركود الكرتونة من باركود القطعة.
    يستبدل الأرقام من موضع 2 إلى 3 بـ '99' لتمييز الكرتونة.
    """
    if len(piece_barcode) == 13 and piece_barcode.isdigit():
        first_12 = piece_barcode[:2] + "99" + piece_barcode[4:12]
        return first_12 + ean13_check_digit(first_12)
    # إذا مش EAN-13، أضف لاحقة -C
    return piece_barcode + "-C"


def validate_ean13(barcode: str) -> bool:
    """يتحقق من صحة EAN-13"""
    if not re.fullmatch(r"\d{13}", barcode):
        return False
    return ean13_check_digit(barcode[:12]) == barcode[12]


def validate_barcode(barcode: str) -> dict:
    """
    يتحقق من أي باركود ويعيد معلوماته
    """
    barcode = barcode.strip()
    if re.fullmatch(r"\d{13}", barcode):
        valid = validate_ean13(barcode)
        return {"type": "EAN-13", "valid": valid, "barcode": barcode}
    if re.fullmatch(r"\d{8}", barcode):
        return {"type": "EAN-8", "valid": True, "barcode": barcode}
    if re.fullmatch(r"\d{12}", barcode):
        return {"type": "UPC-A", "valid": True, "barcode": barcode}
    # Code128 / Code39 / QR → نقبلها كما هي
    return {"type": "Code128/Other", "valid": True, "barcode": barcode}


def generate_internal_code(product_id: int) -> str:
    """باركود داخلي بسيط بدون EAN (للمنتجات بدون باركود)"""
    return f"INT{product_id:08d}"
