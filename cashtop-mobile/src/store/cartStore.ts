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

/**
 * تقريب للـ 3 خانات عشرية — يمنع أخطاء floating-point
 * مثل 0.1 + 0.2 = 0.30000000000000004
 */
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * تحقق صارم من القيم المدخلة (حماية محاسبية):
 * - الخصم %: يجب أن يكون بين 0 و 100
 * - الخصم المبلغ: يجب أن يكون ≥ 0
 * - الضريبة %: يجب أن يكون بين 0 و 100
 * - أي قيمة سالبة أو NaN → تصبح 0
 *
 * ⚠️ بدون هذا التحقق يمكن نظرياً أن يُدخل المستخدم:
 *   - خصم = -50% → ينتج إجمالي أعلى من سعر البيع (!)
 *   - خصم = 150% → ينتج إجمالي سالب يُرجع للعميل نقوداً (!)
 *   - ضريبة = -10% → تُنقص المبلغ بدل ما تزيده
 */
const sanitize = {
  percent: (v: number) => Math.max(0, Math.min(100, isFinite(v) ? v : 0)),
  amount:  (v: number) => Math.max(0, isFinite(v) ? v : 0),
};

const calcTotals = (
  items: CartItem[],
  discountPercent: number,
  discountAmount: number,
  taxPercent: number
) => {
  // إجمالي الأسطر (كل منتج × سعره × كميته - خصم السطر الخاص به)
  const rawSubtotal = items.reduce(
    (s, i) => s + i.unit_price * i.quantity - i.discount_amount,
    0
  );
  // يمنع subtotal سالباً (لو خصم السطر أكبر من قيمته)
  const subtotal = Math.max(0, rawSubtotal);

  // الخصم الكلي = خصم نسبة + خصم مبلغ ثابت
  const discPercent = sanitize.percent(discountPercent);
  const discAmt     = sanitize.amount(discountAmount);
  const discTotal   = subtotal * (discPercent / 100) + discAmt;

  // بعد الخصم — لا يمكن أن يكون سالباً
  const afterDiscount = Math.max(0, subtotal - discTotal);

  // الضريبة تُحسب على القيمة بعد الخصم فقط
  const taxPct   = sanitize.percent(taxPercent);
  const taxAmt   = afterDiscount * (taxPct / 100);

  // الإجمالي النهائي — لا يمكن أن يكون سالباً
  const total = Math.max(0, afterDiscount + taxAmt);

  return {
    subtotal:  round(subtotal),
    taxAmount: round(taxAmt),
    total:     round(total),
  };
};

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

    // السعر لا يمكن أن يكون سالباً (حماية من بيانات فاسدة من الـ API)
    const safePrice = Math.max(0, unit_price);

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
      newItems = [...items, { product, quantity: 1, unit_type, unit_price: safePrice, discount_amount: 0 }];
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
    // الكمية يجب أن تكون ≥ 1 لو بقي الصنف، أو 0 لو حُذف
    const safeQty = Math.max(0, Math.round(qty));
    const newItems = safeQty <= 0
      ? get().items.filter(i => !(i.product.id === productId && i.unit_type === unit_type))
      : get().items.map(i =>
          i.product.id === productId && i.unit_type === unit_type
            ? { ...i, quantity: safeQty }
            : i
        );
    set({ items: newItems, ...calcTotals(newItems, discountPercent, discountAmount, taxPercent) });
  },

  setDiscount: (percent, amount) => {
    const { items, taxPercent } = get();
    const safePercent = sanitize.percent(percent);
    const safeAmount  = sanitize.amount(amount);
    set({
      discountPercent: safePercent,
      discountAmount:  safeAmount,
      ...calcTotals(items, safePercent, safeAmount, taxPercent),
    });
  },

  setTax: (percent) => {
    const { items, discountPercent, discountAmount } = get();
    const safePct = sanitize.percent(percent);
    set({
      taxPercent: safePct,
      ...calcTotals(items, discountPercent, discountAmount, safePct),
    });
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
