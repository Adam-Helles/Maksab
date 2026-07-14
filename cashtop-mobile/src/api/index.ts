import { api } from './client';
import type { Product, Customer, Supplier, Category, DashboardSummary } from '../types';

// ══════════════════════════════════════════════════════════
//  Products
// ══════════════════════════════════════════════════════════

export const productsApi = {
  list: async (params?: {
    search?: string;
    category_id?: number;
    low_stock?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<Product[]> => {
    const { data } = await api.get<Product[]>('/products/', { params });
    return data;
  },

  get: async (id: number): Promise<Product> => {
    const { data } = await api.get<Product>(`/products/${id}`);
    return data;
  },

  getByBarcode: async (barcode: string) => {
    const { data } = await api.get(`/inventory/barcode/lookup/${barcode}`);
    return data;
  },

  create: async (payload: Partial<Product>): Promise<Product> => {
    const { data } = await api.post<Product>('/products/', payload);
    return data;
  },

  update: async (id: number, payload: Partial<Product>): Promise<Product> => {
    const { data } = await api.patch<Product>(`/products/${id}`, payload);
    return data;
  },

  adjustStock: async (id: number, change: number, reason: string, unit_type = 'piece') => {
    const { data } = await api.post(`/products/${id}/adjust-stock`, {
      quantity_change: change,
      reason,
      unit_type,
    });
    return data;
  },

  getLowStock: async (): Promise<Product[]> => {
    const { data } = await api.get<Product[]>('/inventory/alerts/low-stock');
    return data;
  },
};

// ══════════════════════════════════════════════════════════
//  Categories
// ══════════════════════════════════════════════════════════

export const categoriesApi = {
  list: async (): Promise<Category[]> => {
    const { data } = await api.get<Category[]>('/categories/');
    return data;
  },

  create: async (payload: { name: string; icon?: string; color?: string }): Promise<Category> => {
    const { data } = await api.post<Category>('/categories/', payload);
    return data;
  },
};

// ══════════════════════════════════════════════════════════
//  Customers
// ══════════════════════════════════════════════════════════

export const customersApi = {
  list: async (params?: { search?: string; has_debt?: boolean }): Promise<Customer[]> => {
    const { data } = await api.get<Customer[]>('/customers/', { params });
    return data;
  },

  get: async (id: number): Promise<Customer> => {
    const { data } = await api.get<Customer>(`/customers/${id}`);
    return data;
  },

  create: async (payload: Partial<Customer>): Promise<Customer> => {
    const { data } = await api.post<Customer>('/customers/', payload);
    return data;
  },

  update: async (id: number, payload: Partial<Customer>): Promise<Customer> => {
    const { data } = await api.patch<Customer>(`/customers/${id}`, payload);
    return data;
  },

  statement: async (id: number) => {
    const { data } = await api.get(`/finance/customers/${id}/statement`);
    return data;
  },

  payDebt: async (id: number, amount: number, method = 'cash') => {
    const { data } = await api.post(`/finance/customers/${id}/pay`, { amount, method });
    return data;
  },
};

// ══════════════════════════════════════════════════════════
//  Suppliers
// ══════════════════════════════════════════════════════════

export const suppliersApi = {
  list: async (search?: string): Promise<Supplier[]> => {
    const { data } = await api.get<Supplier[]>('/suppliers/', { params: { search } });
    return data;
  },

  create: async (payload: Partial<Supplier> & { company?: string; tax_number?: string; notes?: string }): Promise<Supplier> => {
    const { data } = await api.post<Supplier>('/suppliers/', payload);
    return data;
  },

  payDebt: async (id: number, amount: number, method = 'cash') => {
    const { data } = await api.post(`/finance/suppliers/${id}/pay`, { amount, method });
    return data;
  },
};

// ══════════════════════════════════════════════════════════
//  Invoices
// ══════════════════════════════════════════════════════════

export const invoicesApi = {
  create: async (payload: {
    invoice_type: string;
    customer_id?: number;
    payment_method: string;
    paid_amount: number;
    discount_percent?: number;
    discount_amount?: number;
    tax_percent?: number;
    notes?: string;
    as_draft?: boolean;
    items: Array<{
      product_id: number;
      quantity: number;
      unit_type: string;
      unit_price?: number;
      discount_amount?: number;
    }>;
  }) => {
    const { data } = await api.post('/invoices/', payload);
    return data;
  },

  list: async (params?: {
    invoice_type?: string;
    status?: string;
    customer_id?: number;
    skip?: number;
    limit?: number;
  }) => {
    const { data } = await api.get('/invoices/', { params });
    return data;
  },

  get: async (id: number) => {
    const { data } = await api.get(`/invoices/${id}`);
    return data;
  },

  getDrafts: async () => {
    const { data } = await api.get('/invoices/drafts');
    return data;
  },

  addPayment: async (id: number, amount: number, method = 'cash') => {
    const { data } = await api.post(`/invoices/${id}/payments`, { amount, method });
    return data;
  },

  cancel: async (id: number, reason = '') => {
    const { data } = await api.post(`/invoices/${id}/cancel?reason=${encodeURIComponent(reason)}`);
    return data;
  },

  todayStats: async () => {
    const { data } = await api.get('/invoices/stats/today');
    return data;
  },
};

// ══════════════════════════════════════════════════════════
//  Dashboard
// ══════════════════════════════════════════════════════════

export const dashboardApi = {
  summary: async (): Promise<DashboardSummary> => {
    const { data } = await api.get<DashboardSummary>('/dashboard/summary');
    return data;
  },

  all: async () => {
    const { data } = await api.get('/dashboard/all');
    return data;
  },

  chartDaily: async (days = 30) => {
    const { data } = await api.get('/dashboard/chart/sales-daily', { params: { days } });
    return data;
  },

  chartTopProducts: async (days = 30, limit = 5) => {
    const { data } = await api.get('/dashboard/chart/top-products', { params: { days, limit } });
    return data;
  },
};


export { usersApi } from './users';
export { reportsApi } from './reports';
export { settingsApi } from './settings';