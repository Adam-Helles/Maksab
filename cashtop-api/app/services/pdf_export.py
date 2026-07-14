"""
خدمة تصدير PDF باستخدام ReportLab
يدعم النص العربي عبر bidi + reshape

⚠️ إصلاح أمني: generate_invoice_pdf كانت تجيب أي فاتورة بمجرد رقم id
بدون فحص إنها تخص محل المستخدم — يعني أي مستخدم يقدر يبدّل رقم
invoice_id بالرابط ويشوف فاتورة تاجر تاني بكل تفاصيلها المالية.
generate_sales_pdf كانت بترجع تقرير مبيعات لكل التجار مع بعض.
صار store_id إجباري بالاثنتين.
"""
import io
from datetime import date, datetime
from typing import Optional
from sqlalchemy.orm import Session

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

import os

def _register_arabic_font():
    font_paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in font_paths:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("Arabic", path))
                return "Arabic"
            except Exception:
                continue
    return "Helvetica"

FONT_NAME = _register_arabic_font()


def _ar(text: str) -> str:
    if not text:
        return ""
    try:
        from bidi.algorithm import get_display
        import arabic_reshaper
        reshaped = arabic_reshaper.reshape(str(text))
        return get_display(reshaped)
    except ImportError:
        return str(text)


def _style(name, **kwargs):
    base = ParagraphStyle(name, fontName=FONT_NAME, **kwargs)
    return base


# ══════════════════════════════════════════════════════════
#  فاتورة PDF (للمشاركة مع العميل)
# ══════════════════════════════════════════════════════════

def generate_invoice_pdf(db: Session, invoice_id: int, store_id: int, shop_name: str = "CashTop") -> bytes:
    from app.models.invoice import Invoice
    from app.models.product import Product
    from app.models.customer import Customer

    # ⚠️ فلترة store_id إجبارية
    invoice = db.query(Invoice).filter(
        Invoice.id == invoice_id, Invoice.store_id == store_id,
    ).first()
    if not invoice:
        raise ValueError("الفاتورة غير موجودة")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm,
    )

    title_style   = _style("title",   fontSize=18, alignment=TA_CENTER, spaceAfter=6)
    header_style  = _style("header",  fontSize=12, alignment=TA_CENTER, spaceAfter=4)
    normal_style  = _style("normal",  fontSize=10, alignment=TA_RIGHT,  spaceAfter=2)
    small_style   = _style("small",   fontSize=8,  alignment=TA_CENTER, textColor=colors.grey)

    customer_name = invoice.customer.name if invoice.customer else "نقدي"
    inv_date      = (invoice.invoice_date or invoice.created_at.date()).strftime("%Y-%m-%d")

    elements = []

    elements.append(Paragraph(_ar(shop_name), title_style))
    elements.append(Paragraph(_ar(f"فاتورة بيع  —  {invoice.invoice_number}"), header_style))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1E3A5F")))
    elements.append(Spacer(1, 0.3*cm))

    info_data = [
        [_ar("التاريخ"), _ar(inv_date),  _ar("العميل"), _ar(customer_name)],
        [_ar("طريقة الدفع"), _ar(invoice.payment_method.value),
         _ar("حالة الدفع"), _ar({"paid":"مدفوعة","partial":"جزئي","unpaid":"آجل"}.get(invoice.payment_status.value, ""))],
    ]
    info_table = Table(info_data, colWidths=[3*cm, 6*cm, 3*cm, 6*cm])
    info_table.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,-1), FONT_NAME),
        ("FONTSIZE", (0,0), (-1,-1), 10),
        ("ALIGN",    (0,0), (-1,-1), "RIGHT"),
        ("GRID",     (0,0), (-1,-1), 0.5, colors.HexColor("#CCCCCC")),
        ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#F8FAFC")),
        ("PADDING",  (0,0), (-1,-1), 6),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 0.4*cm))

    item_headers = [_ar(h) for h in ["#", "المنتج", "الوحدة", "الكمية", "السعر", "الخصم", "الإجمالي"]]
    item_rows = [item_headers]

    for i, item in enumerate(invoice.items, 1):
        product = db.query(Product).filter(Product.id == item.product_id).first()
        pname   = product.name if product else "—"
        unit_ar = "قطعة" if item.unit_type == "piece" else "كرتونة"
        item_rows.append([
            str(i),
            _ar(pname),
            _ar(unit_ar),
            str(item.quantity),
            f"{item.unit_price:.2f}",
            f"{item.discount_amount:.2f}",
            f"{item.total:.2f}",
        ])

    col_w = [1*cm, 5.5*cm, 2*cm, 2*cm, 2.5*cm, 2*cm, 2.5*cm]
    items_table = Table(item_rows, colWidths=col_w)
    items_table.setStyle(TableStyle([
        ("FONTNAME",    (0,0), (-1,-1), FONT_NAME),
        ("FONTSIZE",    (0,0), (-1,-1), 9),
        ("ALIGN",       (0,0), (-1,-1), "CENTER"),
        ("ALIGN",       (1,1), (1,-1), "RIGHT"),
        ("BACKGROUND",  (0,0), (-1,0),  colors.HexColor("#1E3A5F")),
        ("TEXTCOLOR",   (0,0), (-1,0),  colors.white),
        ("FONTSIZE",    (0,0), (-1,0),  10),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#F0F4F8")]),
        ("GRID",        (0,0), (-1,-1), 0.5, colors.HexColor("#CCCCCC")),
        ("PADDING",     (0,0), (-1,-1), 5),
    ]))
    elements.append(items_table)
    elements.append(Spacer(1, 0.5*cm))

    totals_data = [
        [_ar("المجموع الفرعي"),  f"{invoice.subtotal:.2f}"],
        [_ar("الخصم"),           f"{invoice.discount_amount + invoice.subtotal * invoice.discount_percent / 100:.2f}"],
        [_ar("الضريبة"),         f"{invoice.tax_amount:.2f}"],
        [_ar("الإجمالي"),        f"{invoice.total:.2f}"],
        [_ar("المدفوع"),         f"{invoice.paid_amount:.2f}"],
        [_ar("المتبقي"),         f"{invoice.remaining_amount:.2f}"],
    ]
    totals_table = Table(totals_data, colWidths=[5*cm, 3*cm], hAlign="RIGHT")
    totals_table.setStyle(TableStyle([
        ("FONTNAME",   (0,0), (-1,-1), FONT_NAME),
        ("FONTSIZE",   (0,0), (-1,-1), 10),
        ("ALIGN",      (0,0), (-1,-1), "RIGHT"),
        ("GRID",       (0,0), (-1,-1), 0.5, colors.HexColor("#CCCCCC")),
        ("BACKGROUND", (0,3), (-1,3),  colors.HexColor("#1E3A5F")),
        ("TEXTCOLOR",  (0,3), (-1,3),  colors.white),
        ("FONTSIZE",   (0,3), (-1,3),  12),
        ("BACKGROUND", (0,5), (-1,5),  colors.HexColor("#FFEBEE")),
        ("TEXTCOLOR",  (0,5), (-1,5),  colors.HexColor("#C62828")),
        ("PADDING",    (0,0), (-1,-1), 6),
    ]))
    elements.append(totals_table)

    if invoice.notes:
        elements.append(Spacer(1, 0.4*cm))
        elements.append(Paragraph(_ar(f"ملاحظات: {invoice.notes}"), normal_style))

    elements.append(Spacer(1, 0.8*cm))
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    elements.append(Paragraph(_ar("شكراً لتعاملكم معنا"), small_style))

    doc.build(elements)
    buf.seek(0)
    return buf.read()


# ══════════════════════════════════════════════════════════
#  تقرير المبيعات PDF
# ══════════════════════════════════════════════════════════

def generate_sales_pdf(
    db: Session,
    store_id: int,               # ⚠️ جديد — إجباري
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    shop_name: str = "CashTop",
) -> bytes:
    from app.models.invoice import Invoice, InvoiceType, InvoiceStatus
    from sqlalchemy import func

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
        rightMargin=1.5*cm, leftMargin=1.5*cm,
        topMargin=1.5*cm, bottomMargin=1.5*cm)

    title_style  = _style("t", fontSize=16, alignment=TA_CENTER, spaceAfter=4)
    sub_style    = _style("s", fontSize=10, alignment=TA_CENTER,
                          textColor=colors.grey, spaceAfter=8)

    q = db.query(Invoice).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status == InvoiceStatus.COMPLETED,
    )
    if date_from:
        q = q.filter(func.date(Invoice.created_at) >= date_from)
    if date_to:
        q = q.filter(func.date(Invoice.created_at) <= date_to)
    invoices = q.order_by(Invoice.created_at.desc()).all()

    elements = []
    elements.append(Paragraph(_ar(f"تقرير المبيعات — {shop_name}"), title_style))

    period = f"{date_from or 'البداية'}  →  {date_to or 'اليوم'}"
    elements.append(Paragraph(_ar(period), sub_style))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#1E3A5F")))
    elements.append(Spacer(1, 0.3*cm))

    headers = [_ar(h) for h in ["رقم الفاتورة", "التاريخ", "العميل", "الإجمالي", "المدفوع", "المتبقي", "الحالة"]]
    rows = [headers]

    total_sales = total_paid = total_remaining = 0.0
    for inv in invoices:
        cust      = inv.customer.name if inv.customer else _ar("نقدي")
        status_ar = {"paid": _ar("مدفوعة"), "partial": _ar("جزئي"), "unpaid": _ar("آجل")}.get(
            inv.payment_status.value, inv.payment_status.value)
        rows.append([
            inv.invoice_number,
            inv.created_at.strftime("%Y-%m-%d"),
            _ar(cust),
            f"{inv.total:.2f}",
            f"{inv.paid_amount:.2f}",
            f"{inv.remaining_amount:.2f}",
            status_ar,
        ])
        total_sales     += inv.total
        total_paid      += inv.paid_amount
        total_remaining += inv.remaining_amount

    rows.append([
        _ar("الإجمالي"), "", "",
        f"{total_sales:.2f}",
        f"{total_paid:.2f}",
        f"{total_remaining:.2f}", "",
    ])

    col_w = [3.5*cm, 2.5*cm, 3.5*cm, 2.5*cm, 2.5*cm, 2.5*cm, 2*cm]
    t = Table(rows, colWidths=col_w, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME",  (0,0), (-1,-1), FONT_NAME),
        ("FONTSIZE",  (0,0), (-1,-1), 8),
        ("ALIGN",     (0,0), (-1,-1), "CENTER"),
        ("BACKGROUND",(0,0), (-1,0),  colors.HexColor("#1E3A5F")),
        ("TEXTCOLOR", (0,0), (-1,0),  colors.white),
        ("ROWBACKGROUNDS", (0,1), (-1,-2), [colors.white, colors.HexColor("#F0F4F8")]),
        ("BACKGROUND",(0,-1),(-1,-1), colors.HexColor("#E8F5E9")),
        ("FONTSIZE",  (0,-1),(-1,-1), 9),
        ("FONTNAME",  (0,-1),(-1,-1), FONT_NAME),
        ("GRID",      (0,0), (-1,-1), 0.5, colors.HexColor("#CCCCCC")),
        ("PADDING",   (0,0), (-1,-1), 4),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.5*cm))
    elements.append(Paragraph(
        _ar(f"عدد الفواتير: {len(invoices)}  |  إجمالي المبيعات: {total_sales:.2f}  |  المقبوض: {total_paid:.2f}"),
        _style("footer", fontSize=9, alignment=TA_CENTER, textColor=colors.HexColor("#1E3A5F"))
    ))

    doc.build(elements)
    buf.seek(0)
    return buf.read()