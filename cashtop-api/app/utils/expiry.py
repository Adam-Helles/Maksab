"""
خدمة تنبيهات انتهاء الصلاحية

⚠️ إصلاح: الدالتين كانتا بترجعوا تنبيهات كل المنتجات/الدُفع بكل
المحلات مع بعض. صار store_id إجباري.
"""
from datetime import date, timedelta
from typing import List
from sqlalchemy.orm import Session
from app.models.product import Product
from app.models.product_batch import ProductBatch


def get_expiry_alerts(db: Session, store_id: int, days_ahead: int = 30) -> dict:
    """
    يجيب كل المنتجات/الدُفع التي ستنتهي خلال `days_ahead` يوماً
    أو انتهت فعلاً — ضمن محل المستخدم فقط.
    """
    today = date.today()
    warn_date = today + timedelta(days=days_ahead)

    expiring_products = db.query(Product).filter(
        Product.store_id == store_id,
        Product.has_expiry == True,
        Product.expiry_date.isnot(None),
        Product.expiry_date <= warn_date,
        Product.is_active == True,
        Product.is_deleted == False,
        Product.stock_quantity > 0,
    ).order_by(Product.expiry_date).all()

    expiring_batches = db.query(ProductBatch).filter(
        ProductBatch.store_id == store_id,
        ProductBatch.expiry_date.isnot(None),
        ProductBatch.expiry_date <= warn_date,
        ProductBatch.is_active == True,
        ProductBatch.quantity > 0,
    ).order_by(ProductBatch.expiry_date).all()

    expired_products, soon_products = [], []
    for p in expiring_products:
        entry = {
            "id": p.id,
            "name": p.name,
            "barcode": p.barcode_piece,
            "expiry_date": p.expiry_date.isoformat(),
            "days_left": (p.expiry_date - today).days,
            "stock": p.stock_quantity,
            "source": "product",
        }
        if p.expiry_date < today:
            expired_products.append(entry)
        else:
            soon_products.append(entry)

    expired_batches, soon_batches = [], []
    for b in expiring_batches:
        entry = {
            "batch_id": b.id,
            "product_id": b.product_id,
            "product_name": b.product.name if b.product else "—",
            "batch_number": b.batch_number,
            "expiry_date": b.expiry_date.isoformat(),
            "days_left": (b.expiry_date - today).days,
            "quantity": b.quantity,
            "source": "batch",
        }
        if b.expiry_date < today:
            expired_batches.append(entry)
        else:
            soon_batches.append(entry)

    return {
        "check_date": today.isoformat(),
        "days_ahead": days_ahead,
        "summary": {
            "total_expired": len(expired_products) + len(expired_batches),
            "total_expiring_soon": len(soon_products) + len(soon_batches),
        },
        "expired": {
            "products": expired_products,
            "batches": expired_batches,
        },
        "expiring_soon": {
            "products": soon_products,
            "batches": soon_batches,
        },
    }


def get_low_stock_alerts(db: Session, store_id: int) -> List[dict]:
    """المنتجات التي وصلت الحد الأدنى للمخزون — ضمن محل المستخدم فقط"""
    products = db.query(Product).filter(
        Product.store_id == store_id,
        Product.stock_quantity <= Product.min_stock_alert,
        Product.is_active == True,
        Product.is_deleted == False,
    ).order_by(Product.stock_quantity).all()

    return [
        {
            "id": p.id,
            "name": p.name,
            "barcode": p.barcode_piece,
            "current_stock": p.stock_quantity,
            "min_stock_alert": p.min_stock_alert,
            "stock_in_cartons": p.stock_in_cartons,
            "supplier_id": p.supplier_id,
            "category": p.category.name if p.category else None,
            "severity": "critical" if p.stock_quantity == 0 else "warning",
        }
        for p in products
    ]