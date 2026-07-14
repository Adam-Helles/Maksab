from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from app.models.invoice import PaymentMethod


# ══════════════════════════════════════════════════════════
#  ملخصات مالية
# ══════════════════════════════════════════════════════════

class FinancialSummary(BaseModel):
    # الذمم المدينة (يجب على العملاء)
    total_customer_debt: float
    customers_with_debt: int

    # الذمم الدائنة (يجب علينا للموردين)
    total_supplier_debt: float
    suppliers_with_debt: int

    # صافي المركز المالي
    net_position: float        # customer_debt - supplier_debt

    # مبيعات الشهر الحالي
    month_sales: float
    month_collected: float
    month_profit: float


class CustomerDebtEntry(BaseModel):
    customer_id: int
    customer_name: str
    phone: Optional[str]
    current_debt: float
    credit_limit: float
    available_credit: float
    overdue: bool             # تجاوز حد الائتمان
    last_invoice_date: Optional[datetime]

    model_config = {"from_attributes": True}


class SupplierDebtEntry(BaseModel):
    supplier_id: int
    supplier_name: str
    company: Optional[str]
    phone: Optional[str]
    balance: float            # ما يجب علينا للمورد
    last_invoice_date: Optional[datetime]

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════
#  تسجيل دفعة خارج الفاتورة
# ══════════════════════════════════════════════════════════

class DebtPaymentCreate(BaseModel):
    amount: float
    method: PaymentMethod = PaymentMethod.CASH
    notes: Optional[str] = None


class DebtPaymentResponse(BaseModel):
    success: bool
    entity_type: str          # customer / supplier
    entity_id: int
    entity_name: str
    amount_paid: float
    debt_before: float
    debt_after: float
    method: str
