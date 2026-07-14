// ══════════════════════════════════════════════════════════
//  Auth
// ══════════════════════════════════════════════════════════

export type UserRole = 'admin' | 'manager' | 'cashier';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
}

// ══════════════════════════════════════════════════════════
//  Products
// ══════════════════════════════════════════════════════════

export type UnitType = 'piece' | 'carton' | 'kg' | 'liter' | 'meter';

export interface Category {
  id: number;
  name: string;
  name_ar?: string;
  color?: string;
  icon?: string;
  is_active: boolean;
}

export interface Product {
  id: number;
  name: string;
  name_ar?: string;
  description?: string;
  image_url?: string;
  barcode_piece?: string;
  barcode_carton?: string;
  base_unit: UnitType;
  pieces_per_carton: number;
  cost_price: number;
  retail_price: number;
  wholesale_price: number;
  carton_price: number;
  piece_price_from_carton: number;
  stock_quantity: number;
  stock_in_cartons: number;
  min_stock_alert: number;
  is_low_stock: boolean;
  profit_margin: number;
  has_expiry: boolean;
  expiry_date?: string;
  category_id?: number;
  supplier_id?: number;
  tax_rate: number;
  is_active: boolean;
  is_featured: boolean;
  created_at: string;
}

// ══════════════════════════════════════════════════════════
//  Customers & Suppliers
// ══════════════════════════════════════════════════════════

export interface Customer {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  credit_limit: number;
  current_debt: number;
  available_credit: number;
  can_buy_on_credit: boolean;
  loyalty_points: number;
  is_active: boolean;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  balance: number;
  is_active: boolean;
  created_at: string;
}

// ══════════════════════════════════════════════════════════
//  Invoices / POS
// ══════════════════════════════════════════════════════════

export type InvoiceType    = 'sale' | 'purchase' | 'sale_return' | 'purchase_return';
export type InvoiceStatus  = 'draft' | 'completed' | 'cancelled';
export type PaymentStatus  = 'paid' | 'unpaid' | 'partial';
export type PaymentMethod  = 'cash' | 'card' | 'transfer' | 'credit';

export interface InvoiceItem {
  id: number;
  product_id: number;
  product_name?: string;
  quantity: number;
  unit_type: string;
  unit_price: number;
  cost_price: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  unique_token: string;
  invoice_type: InvoiceType;
  status: InvoiceStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  customer_id?: number;
  supplier_id?: number;
  created_by: number;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  tax_percent: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  remaining_amount: number;
  notes?: string;
  invoice_date?: string;
  created_at: string;
  items: InvoiceItem[];
  share_url?: string;
  whatsapp_url?: string;
}

// ══════════════════════════════════════════════════════════
//  POS Cart
// ══════════════════════════════════════════════════════════

export interface CartItem {
  product: Product;
  quantity: number;
  unit_type: 'piece' | 'carton';
  unit_price: number;
  discount_amount: number;
}

// ══════════════════════════════════════════════════════════
//  Dashboard
// ══════════════════════════════════════════════════════════

export interface DashboardSummary {
  today: {
    count: number;
    revenue: number;
    collected: number;
    profit: number;
    margin: number;
    revenue_change_pct: number;
    profit_change_pct: number;
    orders_change_pct: number;
  };
  month: {
    count: number;
    revenue: number;
    profit: number;
    margin: number;
  };
  inventory: {
    total_products: number;
    low_stock_count: number;
    out_of_stock: number;
    stock_value: number;
  };
  finance: {
    total_customers: number;
    customers_debt: number;
    suppliers_debt: number;
    net_receivable: number;
  };
  alerts: {
    drafts: number;
    unpaid: number;
    low_stock: number;
    out_stock: number;
  };
}

// ══════════════════════════════════════════════════════════
//  API Response wrappers
// ══════════════════════════════════════════════════════════

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

export interface ApiError {
  detail: string;
}
