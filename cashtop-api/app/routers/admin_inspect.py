# app/routers/admin_inspect.py
#
# ⚠️ READ-ONLY endpoint — returns DB row counts only.
# No business data, no passwords, no tokens, no sensitive fields.
# Protected by existing `require_admin` dependency (Admin role + valid JWT required).
# Counts are scoped to the authenticated admin's store ONLY (tenant isolation).

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.core.auth import require_admin
from app.models.user import User, UserRole
from app.models.customer import Customer
from app.models.supplier import Supplier
from app.models.product import Product
from app.models.invoice import Invoice, InvoiceItem, Payment
from app.models.debt_payment import DebtPayment
from app.models.store import Store

router = APIRouter(prefix="/admin", tags=["Admin"])


class DBCountsResponse(BaseModel):
    """Read-only counts — no business data exposed."""
    stores_count: int
    users_count: int
    customers_count: int
    suppliers_count: int
    products_count: int
    invoices_count: int
    invoice_items_count: int
    debt_payments_count: int
    # Totals across ALL stores (for super-admin awareness)
    total_stores_global: int
    total_users_global: int
    note: str


@router.get("/db-counts", response_model=DBCountsResponse, summary="Read-only DB row counts")
def get_db_counts(
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Returns row counts scoped to the authenticated admin's store.
    Also returns global store/user totals so the super-admin can
    confirm whether any data exists beyond the seeded defaults.

    SAFETY CONTRACT:
    - Zero writes, deletes, or schema changes.
    - Zero sensitive fields returned.
    - Counts are store-scoped (tenant-safe) except for global totals.
    """
    sid = current_admin.store_id

    # Per-store counts (tenant-scoped)
    customers_count  = db.query(Customer).filter(Customer.store_id == sid).count()
    suppliers_count  = db.query(Customer).filter(Customer.store_id == sid).count()

    # Suppliers uses its own model
    from app.models.supplier import Supplier as SupplierModel
    suppliers_count  = db.query(SupplierModel).filter(SupplierModel.store_id == sid).count()

    products_count   = db.query(Product).filter(Product.store_id == sid).count()
    invoices_count   = db.query(Invoice).filter(Invoice.store_id == sid).count()
    invoice_items_count = db.query(InvoiceItem).filter(InvoiceItem.store_id == sid).count()
    debt_payments_count = db.query(DebtPayment).filter(DebtPayment.store_id == sid).count()
    users_count      = db.query(User).filter(User.store_id == sid).count()
    stores_count     = db.query(Store).filter(Store.id == sid).count()  # always 1 for this store

    # Global totals (to detect data in OTHER stores)
    total_stores_global = db.query(Store).count()
    total_users_global  = db.query(User).count()

    # Determine if DB looks empty
    total_records = (
        customers_count + suppliers_count + products_count +
        invoices_count + invoice_items_count + debt_payments_count
    )
    if total_records == 0 and total_stores_global <= 1:
        note = "DATABASE APPEARS EMPTY — safe to run rebuild_db.py"
    else:
        note = f"DATABASE CONTAINS DATA — {total_records} business records in this store; {total_stores_global} store(s) total. DO NOT rebuild."

    return DBCountsResponse(
        stores_count=stores_count,
        users_count=users_count,
        customers_count=customers_count,
        suppliers_count=suppliers_count,
        products_count=products_count,
        invoices_count=invoices_count,
        invoice_items_count=invoice_items_count,
        debt_payments_count=debt_payments_count,
        total_stores_global=total_stores_global,
        total_users_global=total_users_global,
        note=note,
    )
