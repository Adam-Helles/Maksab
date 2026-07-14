from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract

from app.database import get_db
from app.models.user import User
from app.models.invoice import Invoice, InvoiceItem, InvoiceType, InvoiceStatus, PaymentStatus
from app.models.product import Product
from app.models.customer import Customer
from app.models.supplier import Supplier
from app.models.stock_movement import StockMovement, MovementType
from app.core.auth import get_current_user, get_current_store_id

router = APIRouter(prefix="/dashboard", tags=["📊 لوحة الإحصائيات"])


# ══════════════════════════════════════════════════════════
#  الملخص الرئيسي (بطاقات الـ Dashboard)
# ══════════════════════════════════════════════════════════

@router.get("/summary", summary="ملخص اليوم — بطاقات الـ Dashboard")
def dashboard_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    today      = date.today()
    yesterday  = today - timedelta(days=1)
    month_start = today.replace(day=1)

    def sales_stats(from_date, to_date=None):
        q = db.query(Invoice).filter(
            Invoice.store_id == store_id,
            Invoice.invoice_type == InvoiceType.SALE,
            Invoice.status       == InvoiceStatus.COMPLETED,
            func.date(Invoice.created_at) >= from_date,
        )
        if to_date:
            q = q.filter(func.date(Invoice.created_at) <= to_date)
        invs = q.all()
        revenue = sum(i.total for i in invs)
        collected = sum(i.paid_amount for i in invs)
        cost = sum(item.cost_price * item.quantity
                   for inv in invs for item in inv.items)
        profit = revenue - cost
        return {
            "count": len(invs),
            "revenue": round(revenue, 2),
            "collected": round(collected, 2),
            "profit": round(profit, 2),
            "margin": round((profit / revenue * 100) if revenue > 0 else 0, 2),
        }

    today_stats     = sales_stats(today)
    yesterday_stats = sales_stats(yesterday, yesterday)
    month_stats     = sales_stats(month_start)

    def pct_change(today_val, yest_val):
        if yest_val == 0:
            return 100.0 if today_val > 0 else 0.0
        return round((today_val - yest_val) / yest_val * 100, 1)

    total_products  = db.query(Product).filter(
        Product.store_id == store_id, Product.is_active == True, Product.is_deleted == False,
    ).count()
    low_stock_count = db.query(Product).filter(
        Product.store_id == store_id,
        Product.stock_quantity <= Product.min_stock_alert,
        Product.is_active == True, Product.is_deleted == False,
    ).count()
    out_of_stock    = db.query(Product).filter(
        Product.store_id == store_id,
        Product.stock_quantity == 0,
        Product.is_active == True, Product.is_deleted == False,
    ).count()

    total_customers = db.query(Customer).filter(
        Customer.store_id == store_id, Customer.is_deleted == False,
    ).count()
    customers_debt  = db.query(func.sum(Customer.current_debt)).filter(
        Customer.store_id == store_id, Customer.current_debt > 0, Customer.is_deleted == False,
    ).scalar() or 0

    suppliers_debt  = db.query(func.sum(Supplier.balance)).filter(
        Supplier.store_id == store_id, Supplier.balance > 0, Supplier.is_deleted == False,
    ).scalar() or 0

    from app.models.invoice import InvoiceStatus as IS
    drafts_count = db.query(Invoice).filter(
        Invoice.store_id == store_id, Invoice.status == IS.DRAFT,
    ).count()
    unpaid_count = db.query(Invoice).filter(
        Invoice.store_id == store_id,
        Invoice.payment_status == PaymentStatus.UNPAID,
        Invoice.status == IS.COMPLETED,
    ).count()

    return {
        "today": {
            **today_stats,
            "revenue_change_pct": pct_change(today_stats["revenue"],   yesterday_stats["revenue"]),
            "profit_change_pct":  pct_change(today_stats["profit"],    yesterday_stats["profit"]),
            "orders_change_pct":  pct_change(today_stats["count"],     yesterday_stats["count"]),
        },
        "month": month_stats,
        "inventory": {
            "total_products":  total_products,
            "low_stock_count": low_stock_count,
            "out_of_stock":    out_of_stock,
            "stock_value":     round(
                db.query(func.sum(Product.stock_quantity * Product.cost_price))
                .filter(Product.store_id == store_id, Product.is_active == True, Product.is_deleted == False)
                .scalar() or 0, 2
            ),
        },
        "finance": {
            "total_customers":  total_customers,
            "customers_debt":   round(customers_debt, 2),
            "suppliers_debt":   round(suppliers_debt, 2),
            "net_receivable":   round(customers_debt - suppliers_debt, 2),
        },
        "alerts": {
            "drafts":    drafts_count,
            "unpaid":    unpaid_count,
            "low_stock": low_stock_count,
            "out_stock": out_of_stock,
        },
    }


# ══════════════════════════════════════════════════════════
#  بيانات الرسم البياني — مبيعات آخر N يوم
# ══════════════════════════════════════════════════════════

@router.get("/chart/sales-daily", summary="رسم بياني — مبيعات يومية")
def chart_sales_daily(
    days: int = Query(30, ge=7, le=365, description="عدد الأيام"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """بيانات مبيعات وأرباح يومية لرسم Line/Bar Chart"""
    start = date.today() - timedelta(days=days - 1)

    rows = db.query(
        func.date(Invoice.created_at).label("day"),
        func.sum(Invoice.total).label("revenue"),
        func.sum(Invoice.paid_amount).label("collected"),
        func.count(Invoice.id).label("count"),
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).group_by(func.date(Invoice.created_at)).all()

    profit_by_day = {}
    inv_by_day = db.query(Invoice).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).all()
    for inv in inv_by_day:
        d = str(inv.created_at.date())
        profit_by_day.setdefault(d, 0)
        for item in inv.items:
            profit_by_day[d] += item.total - (item.cost_price * item.quantity)

    sales_map = {str(r.day): r for r in rows}

    labels, revenue, profit, collected, count = [], [], [], [], []
    for i in range(days):
        d = str(start + timedelta(days=i))
        labels.append(d)
        r = sales_map.get(d)
        revenue.append(round(r.revenue or 0, 2) if r else 0)
        collected.append(round(r.collected or 0, 2) if r else 0)
        count.append(r.count if r else 0)
        profit.append(round(profit_by_day.get(d, 0), 2))

    return {
        "labels":    labels,
        "revenue":   revenue,
        "profit":    profit,
        "collected": collected,
        "orders":    count,
    }


# ══════════════════════════════════════════════════════════
#  رسم بياني — مبيعات شهرية
# ══════════════════════════════════════════════════════════

@router.get("/chart/sales-monthly", summary="رسم بياني — مبيعات شهرية")
def chart_sales_monthly(
    months: int = Query(12, ge=3, le=24),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    today = date.today()
    start = (today.replace(day=1) - timedelta(days=months * 30)).replace(day=1)

    rows = db.query(
        extract("year",  Invoice.created_at).label("year"),
        extract("month", Invoice.created_at).label("month"),
        func.sum(Invoice.total).label("revenue"),
        func.count(Invoice.id).label("count"),
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).group_by("year", "month").order_by("year", "month").all()

    month_names = ["يناير","فبراير","مارس","أبريل","مايو","يونيو",
                   "يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]

    return {
        "labels":  [f"{month_names[int(r.month)-1]} {int(r.year)}" for r in rows],
        "revenue": [round(r.revenue or 0, 2) for r in rows],
        "orders":  [r.count for r in rows],
    }


# ══════════════════════════════════════════════════════════
#  أعلى المنتجات مبيعاً
# ══════════════════════════════════════════════════════════

@router.get("/chart/top-products", summary="أعلى المنتجات مبيعاً")
def chart_top_products(
    limit: int = Query(10, ge=5, le=20),
    days:  int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    start = date.today() - timedelta(days=days)

    rows = db.query(
        Product.name,
        func.sum(InvoiceItem.quantity).label("qty_sold"),
        func.sum(InvoiceItem.total).label("revenue"),
    ).join(InvoiceItem, InvoiceItem.product_id == Product.id
    ).join(Invoice, Invoice.id == InvoiceItem.invoice_id
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).group_by(Product.id, Product.name
    ).order_by(func.sum(InvoiceItem.total).desc()
    ).limit(limit).all()

    return {
        "labels":   [r.name for r in rows],
        "qty_sold": [round(r.qty_sold or 0, 1) for r in rows],
        "revenue":  [round(r.revenue or 0, 2) for r in rows],
    }


# ══════════════════════════════════════════════════════════
#  مبيعات حسب الصنف (Pie Chart)
# ══════════════════════════════════════════════════════════

@router.get("/chart/sales-by-category", summary="مبيعات حسب الصنف")
def chart_sales_by_category(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    from app.models.category import Category

    start = date.today() - timedelta(days=days)

    rows = db.query(
        Category.name,
        func.sum(InvoiceItem.total).label("revenue"),
    ).join(Product, Product.category_id == Category.id
    ).join(InvoiceItem, InvoiceItem.product_id == Product.id
    ).join(Invoice, Invoice.id == InvoiceItem.invoice_id
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).group_by(Category.id, Category.name
    ).order_by(func.sum(InvoiceItem.total).desc()).all()

    no_cat = db.query(func.sum(InvoiceItem.total)).join(
        Invoice, Invoice.id == InvoiceItem.invoice_id
    ).join(Product, Product.id == InvoiceItem.product_id
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
        Product.category_id.is_(None),
    ).scalar() or 0

    labels  = [r.name for r in rows]
    revenue = [round(r.revenue or 0, 2) for r in rows]
    if no_cat > 0:
        labels.append("غير مصنّف")
        revenue.append(round(no_cat, 2))

    return {"labels": labels, "revenue": revenue}


# ══════════════════════════════════════════════════════════
#  ساعات الذروة (Heatmap/Bar)
# ══════════════════════════════════════════════════════════

@router.get("/chart/peak-hours", summary="ساعات الذروة")
def chart_peak_hours(
    days: int = Query(30, ge=7, le=90),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    start = date.today() - timedelta(days=days)

    rows = db.query(
        extract("hour", Invoice.created_at).label("hour"),
        func.count(Invoice.id).label("count"),
        func.sum(Invoice.total).label("revenue"),
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).group_by("hour").order_by("hour").all()

    hour_map = {int(r.hour): r for r in rows}
    labels   = [f"{h:02d}:00" for h in range(24)]
    count    = [hour_map[h].count   if h in hour_map else 0 for h in range(24)]
    revenue  = [round(hour_map[h].revenue or 0, 2) if h in hour_map else 0 for h in range(24)]

    return {"labels": labels, "orders": count, "revenue": revenue}


# ══════════════════════════════════════════════════════════
#  أعلى العملاء إنفاقاً
# ══════════════════════════════════════════════════════════

@router.get("/chart/top-customers", summary="أعلى العملاء إنفاقاً")
def chart_top_customers(
    limit: int = Query(10, ge=5, le=20),
    days:  int = Query(90, ge=1, le=365),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    start = date.today() - timedelta(days=days)

    rows = db.query(
        Customer.name,
        func.count(Invoice.id).label("orders"),
        func.sum(Invoice.total).label("total_spent"),
    ).join(Invoice, Invoice.customer_id == Customer.id
    ).filter(
        Invoice.store_id == store_id,
        Invoice.invoice_type == InvoiceType.SALE,
        Invoice.status       == InvoiceStatus.COMPLETED,
        func.date(Invoice.created_at) >= start,
    ).group_by(Customer.id, Customer.name
    ).order_by(func.sum(Invoice.total).desc()
    ).limit(limit).all()

    return {
        "labels":      [r.name for r in rows],
        "orders":      [r.orders for r in rows],
        "total_spent": [round(r.total_spent or 0, 2) for r in rows],
    }


# ══════════════════════════════════════════════════════════
#  كل بيانات الـ Dashboard دفعة واحدة
# ══════════════════════════════════════════════════════════

@router.get("/all", summary="كل بيانات الـ Dashboard (طلب واحد)")
def dashboard_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    store_id: int = Depends(get_current_store_id),
):
    """
    يجمع كل بيانات الـ Dashboard في طلب واحد لتقليل عدد الـ API calls.
    ⚠️ store_id لازم يترّرر يدوياً لكل دالة داخلية لأنها بتنستدعى هون
    مباشرة كدوال بايثون عادية (مش عبر HTTP)، فـ Depends ما بينفّذ تلقائياً.
    """
    return {
        "summary":         dashboard_summary(db=db, _=current_user, store_id=store_id),
        "chart_daily_30":  chart_sales_daily(days=30, db=db, _=current_user, store_id=store_id),
        "chart_monthly":   chart_sales_monthly(months=6, db=db, _=current_user, store_id=store_id),
        "top_products":    chart_top_products(limit=5, days=30, db=db, _=current_user, store_id=store_id),
        "top_customers":   chart_top_customers(limit=5, days=30, db=db, _=current_user, store_id=store_id),
        "by_category":     chart_sales_by_category(days=30, db=db, _=current_user, store_id=store_id),
        "peak_hours":      chart_peak_hours(days=30, db=db, _=current_user, store_id=store_id),
    }