import { create } from 'zustand';
import type { CartItem, Product } from '../types';

interface CartState {
  items:           CartItem[];
  customerId:      number | null;
  discountPercent: number;
  discountAmount:  number;
  taxPercent:      number;
  paymentMethod:   string;
  notes:           string;

  // Computed (محسوبة)
  subtotal:        number;
  total:           number;
  taxAmount:       number;

  // Actions
  addItem:         (product: Product, unit_type?: 'piece' | 'carton') => void;
  removeItem:      (productId: number, unit_type: string) => void;
  updateQty:       (productId: number, unit_type: string, qty: number) => void;
  setDiscount:     (percent: number, amount: number) => void;
  setTax:          (percent: number) => void;
  setCustomer:     (id: number | null) => void;
  setPaymentMethod:(method: string) => void;
  setNotes:        (notes: string) => void;
  clearCart:       () => void;
}

const calcTotals = (
  items: CartItem[],
  discountPercent: number,
  discountAmount: number,
  taxPercent: number
) => {
  const subtotal       = items.reduce((s, i) => s + i.unit_price * i.quantity - i.discount_amount, 0);
  const discTotal      = subtotal * (discountPercent / 100) + discountAmount;
  const afterDiscount  = Math.max(0, subtotal - discTotal);
  const taxAmount      = afterDiscount * (taxPercent / 100);
  const total          = afterDiscount + taxAmount;
  return { subtotal: round(subtotal), taxAmount: round(taxAmount), total: round(total) };
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export const useCartStore = create<CartState>((set, get) => ({
  items:           [],
  customerId:      null,
  discountPercent: 0,
  discountAmount:  0,
  taxPercent:      0,
  paymentMethod:   'cash',
  notes:           '',
  subtotal:        0,
  total:           0,
  taxAmount:       0,

  addItem: (product, unit_type = 'piece') => {
    const { items, discountPercent, discountAmount, taxPercent } = get();
    const unit_price = unit_type === 'carton' ? product.carton_price : product.retail_price;

    const existing = items.find(
      i => i.product.id === product.id && i.unit_type === unit_type
    );

    let newItems: CartItem[];
    if (existing) {
      newItems = items.map(i =>
        i.product.id === product.id && i.unit_type === unit_type
          ? { ...i, quantity: i.quantity + 1 }
          : i
      );
    } else {
      newItems = [...items, { product, quantity: 1, unit_type, unit_price, discount_amount: 0 }];
    }

    set({ items: newItems, ...calcTotals(newItems, discountPercent, discountAmount, taxPercent) });
  },

  removeItem: (productId, unit_type) => {
    const { discountPercent, discountAmount, taxPercent } = get();
    const newItems = get().items.filter(
      i => !(i.product.id === productId && i.unit_type === unit_type)
    );
    set({ items: newItems, ...calcTotals(newItems, discountPercent, discountAmount, taxPercent) });
  },

  updateQty: (productId, unit_type, qty) => {
    const { discountPercent, discountAmount, taxPercent } = get();
    const newItems = qty <= 0
      ? get().items.filter(i => !(i.product.id === productId && i.unit_type === unit_type))
      : get().items.map(i =>
          i.product.id === productId && i.unit_type === unit_type
            ? { ...i, quantity: qty }
            : i
        );
    set({ items: newItems, ...calcTotals(newItems, discountPercent, discountAmount, taxPercent) });
  },

  setDiscount: (percent, amount) => {
    const { items, taxPercent } = get();
    set({ discountPercent: percent, discountAmount: amount,
          ...calcTotals(items, percent, amount, taxPercent) });
  },

  setTax: (percent) => {
    const { items, discountPercent, discountAmount } = get();
    set({ taxPercent: percent,
          ...calcTotals(items, discountPercent, discountAmount, percent) });
  },

  setCustomer:      (id)     => set({ customerId: id }),
  setPaymentMethod: (method) => set({ paymentMethod: method }),
  setNotes:         (notes)  => set({ notes }),

  clearCart: () => set({
    items: [], customerId: null, discountPercent: 0,
    discountAmount: 0, taxPercent: 0, paymentMethod: 'cash',
    notes: '', subtotal: 0, total: 0, taxAmount: 0,
  }),
}));
