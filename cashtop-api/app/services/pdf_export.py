"""
خدمة تصدير PDF باستخدام ReportLab مع دعم عربي كامل
- خط Amiri مُضمَّن مع المشروع (يعمل على أي سيرفر بدون تثبيت إضافي)
- النص العربي يُعالَج عبر arabic_reshaper + python-bidi
"""
import io
import os
from datetime import date
from typing import Optional
from sqlalchemy.orm import Session

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable,
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

# ── مسار الخط المُضمَّن مع المشروع ───────────────────────────
_FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "fonts")
_FONT_REGULAR = os.path.join(_FONTS_DIR, "Amiri-Regular.ttf")
_FONT_BOLD    = os.path.join(_FONTS_DIR, "Amiri-Bold.ttf")

def _register_fonts():
    """يُسجّل خط Amiri العربي مرة واحدة فقط عند أول استدعاء."""
    if "Amiri" not in pdfmetrics.getRegisteredFontNames():
        if os.path.exists(_FONT_REGULAR):
            pdfmetrics.registerFont(TTFont("Amiri", _FONT_REGULAR))
        else:
            # fallback إذا لم يوجد الخط (بيئة تطوير)
            pdfmetrics.registerFont(TTFont("Amiri", "Helvetica"))
    if "Amiri-Bold" not in pdfmetrics.getRegisteredFontNames():
        if os.path.exists(_FONT_BOLD):
            pdfmetrics.registerFont(TTFont("Amiri-Bold", _FONT_BOLD))
        else:
            pdfmetrics.registerFont(TTFont("Amiri-Bold", "Helvetica-Bold"))

_register_fonts()


def _ar(text: str) -> str:
    """يُعالج النص العربي ليظهر بالاتجاه الصحيح في PDF."""
    if not text:
        return ""
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display
        reshaped = arabic_reshaper.reshape(str(text))
        return get_display(reshaped)
    except Exception:
        return str(text)


def _style(name: str, bold: bool = False, **kwargs) -> ParagraphStyle:
    font = "Amiri-Bold" if bold else "Amiri"
    return ParagraphStyle(name, fontName=font, **kwargs)


# الألوان الرئيسية
PRIMARY   = colors.HexColor("#1E3A5F")
LIGHT_BG  = colors.HexColor("#F0F4F8")
WHITE     = colors.white
GREEN_BG  = colors.HexColor("#E8F5E9")
RED_BG    = colors.HexColor("#FFEBEE")
RED_TEXT  = colors.HexColor("#C62828")
BORDER    = colors.HexColor("#CCCCCC")
GRAY      = colors.HexColor("#888888")


# ══════════════════════════════════════════════════════════
#  فاتورة PDF (للمشاركة مع العميل)
# ══════════════════════════════════════════════════════════

def generate_invoice_pdf(
    db: Session,
    invoice_id: int,
    store_id: int,
    shop_name: str = "مكسب",
) -> bytes:
    from app.models.invoice import Invoice
    from app.models.product import Product

    invoice = db.query(Invoice).filter(
        Invoice.id == invoice_id,
        Invoice.store_id == store_id,
    ).first()
    if not invoice:
        raise ValueError("الفاتورة غير موجودة")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )

    # ── أنماط النص ──────────────────────────────────────────
    title_style  = _style("title",  bold=True,  fontSize=20, alignment=TA_CENTER, spaceAfter=4, textColor=PRIMARY)
    sub_style    = _style("sub",                fontSize=11, alignment=TA_CENTER, spaceAfter=6, textColor=GRAY)
    normal_style = _style("normal",             fontSize=10, alignment=TA_RIGHT,  spaceAfter=2)
    small_style  = _style("small",              fontSize=9,  alignment=TA_CENTER, textColor=GRAY)

    customer_name = invoice.customer.name if invoice.customer else "نقدي"
    inv_date      = (invoice.invoice_date or invoice.created_at.date()).strftime("%Y-%m-%d")
    payment_map   = {"paid": "مدفوعة ✅", "partial": "دفع جزئي", "unpaid": "آجل"}
    method_map    = {"cash": "نقدي", "card": "بطاقة", "transfer": "تحويل", "credit": "آجل"}

    elements = []

    # عنوان المحل
    elements.append(Paragraph(_ar(shop_name), title_style))
    elements.append(Paragraph(_ar(f"فاتورة مبيعات  |  {invoice.invoice_number}"), sub_style))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY))
    elements.append(Spacer(1, 0.4*cm))

    # بيانات الفاتورة
    info_data = [
        [_ar("العميل"), _ar(customer_name), _ar("التاريخ"), _ar(inv_date)],
        [_ar("طريقة الدفع"), _ar(method_map.get(invoice.payment_method.value, invoice.payment_method.value)),
         _ar("حالة الدفع"),  _ar(payment_map.get(invoice.payment_status.value, invoice.payment_status.value))],
    ]
    info_table = Table(info_data, colWidths=[3*cm, 6*cm, 3*cm, 6*cm])
    info_table.setStyle(TableStyle([
        ("FONTNAME",   (0,0), (-1,-1), "Amiri"),
        ("FONTSIZE",   (0,0), (-1,-1), 10),
        ("ALIGN",      (0,0), (-1,-1), "RIGHT"),
        ("FONTNAME",   (0,0), (0,-1),  "Amiri-Bold"),
        ("FONTNAME",   (2,0), (2,-1),  "Amiri-Bold"),
        ("BACKGROUND", (0,0), (-1,-1), LIGHT_BG),
        ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
        ("PADDING",    (0,0), (-1,-1), 7),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 0.5*cm))

    # ── جدول البنود ──────────────────────────────────────────
    item_headers = [_ar(h) for h in ["#", "المنتج", "الوحدة", "الكمية", "السعر", "الإجمالي"]]
    item_rows = [item_headers]

    for i, item in enumerate(invoice.items, 1):
        product = db.query(Product).filter(Product.id == item.product_id).first()
        pname   = (product.name if product else "—")
        unit_ar = "قطعة" if item.unit_type == "piece" else "كرتونة"
        item_rows.append([
            str(i),
            _ar(pname),
            _ar(unit_ar),
            f"{item.quantity:g}",
            f"{item.unit_price:.2f}",
            f"{item.total:.2f}",
        ])

    col_w = [1*cm, 6*cm, 2.5*cm, 2*cm, 2.5*cm, 3*cm]
    items_table = Table(item_rows, colWidths=col_w)
    items_table.setStyle(TableStyle([
        ("FONTNAME",       (0,0), (-1,-1), "Amiri"),
        ("FONTSIZE",       (0,0), (-1,-1), 10),
        ("ALIGN",          (0,0), (-1,-1), "CENTER"),
        ("ALIGN",          (1,1), (1,-1),  "RIGHT"),
        ("BACKGROUND",     (0,0), (-1,0),  PRIMARY),
        ("TEXTCOLOR",      (0,0), (-1,0),  WHITE),
        ("FONTNAME",       (0,0), (-1,0),  "Amiri-Bold"),
        ("FONTSIZE",       (0,0), (-1,0),  11),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, LIGHT_BG]),
        ("GRID",           (0,0), (-1,-1), 0.5, BORDER),
        ("PADDING",        (0,0), (-1,-1), 6),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 0.5*cm))

    # ── ملخص الفاتورة ──────────────────────────────────────
    totals_data = [
        [_ar("المجموع الفرعي"), f"{invoice.subtotal:.2f} ₪"],
        [_ar("الخصم"),          f"{invoice.discount_amount + invoice.subtotal * invoice.discount_percent / 100:.2f} ₪"],
        [_ar("الضريبة"),        f"{invoice.tax_amount:.2f} ₪"],
        [_ar("الإجمالي"),       f"{invoice.total:.2f} ₪"],
        [_ar("المدفوع"),        f"{invoice.paid_amount:.2f} ₪"],
        [_ar("المتبقي"),        f"{invoice.remaining_amount:.2f} ₪"],
    ]
    totals_table = Table(totals_data, colWidths=[5*cm, 3.5*cm], hAlign="RIGHT")
    totals_table.setStyle(TableStyle([
        ("FONTNAME",   (0,0), (-1,-1), "Amiri"),
        ("FONTSIZE",   (0,0), (-1,-1), 10),
        ("ALIGN",      (0,0), (0,-1),  "RIGHT"),
        ("ALIGN",      (1,0), (1,-1),  "LEFT"),
        ("GRID",       (0,0), (-1,-1), 0.5, BORDER),
        ("BACKGROUND", (0,3), (-1,3),  PRIMARY),
        ("TEXTCOLOR",  (0,3), (-1,3),  WHITE),
        ("FONTNAME",   (0,3), (-1,3),  "Amiri-Bold"),
        ("FONTSIZE",   (0,3), (-1,3),  13),
        ("BACKGROUND", (0,5), (-1,5),  RED_BG),
        ("TEXTCOLOR",  (0,5), (-1,5),  RED_TEXT),
        ("PADDING",    (0,0), (-1,-1), 7),
    ]))
    elements.append(totals_table)

    if invoice.notes:
        elements.append(Spacer(1, 0.4*cm))
        elements.append(Paragraph(_ar(f"ملاحظات: {invoice.notes}"), normal_style))

    elements.append(Spacer(1, 1*cm))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=GRAY))
    elements.append(Paragraph(_ar("شكراً لتعاملكم معنا 🙏"), small_style))

    doc.build(elements)
    buf.seek(0)
    return buf.read()


# ══════════════════════════════════════════════════════════
#  تقرير المبيعات PDF
# ══════════════════════════════════════════════════════════

def generate_sales_pdf(
    db: Session,
    store_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    shop_name: str = "مكسب",
) -> bytes:
    from app.models.invoice import Invoice, InvoiceType, InvoiceStatus
    from sqlalchemy import func

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )

    title_style  = _style("t",      bold=True, fontSize=17, alignment=TA_CENTER, spaceAfter=4, textColor=PRIMARY)
    sub_style    = _style("s",                 fontSize=10, alignment=TA_CENTER, textColor=GRAY, spaceAfter=8)
    footer_style = _style("footer",            fontSize=9,  alignment=TA_CENTER, textColor=PRIMARY)

    q = db.query(Invoice).filter(
        Invoice.store_id    == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
    )
    if date_from:
        q = q.filter(func.date(Invoice.created_at) >= date_from)
    if date_to:
        q = q.filter(func.date(Invoice.created_at) <= date_to)
    invoices = q.order_by(Invoice.created_at.desc()).all()

    elements = []
    elements.append(Paragraph(_ar(f"تقرير المبيعات — {shop_name}"), title_style))
    period = f"{date_from or 'من البداية'}  ←  {date_to or 'حتى اليوم'}"
    elements.append(Paragraph(_ar(period), sub_style))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY))
    elements.append(Spacer(1, 0.4*cm))

    status_map = {"paid": "مدفوعة ✅", "partial": "جزئي", "unpaid": "آجل"}
    headers = [_ar(h) for h in ["رقم الفاتورة", "التاريخ", "العميل", "الإجمالي", "المدفوع", "المتبقي", "الحالة"]]
    rows = [headers]

    total_sales = total_paid = total_remaining = 0.0
    for inv in invoices:
        cust      = inv.customer.name if inv.customer else "نقدي"
        status_ar = status_map.get(inv.payment_status.value, inv.payment_status.value)
        rows.append([
            inv.invoice_number,
            inv.created_at.strftime("%Y-%m-%d"),
            _ar(cust),
            f"{inv.total:.2f}",
            f"{inv.paid_amount:.2f}",
            f"{inv.remaining_amount:.2f}",
            _ar(status_ar),
        ])
        total_sales     += inv.total
        total_paid      += inv.paid_amount
        total_remaining += inv.remaining_amount

    # صف الإجماليات
    rows.append([
        _ar("الإجمالي"), "", "",
        f"{total_sales:.2f}",
        f"{total_paid:.2f}",
        f"{total_remaining:.2f}", "",
    ])

    col_w = [3.5*cm, 2.5*cm, 3.5*cm, 2.5*cm, 2.5*cm, 2.5*cm, 2*cm]
    t = Table(rows, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME",       (0,0), (-1,-1), "Amiri"),
        ("FONTSIZE",       (0,0), (-1,-1), 9),
        ("ALIGN",          (0,0), (-1,-1), "CENTER"),
        ("BACKGROUND",     (0,0), (-1,0),  PRIMARY),
        ("TEXTCOLOR",      (0,0), (-1,0),  WHITE),
        ("FONTNAME",       (0,0), (-1,0),  "Amiri-Bold"),
        ("FONTSIZE",       (0,0), (-1,0),  10),
        ("ROWBACKGROUNDS", (0,1), (-1,-2), [WHITE, LIGHT_BG]),
        ("BACKGROUND",     (0,-1),(-1,-1), GREEN_BG),
        ("FONTNAME",       (0,-1),(-1,-1), "Amiri-Bold"),
        ("GRID",           (0,0), (-1,-1), 0.5, BORDER),
        ("PADDING",        (0,0), (-1,-1), 5),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.5*cm))
    elements.append(Paragraph(
        _ar(f"عدد الفواتير: {len(invoices)}  |  إجمالي المبيعات: {total_sales:.2f} ₪  |  المقبوض: {total_paid:.2f} ₪"),
        footer_style,
    ))

    doc.build(elements)
    buf.seek(0)
    return buf.read()