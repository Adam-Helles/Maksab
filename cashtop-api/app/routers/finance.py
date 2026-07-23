from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.user import User
from app.models.customer import Customer
from app.models.supplier import Supplier
from app.models.invoice import Invoice, InvoiceType, InvoiceStatus, Payment, PaymentMethod
from app.schemas.finance import (
    FinancialSummary, CustomerDebtEntry, SupplierDebtEntry,
    DebtPaymentCreate, DebtPaymentResponse,
)
from app.core.auth import get_current_user, require_manager_or_above, get_current_store_id

router = APIRouter(prefix="/finance", tags=["💰 المالية والديون"])


# ══════════════════════════════════════════════════════════
#  الملخص المالي العام
# ══════════════════════════════════════════════════════════

@router.get("/summary", response_model=FinancialSummary, summary="الملخص المالي العام")
def financial_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from datetime import date

    # ذمم العملاء — ⚠️ بدون فلترة store_id كانت هاي بترجع مجموع ديون
    # كل التجار مع بعض بأرقام مضللة تماماً
    cust_result = db.query(
        func.sum(Customer.current_debt),
        func.count(Customer.id),
    ).filter(
        Customer.store_id == store_id,
        Customer.current_debt > 0,
        Customer.is_deleted == False,
    ).first()

    total_cust_debt    = round(cust_result[0] or 0, 2)
    customers_with_debt = cust_result[1] or 0

    # ذمم الموردين
    sup_result = db.query(
        func.sum(Supplier.balance),
        func.count(Supplier.id),
    ).filter(
        Supplier.store_id == store_id,
        Supplier.balance > 0,
        Supplier.is_deleted == False,
    ).first()

    total_sup_debt     = round(sup_result[0] or 0, 2)
    suppliers_with_debt = sup_result[1] or 0

    # مبيعات الشهر الحالي
    first_of_month = date.today().replace(day=1)
    month_invoices = db.query(Invoice).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= first_of_month,
    ).all()

    month_sales     = round(sum(i.total         for i in month_invoices), 2)
    month_collected = round(sum(i.paid_amount   for i in month_invoices), 2)

    month_profit = 0.0
    for inv in month_invoices:
        for item in inv.items:
            month_profit += item.total - (item.cost_price * item.quantity)

    return FinancialSummary(
        total_customer_debt  = total_cust_debt,
        customers_with_debt  = customers_with_debt,
        total_supplier_debt  = total_sup_debt,
        suppliers_with_debt  = suppliers_with_debt,
        net_position         = round(total_cust_debt - total_sup_debt, 2),
        month_sales          = month_sales,
        month_collected      = month_collected,
        month_profit         = round(month_profit, 2),
    )


# ══════════════════════════════════════════════════════════
#  ديون العملاء
# ══════════════════════════════════════════════════════════

@router.get("/customers/debts", summary="قائمة ديون العملاء")
def customer_debts(
    search: Optional[str] = None,
    overdue_only: bool = False,
    skip: int = 0, limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Customer).filter(
        Customer.store_id == store_id,
        Customer.current_debt > 0,
        Customer.is_deleted == False,
    )
    if search:
        q = q.filter(
            Customer.name.ilike(f"%{search}%") |
            Customer.phone.ilike(f"%{search}%")
        )
    customers = q.order_by(Customer.current_debt.desc()).offset(skip).limit(limit).all()

    result = []
    for c in customers:
        last_inv = db.query(Invoice).filter(
            Invoice.customer_id == c.id,
            Invoice.store_id == store_id,
            Invoice.invoice_type == InvoiceType.SALE,
        ).order_by(Invoice.created_at.desc()).first()

        overdue = not c.can_buy_on_credit and c.credit_limit > 0
        if overdue_only and not overdue:
            continue

        result.append({
            "customer_id"       : c.id,
            "customer_name"     : c.name,
            "phone"             : c.phone,
            "current_debt"      : c.current_debt,
            "credit_limit"      : c.credit_limit,
            "available_credit"  : round(c.available_credit, 2) if c.credit_limit > 0 else None,
            "overdue"           : overdue,
            "last_invoice_date" : last_inv.created_at if last_inv else None,
        })

    return {
        "total_count" : len(result),
        "total_debt"  : round(sum(r["current_debt"] for r in result), 2),
        "customers"   : result,
    }


@router.get("/customers/{customer_id}/statement", summary="كشف حساب عميل")
def customer_statement(
    customer_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """كشف حساب كامل للعميل — كل الفواتير والدفعات"""
    # ⚠️ فلترة store_id إجبارية — وإلا أي مستخدم يقدر يشوف كشف حساب
    # مالي كامل لعميل تاجر تاني بس بتجربة IDs متسلسلة
    customer = db.query(Customer).filter(
        Customer.id == customer_id, Customer.store_id == store_id,
    ).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود")

    invoices = db.query(Invoice).filter(
        Invoice.customer_id == customer_id,
        Invoice.store_id == store_id,
        Invoice.status == InvoiceStatus.COMPLETED,
    ).order_by(Invoice.created_at.asc()).all()

    transactions = []
    running_balance = 0.0

    for inv in invoices:
        if inv.invoice_type == InvoiceType.SALE:
            # مدين: قيمة الفاتورة كاملة
            running_balance += inv.total
            # دائن فوري: ما دُفع وقت الفاتورة
            running_balance -= inv.paid_amount
            transactions.append({
                "date"            : inv.created_at.strftime("%Y-%m-%d"),
                "type"            : "فاتورة بيع",
                "reference"       : inv.invoice_number,
                "debit"           : round(inv.total, 2),
                "credit"          : round(inv.paid_amount, 2),
                "paid_on_invoice" : round(inv.paid_amount, 2),
                "balance"         : round(running_balance, 2),
            })

        elif inv.invoice_type == InvoiceType.SALE_RETURN:
            running_balance -= inv.total
            transactions.append({
                "date"      : inv.created_at.strftime("%Y-%m-%d"),
                "type"      : "مرتجع بيع",
                "reference" : inv.invoice_number,
                "debit"     : 0,
                "credit"    : round(inv.total, 2),
                "balance"   : round(running_balance, 2),
            })

    return {
        "customer_id"   : customer_id,
        "customer_name" : customer.name,
        "phone"         : customer.phone,
        "credit_limit"  : customer.credit_limit,
        "current_debt"  : round(running_balance, 2),  # الرصيد المحسوب من الفواتير
        "stored_debt"   : customer.current_debt,       # الرصيد المخزّن في قاعدة البيانات
        "can_buy"       : customer.can_buy_on_credit,
        "transactions"  : transactions,
    }



@router.post("/customers/{customer_id}/pay", response_model=DebtPaymentResponse, summary="تسجيل دفعة من عميل")
def customer_pay_debt(
    customer_id: int,
    data: DebtPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    يسجّل دفعة من عميل خارج أي فاتورة محددة.
    ⚠️ إصلاح حرج: بدون فلترة store_id، أي مستخدم كان يقدر يبعت
    customer_id لعميل تاجر تاني ويسجّل عليه دفعة (وهمية) تنقص دينه فعلياً.
    """
    customer = db.query(Customer).filter(
        Customer.id == customer_id, Customer.store_id == store_id,
    ).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    if customer.current_debt <= 0:
        raise HTTPException(400, "ليس على العميل أي دين")

    actual = min(data.amount, customer.current_debt)
    debt_before = customer.current_debt
    customer.current_debt = round(customer.current_debt - actual, 2)

    oldest_unpaid = db.query(Invoice).filter(
        Invoice.customer_id    == customer_id,
        Invoice.store_id       == store_id,
        Invoice.invoice_type   == InvoiceType.SALE,
        Invoice.remaining_amount > 0,
        Invoice.status         == InvoiceStatus.COMPLETED,
    ).order_by(Invoice.created_at.asc()).all()

    remaining_payment = actual
    for unpaid in oldest_unpaid:
        if remaining_payment <= 0:
            break
            
        apply = min(remaining_payment, unpaid.remaining_amount)
        unpaid.paid_amount      = round(unpaid.paid_amount + apply, 2)
        unpaid.remaining_amount = round(unpaid.remaining_amount - apply, 2)
        remaining_payment       = round(remaining_payment - apply, 2)
        
        if unpaid.remaining_amount <= 0:
            from app.models.invoice import PaymentStatus
            unpaid.payment_status = PaymentStatus.PAID
            
        payment_rec = Payment(
            store_id    = store_id,
            invoice_id  = unpaid.id,
            amount      = apply,
            method      = data.method,
            received_by = current_user.id,
            notes       = data.notes or "دفعة على الحساب",
        )
        db.add(payment_rec)

    db.commit()
    return DebtPaymentResponse(
        success      = True,
        entity_type  = "customer",
        entity_id    = customer_id,
        entity_name  = customer.name,
        amount_paid  = actual,
        debt_before  = debt_before,
        debt_after   = customer.current_debt,
        method       = data.method.value,
    )


# ══════════════════════════════════════════════════════════
#  ديون الموردين
# ══════════════════════════════════════════════════════════

@router.get("/suppliers/debts", summary="قائمة ديون الموردين")
def supplier_debts(
    search: Optional[str] = None,
    skip: int = 0, limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    q = db.query(Supplier).filter(
        Supplier.store_id == store_id,
        Supplier.balance > 0,
        Supplier.is_deleted == False,
    )
    if search:
        q = q.filter(Supplier.name.ilike(f"%{search}%"))

    suppliers = q.order_by(Supplier.balance.desc()).offset(skip).limit(limit).all()

    result = []
    for s in suppliers:
        last_inv = db.query(Invoice).filter(
            Invoice.supplier_id == s.id,
            Invoice.store_id == store_id,
        ).order_by(Invoice.created_at.desc()).first()

        result.append({
            "supplier_id"       : s.id,
            "supplier_name"     : s.name,
            "company"           : s.company,
            "phone"             : s.phone,
            "balance"           : s.balance,
            "last_invoice_date" : last_inv.created_at if last_inv else None,
        })

    return {
        "total_count"  : len(result),
        "total_debt"   : round(sum(r["balance"] for r in result), 2),
        "suppliers"    : result,
    }


@router.get("/suppliers/{supplier_id}/statement", summary="كشف حساب مورد")
def supplier_statement(
    supplier_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from app.models.invoice import Invoice, InvoiceType, Payment
    supplier = db.query(Supplier).filter(
        Supplier.id == supplier_id, Supplier.store_id == store_id
    ).first()
    if not supplier:
        raise HTTPException(404, "المورد غير موجود")

    # 1) الفواتير
    invoices = db.query(Invoice).filter(
        Invoice.supplier_id == supplier_id,
        Invoice.store_id == store_id,
        Invoice.status != "cancelled"
    ).order_by(Invoice.created_at.asc()).all()

    transactions = []
    
    for inv in invoices:
        if inv.invoice_type == InvoiceType.PURCHASE:
            transactions.append({
                "date": inv.created_at.strftime("%Y-%m-%d %H:%M"),
                "timestamp": inv.created_at.timestamp(),
                "type": "فاتورة مشتريات",
                "reference": inv.invoice_number,
                "debit": round(inv.paid_amount, 2),  # مدفوع
                "credit": round(inv.total, 2),       # مستحق للمورد
            })
            for p in inv.payments:
                if p.created_at > inv.created_at:
                    transactions.append({
                        "date": p.created_at.strftime("%Y-%m-%d %H:%M"),
                        "timestamp": p.created_at.timestamp(),
                        "type": "دفعة نقدية",
                        "reference": f"سداد {inv.invoice_number}",
                        "debit": round(p.amount, 2),
                        "credit": 0.0,
                    })

        elif inv.invoice_type == InvoiceType.PURCHASE_RETURN:
            transactions.append({
                "date": inv.created_at.strftime("%Y-%m-%d %H:%M"),
                "timestamp": inv.created_at.timestamp(),
                "type": "مرتجع مشتريات",
                "reference": inv.invoice_number,
                "debit": round(inv.total, 2),
                "credit": 0.0,
            })

    transactions.sort(key=lambda x: x["timestamp"])
    
    final_balance = 0.0
    for t in transactions:
        final_balance += t["credit"] - t["debit"]
        t["balance"] = round(final_balance, 2)
        del t["timestamp"]

    return {
        "supplier_id": supplier.id,
        "supplier_name": supplier.name,
        "phone": supplier.phone,
        "company": supplier.company,
        "current_debt": round(final_balance, 2),
        "stored_debt": supplier.balance,
        "transactions": transactions,
    }


@router.post("/suppliers/{supplier_id}/pay", response_model=DebtPaymentResponse, summary="تسجيل دفعة لمورد")
def supplier_pay_debt(
    supplier_id: int,
    data: DebtPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    """يسجّل دفعة نقدنا للمورد"""
    supplier = db.query(Supplier).filter(
        Supplier.id == supplier_id, Supplier.store_id == store_id,
    ).first()
    if not supplier:
        raise HTTPException(404, "المورد غير موجود")
    if supplier.balance <= 0:
        raise HTTPException(400, "ليس للمورد أي رصيد مستحق")

    actual       = min(data.amount, supplier.balance)
    debt_before  = supplier.balance
    supplier.balance = round(supplier.balance - actual, 2)
    db.commit()

    return DebtPaymentResponse(
        success     = True,
        entity_type = "supplier",
        entity_id   = supplier_id,
        entity_name = supplier.name,
        amount_paid = actual,
        debt_before = debt_before,
        debt_after  = supplier.balance,
        method      = data.method.value,
    )


# ══════════════════════════════════════════════════════════
#  إحصائيات الأرباح
# ══════════════════════════════════════════════════════════

@router.get("/profit", summary="تقرير الأرباح")
def profit_report(
    period: str = Query("month", pattern="^(today|week|month|year|all)$"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from datetime import date, timedelta

    today = date.today()
    if period == "today":
        date_from = today
    elif period == "week":
        date_from = today - timedelta(days=7)
    elif period == "month":
        date_from = today.replace(day=1)
    elif period == "year":
        date_from = today.replace(month=1, day=1)
    else:
        date_from = None

    q = db.query(Invoice).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
    )
    if date_from:
        q = q.filter(func.date(Invoice.created_at) >= date_from)

    invoices = q.all()

    total_revenue = 0.0
    total_cost    = 0.0
    total_tax     = 0.0
    total_discount= 0.0
    items_sold    = 0

    for inv in invoices:
        total_revenue  += inv.total
        total_tax      += inv.tax_amount
        total_discount += inv.discount_amount + (inv.subtotal * inv.discount_percent / 100)
        for item in inv.items:
            total_cost += item.cost_price * item.quantity
            items_sold += 1

    gross_profit = total_revenue - total_cost
    net_profit   = gross_profit - total_tax
    margin       = round((gross_profit / total_revenue * 100) if total_revenue > 0 else 0, 2)

    return {
        "period"          : period,
        "date_from"       : str(date_from) if date_from else "all",
        "date_to"         : str(today),
        "invoices_count"  : len(invoices),
        "items_sold"      : items_sold,
        "total_revenue"   : round(total_revenue,  2),
        "total_cost"      : round(total_cost,     2),
        "total_discount"  : round(total_discount, 2),
        "total_tax"       : round(total_tax,      2),
        "gross_profit"    : round(gross_profit,   2),
        "net_profit"      : round(net_profit,     2),
        "profit_margin"   : margin,
    }


# ══════════════════════════════════════════════════════════
#  إصلاح أرصدة الديون (recalculate from invoices)
# ══════════════════════════════════════════════════════════

@router.post("/repair-debts", summary="إعادة حساب أرصدة ديون العملاء من الفواتير")
def repair_customer_debts(
    db: Session = Depends(get_db),
    _: User = Depends(require_manager_or_above),
    store_id: int = Depends(get_current_store_id),
):
    """
    يُعيد حساب current_debt لكل عميل من مجموع remaining_amount
    للفواتير المكتملة غير المسددة — يُصلح أي تباين بين القيمة المخزنة
    والفواتير الفعلية.
    """
    customers = db.query(Customer).filter(
        Customer.store_id == store_id,
        Customer.is_deleted == False,
    ).all()

    fixed = []
    for customer in customers:
        real_debt = db.query(
            func.coalesce(func.sum(Invoice.remaining_amount), 0.0)
        ).filter(
            Invoice.customer_id == customer.id,
            Invoice.store_id == store_id,
            Invoice.invoice_type == InvoiceType.SALE,
            Invoice.status == InvoiceStatus.COMPLETED,
            Invoice.remaining_amount > 0,
        ).scalar()

        real_debt = round(real_debt or 0.0, 2)
        if abs(customer.current_debt - real_debt) > 0.001:
            fixed.append({
                "customer_id": customer.id,
                "old_debt": customer.current_debt,
                "new_debt": real_debt,
            })
            customer.current_debt = real_debt

    db.commit()
    return {
        "fixed_count": len(fixed),
        "fixed": fixed,
    }