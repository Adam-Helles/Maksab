from typing import Optional
from datetime import date
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import io

from app.database import get_db
from app.models.user import User
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id
from app.services.excel_export import generate_excel_report
from app.services.pdf_export import generate_invoice_pdf, generate_sales_pdf

router = APIRouter(prefix="/reports", tags=["📊 التقارير والتصدير"])


# ══════════════════════════════════════════════════════════
#  Excel
# ══════════════════════════════════════════════════════════

@router.get("/excel", summary="تصدير Excel شامل")
def export_excel(
    report_type: str = Query("full", pattern="^(full|sales|inventory|debts)$",
                            description="full | sales | inventory | debts"),
    date_from: Optional[date] = Query(None, description="من تاريخ YYYY-MM-DD"),
    date_to:   Optional[date] = Query(None, description="إلى تاريخ YYYY-MM-DD"),
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    xlsx_bytes = generate_excel_report(db, store_id, report_type, date_from, date_to)

    today = date.today().strftime("%Y%m%d")
    filename = f"cashtop_{report_type}_{today}.xlsx"

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/excel/sales", summary="تصدير مبيعات Excel")
def export_sales_excel(
    date_from: Optional[date] = None,
    date_to:   Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    xlsx_bytes = generate_excel_report(db, store_id, "sales", date_from, date_to)
    today = date.today().strftime("%Y%m%d")
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="sales_{today}.xlsx"'},
    )


@router.get("/excel/inventory", summary="تصدير مخزون Excel")
def export_inventory_excel(
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    xlsx_bytes = generate_excel_report(db, store_id, "inventory")
    today = date.today().strftime("%Y%m%d")
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="inventory_{today}.xlsx"'},
    )


@router.get("/excel/debts", summary="تصدير الديون Excel")
def export_debts_excel(
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    xlsx_bytes = generate_excel_report(db, store_id, "debts")
    today = date.today().strftime("%Y%m%d")
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="debts_{today}.xlsx"'},
    )


# ══════════════════════════════════════════════════════════
#  PDF
# ══════════════════════════════════════════════════════════

@router.get("/pdf/invoice/{invoice_id}", summary="تصدير فاتورة PDF")
def export_invoice_pdf(
    invoice_id: int,
    shop_name: str = Query("CashTop", description="اسم المحل"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    يولّد فاتورة PDF جاهزة للطباعة أو الإرسال.
    ⚠️ store_id بيتحقق منه داخل generate_invoice_pdf نفسها — وإلا
    مستخدم يبدّل invoice_id بالرابط ويصدّر فاتورة تاجر تاني.
    """
    try:
        pdf_bytes = generate_invoice_pdf(db, invoice_id, store_id, shop_name)
    except ValueError as e:
        raise HTTPException(404, str(e))

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="invoice_{invoice_id}.pdf"'},
    )


@router.get("/pdf/sales", summary="تقرير مبيعات PDF")
def export_sales_pdf(
    date_from:  Optional[date] = None,
    date_to:    Optional[date] = None,
    shop_name:  str = Query("CashTop", description="اسم المحل"),
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    pdf_bytes = generate_sales_pdf(db, store_id, date_from, date_to, shop_name)
    today = date.today().strftime("%Y%m%d")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="sales_report_{today}.pdf"'},
    )