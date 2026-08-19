from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
import logging

from app.database import get_db
from app.core.auth import get_current_user, get_current_store_id
from app.models.customer import Customer
from app.models.product import Product
from app.models.invoice import Invoice, InvoiceItem, Payment, PaymentMethod
from app.models.category import Category
from app.models.supplier import Supplier
from app.models.debt_payment import DebtPayment

router = APIRouter(prefix="/sync", tags=["Sync"])
logger = logging.getLogger(__name__)

# --- Pydantic Schemas ---

class PullSyncResponse(BaseModel):
    server_time: datetime
    customers: List[Dict[str, Any]]
    products: List[Dict[str, Any]]
    invoices: List[Dict[str, Any]]
    invoice_items: List[Dict[str, Any]]
    categories: List[Dict[str, Any]]
    suppliers: List[Dict[str, Any]]
    payments: List[Dict[str, Any]] = []

class PushSyncRequest(BaseModel):
    customers: List[Dict[str, Any]] = []
    products: List[Dict[str, Any]] = []
    invoices: List[Dict[str, Any]] = []
    invoice_items: List[Dict[str, Any]] = []
    categories: List[Dict[str, Any]] = []
    suppliers: List[Dict[str, Any]] = []
    payments: List[Dict[str, Any]] = []

class PushSyncResponse(BaseModel):
    accepted: List[str]
    skipped_server_newer: List[str]
    server_time: datetime

# --- Helpers ---

def dict_to_model(db_model, data: dict, store_id: str):
    instance = db_model()
    for key, value in data.items():
        if hasattr(instance, key):
            # Parse datetime fields manually if they are strings
            if key in ["created_at", "updated_at", "deleted_at", "invoice_date", "expiry_date"]:
                if isinstance(value, str):
                    try:
                        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    except ValueError:
                        pass
            setattr(instance, key, value)
    instance.store_id = store_id
    return instance

def update_model(instance, data: dict):
    for key, value in data.items():
        # Do not override store_id, id, or balance (current_debt is allowed for direct sync)
        if key in ["id", "store_id", "balance"]:
            continue
        if hasattr(instance, key):
            if key in ["created_at", "updated_at", "deleted_at", "invoice_date", "expiry_date"]:
                if isinstance(value, str):
                    try:
                        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
                    except ValueError:
                        pass
            setattr(instance, key, value)

# --- Routes ---

@router.get("/pull", response_model=PullSyncResponse)
def pull_sync(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    store_id: str = Depends(get_current_store_id)
):
    """
    Pull all changes since the given timestamp.
    """
    # Capture server time BEFORE running queries
    sync_cursor = datetime.now(timezone.utc)

    def get_query(model):
        query = db.query(model).filter(model.store_id == store_id)
        if since:
            query = query.filter(model.server_updated_at >= since)
        return query.all()

    def serialize_model(instances, fields=None):
        results = []
        for instance in instances:
            data = {}
            for column in instance.__table__.columns:
                if fields and column.name not in fields:
                    continue
                val = getattr(instance, column.name)
                if isinstance(val, datetime):
                    data[column.name] = val.isoformat()
                elif isinstance(val, enum.Enum):
                    data[column.name] = val.value
                else:
                    data[column.name] = val
            results.append(data)
        return results

    customers = get_query(Customer)
    products = get_query(Product)
    invoices = get_query(Invoice)
    invoice_items = get_query(InvoiceItem)
    categories = get_query(Category)
    suppliers = get_query(Supplier)

    # Debt payments logic...
    payments_query = db.query(DebtPayment).filter(DebtPayment.store_id == store_id)
    if since:
        payments_query = payments_query.filter(DebtPayment.server_applied_at >= since)
    payments = payments_query.all()
    
    serialized_payments = []
    for p in payments:
        serialized_payments.append({
            "id": p.id,
            "customer_id": p.customer_id,
            "amount": p.amount,
            "method": p.method,
            "notes": "دفعة",
            "created_at": p.client_created_at.isoformat() if p.client_created_at else None,
        })

    return {
        "server_time": sync_cursor,
        "customers": serialize_model(customers),
        "products": serialize_model(products),
        "invoices": serialize_model(invoices),
        "invoice_items": serialize_model(invoice_items),
        "categories": serialize_model(categories),
        "suppliers": serialize_model(suppliers),
        "payments": serialized_payments
    }


@router.post("/push", response_model=PushSyncResponse)
def push_sync(
    request: PushSyncRequest,
    db: Session = Depends(get_db),
    store_id: str = Depends(get_current_store_id)
):
    """
    Push batch of changes from client. Applies last-write-wins.
    """
    accepted = []
    skipped = []
    
    # Track inserted master data in this payload to avoid double-counting side-effects
    inserted_customers = set()
    inserted_products = set()
    inserted_suppliers = set()
    updated_products = set()
    updated_customers = set()

    # Map entity names to their SQLAlchemy models
    entities_map = {
        "categories": Category,
        "suppliers": Supplier,
        "customers": Customer,
        "products": Product,
        "invoices": Invoice,
        "invoice_items": InvoiceItem
    }

    try:
        for entity_key, model_class in entities_map.items():
            records = getattr(request, entity_key, [])
            for record_data in records:
                record_id = record_data.get("id")
                if not record_id:
                    continue
                
                # Fetch existing
                existing = db.query(model_class).filter(
                    model_class.id == record_id,
                    model_class.store_id == store_id
                ).first()

                client_updated_at_str = record_data.get("updated_at")
                client_updated_at = None
                if client_updated_at_str:
                    try:
                        client_updated_at = datetime.fromisoformat(client_updated_at_str.replace("Z", "+00:00"))
                    except ValueError:
                        pass
                
                if not client_updated_at:
                    client_updated_at = datetime.now(timezone.utc)

                if existing:
                    # Make existing_updated_at timezone aware for comparison if needed
                    server_updated_at = existing.updated_at
                    if server_updated_at and server_updated_at.tzinfo is None:
                        server_updated_at = server_updated_at.replace(tzinfo=timezone.utc)
                    if client_updated_at.tzinfo is None:
                        client_updated_at = client_updated_at.replace(tzinfo=timezone.utc)

                    if server_updated_at and server_updated_at >= client_updated_at:
                        skipped.append(record_id)
                        continue
                    
                    # Update
                    update_model(existing, record_data)
                    accepted.append(record_id)
                    if entity_key == "products":
                        updated_products.add(record_id)
                    elif entity_key == "customers":
                        updated_customers.add(record_id)
                else:
                    # Insert
                    new_instance = dict_to_model(model_class, record_data, store_id)
                    db.add(new_instance)
                    accepted.append(record_id)
                    
                    if entity_key == "customers":
                        inserted_customers.add(record_id)
                    elif entity_key == "products":
                        inserted_products.add(record_id)
                    elif entity_key == "suppliers":
                        inserted_suppliers.add(record_id)
                    
                    # Custom logic for Invoices: update customer debt on credit
                    if entity_key == "invoices" and record_data.get("payment_method") == PaymentMethod.CREDIT.value:
                        customer_id = record_data.get("customer_id")
                        if customer_id and customer_id not in inserted_customers and customer_id not in updated_customers:
                            customer = db.query(Customer).filter(
                                Customer.id == customer_id, 
                                Customer.store_id == store_id
                            ).first()
                            if customer:
                                remaining = float(record_data.get("remaining_amount", 0.0))
                                customer.current_debt += remaining

                    # Custom logic for Payments: reduce customer debt
                    if entity_key == "payments":
                        customer_id = record_data.get("customer_id")
                        if customer_id and customer_id not in inserted_customers and customer_id not in updated_customers:
                            customer = db.query(Customer).filter(
                                Customer.id == customer_id,
                                Customer.store_id == store_id
                            ).first()
                            if customer:
                                amount = float(record_data.get("amount", 0.0))
                                customer.current_debt -= amount

                    # Custom logic for Invoice Items: adjust product stock
                    if entity_key == "invoice_items":
                        product_id = record_data.get("product_id")
                        invoice_id = record_data.get("invoice_id")
                        if product_id and invoice_id and product_id not in inserted_products and product_id not in updated_products:
                            product = db.query(Product).filter(
                                Product.id == product_id,
                                Product.store_id == store_id
                            ).first()
                            db.flush()
                            invoice = db.query(Invoice).filter(
                                Invoice.id == invoice_id,
                                Invoice.store_id == store_id
                            ).first()
                            if not invoice:
                                all_invs = db.query(Invoice).filter(Invoice.id == invoice_id).all()
                                logger.error(f"DEBUG: Invoice not found with store_id={store_id}. Found without store_id? {all_invs}")
                            if product and invoice:
                                qty = float(record_data.get("quantity", 0.0))
                                unit_type = record_data.get("unit_type", "piece")
                                pieces_per_carton = int(record_data.get("pieces_per_carton", 1))
                                qty_pieces = qty * pieces_per_carton if unit_type == "carton" else qty
                                
                                invoice_type_val = invoice.invoice_type.value if hasattr(invoice.invoice_type, 'value') else str(invoice.invoice_type)
                                logger.error(f"DEBUG: Applying side effect for product {product.id}, current stock: {product.stock_quantity}, invoice_type: {invoice_type_val}, qty: {qty_pieces}")
                                if invoice_type_val.lower() == "sale":
                                    product.stock_quantity -= qty_pieces
                                else:
                                    product.stock_quantity += qty_pieces
                                logger.error(f"DEBUG: New stock: {product.stock_quantity}")
                            else:
                                logger.error(f"DEBUG: Product or Invoice not found! product={bool(product)}, invoice={bool(invoice)}")
                        else:
                            logger.error(f"DEBUG: Side effect skipped. product_id: {product_id}, invoice_id: {invoice_id}, in_inserted: {product_id in inserted_products}")

        db.commit()

        return {
            "accepted": accepted,
            "skipped_server_newer": skipped,
            "server_time": datetime.now(timezone.utc)
        }
    except Exception as e:
        db.rollback()
        logger.exception("Error during sync push")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

