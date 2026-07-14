"""
خدمة المخزون — المنطق المركزي لكل عمليات الدخول والخروج.
كل تغيير في المخزون يمر من هنا حتى يُسجَّل في stock_movements.
"""
from datetime import date
from typing import Optional
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.product_batch import ProductBatch
from app.models.stock_movement import StockMovement, MovementType


INBOUND_TYPES = {
    MovementType.PURCHASE,
    MovementType.RETURN_FROM_CUSTOMER,
    MovementType.ADJUSTMENT_IN,
}

OUTBOUND_TYPES = {
    MovementType.SALE,
    MovementType.RETURN_TO_SUPPLIER,
    MovementType.ADJUSTMENT_OUT,
    MovementType.DAMAGED,
    MovementType.EXPIRED,
}


def _pieces(quantity: float, unit_type: str, pieces_per_carton: int) -> float:
    if unit_type == "carton":
        return quantity * pieces_per_carton
    return quantity


def move_stock(
    db: Session,
    product_id: int,
    movement_type: MovementType,
    quantity: float,
    store_id: int,                  # ⚠️ جديد — إجباري، بلا default عشان ما ينسى حدا يمرره
    unit_type: str = "piece",
    user_id: int = 1,
    invoice_id: Optional[int] = None,
    notes: Optional[str] = None,
    reference: Optional[str] = None,
    unit_cost: float = 0.0,
    batch_id: Optional[int] = None,
) -> StockMovement:
    """
    الدالة الرئيسية — تنفّذ حركة مخزون وتسجّلها.
    ترفع ValueError إذا كان المخزون غير كافٍ أو المنتج لا ينتمي للمحل.

    ⚠️ store_id إجباري: هاي دالة مركزية بتنستدعى من invoice.py (بيانات
    موثوقة مسبقاً) ومن routers/inventory.py (بيانات جاية مباشرة من
    request — لازم فلترة هون كدفاع بالعمق، وإلا مستخدم يقدر يمرر
    product_id لمنتج تاجر تاني ويعبث بمخزونه).
    """
    product = (
        db.query(Product)
        .filter(Product.id == product_id, Product.store_id == store_id)
        .with_for_update()
        .first()
    )
    if not product:
        raise ValueError(f"المنتج {product_id} غير موجود أو لا ينتمي لمحلك")

    qty_in_pieces = _pieces(quantity, unit_type, product.pieces_per_carton)
    stock_before = product.stock_quantity

    if movement_type in INBOUND_TYPES:
        product.stock_quantity += qty_in_pieces
        if movement_type == MovementType.PURCHASE and unit_cost > 0:
            _update_average_cost(product, qty_in_pieces, unit_cost)
    elif movement_type in OUTBOUND_TYPES:
        if product.stock_quantity < qty_in_pieces:
            raise ValueError(
                f"مخزون غير كافٍ — متوفر: {product.stock_quantity} قطعة، مطلوب: {qty_in_pieces}"
            )
        product.stock_quantity -= qty_in_pieces

        if batch_id:
            _deduct_from_batch(db, batch_id, qty_in_pieces, store_id)
        elif product.batches:
            _deduct_fefo(db, product, qty_in_pieces)
    else:
        raise ValueError(f"نوع حركة غير معروف: {movement_type}")

    movement = StockMovement(
        store_id=store_id,   # ⚠️ جديد
        product_id=product_id,
        movement_type=movement_type,
        quantity=quantity,
        unit_type=unit_type,
        quantity_in_pieces=qty_in_pieces,
        stock_before=stock_before,
        stock_after=product.stock_quantity,
        unit_cost=unit_cost,
        invoice_id=invoice_id,
        user_id=user_id,
        notes=notes,
        reference=reference,
    )
    db.add(movement)
    # لا نعمل commit هنا — المستدعي مسؤول عن الـ commit
    return movement


def _update_average_cost(product: Product, qty_new: float, cost_new: float):
    old_qty = product.stock_quantity - qty_new
    old_cost = product.cost_price
    if old_qty <= 0:
        product.cost_price = cost_new
    else:
        total_cost = (old_qty * old_cost) + (qty_new * cost_new)
        product.cost_price = round(total_cost / (old_qty + qty_new), 4)


def _deduct_from_batch(db: Session, batch_id: int, qty: float, store_id: int):
    """خصم من دُفعة محددة — مفلترة بـ store_id (العمود صار موجود بـ ProductBatch)"""
    batch = db.query(ProductBatch).filter(
        ProductBatch.id == batch_id,
        ProductBatch.store_id == store_id,
    ).first()
    if not batch:
        return
    batch.quantity = max(0, batch.quantity - qty)
    if batch.quantity == 0:
        batch.is_active = False


def _deduct_fefo(db: Session, product: Product, qty: float):
    remaining = qty
    batches = (
        db.query(ProductBatch)
        .filter(
            ProductBatch.product_id == product.id,
            ProductBatch.is_active == True,
            ProductBatch.quantity > 0,
        )
        .order_by(ProductBatch.expiry_date.asc().nullslast())
        .all()
    )
    for batch in batches:
        if remaining <= 0:
            break
        deduct = min(batch.quantity, remaining)
        batch.quantity -= deduct
        remaining -= deduct
        if batch.quantity == 0:
            batch.is_active = False


def add_purchase_batch(
    db: Session,
    product_id: int,
    quantity: float,
    store_id: int,                  # ⚠️ جديد
    unit_type: str = "piece",
    cost_price: float = 0.0,
    expiry_date=None,
    batch_number: Optional[str] = None,
    supplier_id: Optional[int] = None,
    invoice_id: Optional[int] = None,
    user_id: int = 1,
    notes: Optional[str] = None,
) -> tuple[StockMovement, Optional[ProductBatch]]:
    """يضيف دُفعة شراء جديدة للمخزون."""
    product = db.query(Product).filter(
        Product.id == product_id, Product.store_id == store_id,
    ).first()
    if not product:
        raise ValueError(f"المنتج {product_id} غير موجود أو لا ينتمي لمحلك")

    qty_pieces = _pieces(quantity, unit_type, product.pieces_per_carton)

    movement = move_stock(
        db=db,
        product_id=product_id,
        movement_type=MovementType.PURCHASE,
        quantity=quantity,
        store_id=store_id,
        unit_type=unit_type,
        user_id=user_id,
        invoice_id=invoice_id,
        notes=notes,
        unit_cost=cost_price,
    )

    batch = None
    if product.has_expiry or expiry_date:
        batch = ProductBatch(
            store_id=store_id,   # ⚠️ جديد
            product_id=product_id,
            batch_number=batch_number,
            quantity=qty_pieces,
            cost_price=cost_price,
            expiry_date=expiry_date,
            supplier_id=supplier_id,
            invoice_id=invoice_id,
            notes=notes,
        )
        db.add(batch)

        if expiry_date:
            if not product.expiry_date or expiry_date < product.expiry_date:
                product.expiry_date = expiry_date
            product.has_expiry = True

    return movement, batch