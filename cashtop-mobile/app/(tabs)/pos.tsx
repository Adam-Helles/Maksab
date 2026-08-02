import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Button, Badge } from '../../src/components/ui';
import { CustomerPickerModal } from '../../src/components/CustomerPickerModal';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { isBackendReachable } from '../../src/api/client';
import { useCartStore } from '../../src/store/cartStore';
import type { Product, Customer, PaymentMethod } from '../../src/types';
import {
  searchProducts, localProductToProduct, getAllProducts,
  createLocalInvoice, updateCustomerDebt, updateProductStock,
  LocalProduct, runInTransaction
} from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';
import { reportsApi } from '../../src/api/reports';

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'cash',     label: 'نقدي',   icon: 'cash-outline' },
  { value: 'card',     label: 'بطاقة',  icon: 'card-outline' },
  { value: 'transfer', label: 'تحويل',  icon: 'swap-horizontal-outline' },
  { value: 'credit',   label: 'آجل',    icon: 'time-outline' },
];

// تحويل LocalProduct إلى Product للواجهة
function localProductToUI(p: LocalProduct): Product {
  return {
    id: p.id,
    name: p.name,
    name_ar: p.name_ar || undefined,
    barcode_piece: p.barcode_piece || undefined,
    barcode_carton: p.barcode_carton || undefined,
    base_unit: 'piece',
    pieces_per_carton: p.pieces_per_carton,
    cost_price: p.cost_price,
    retail_price: p.retail_price,
    wholesale_price: p.retail_price,
    carton_price: p.carton_price,
    piece_price_from_carton: p.pieces_per_carton > 0 ? p.carton_price / p.pieces_per_carton : 0,
    stock_quantity: p.stock_quantity,
    stock_in_cartons: p.pieces_per_carton > 0 ? p.stock_quantity / p.pieces_per_carton : 0,
    min_stock_alert: 5,
    is_low_stock: p.stock_quantity <= 5,
    profit_margin: p.cost_price > 0 ? ((p.retail_price - p.cost_price) / p.cost_price) * 100 : 0,
    has_expiry: false,
    tax_rate: p.tax_rate,
    is_active: p.is_active === 1,
    is_featured: false,
    created_at: p.created_at,
  };
}

export default function POSScreen() {
  const router = useRouter();
  const {
    items, customerId, discountPercent, discountAmount, taxPercent, paymentMethod, notes,
    subtotal, total, taxAmount,
    addItem, removeItem, updateQty, setDiscount, setTax, setCustomer, setPaymentMethod, setNotes, clearCart,
  } = useCartStore();

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [discountPercentText, setDiscountPercentText] = useState(String(discountPercent || ''));
  const [discountAmountText, setDiscountAmountText] = useState(String(discountAmount || ''));
  const [taxPercentText, setTaxPercentText] = useState(String(taxPercent || ''));
  const [paidAmountText, setPaidAmountText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // مزامنة تلقائية في الخلفية عند فتح الشاشة
  useEffect(() => {
    isBackendReachable().then(online => {
      if (online) {
        runFullSync().catch(err => console.log('[POS] Background sync error:', err));
      }
    });
  }, []);

  // ── بحث عن منتجات — من SQLite فقط (فوري، بدون إنترنت) ──────────
  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      try {
        const found = searchProducts(search.trim(), 10);
        setResults(found.map(localProductToUI));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const handleAdd = (product: Product, unit_type: 'piece' | 'carton') => {
    addItem(product, unit_type);
    setSearch('');
    setResults([]);
    Keyboard.dismiss();
  };

  const handleSelectCustomer = (customer: Customer | null) => {
    setSelectedCustomer(customer);
    setCustomer(customer?.id ?? null);
  };

  const onDiscountPercentChange = (t: string) => {
    setDiscountPercentText(t);
    setDiscount(Number(t) || 0, Number(discountAmountText) || 0);
  };
  const onDiscountAmountChange = (t: string) => {
    setDiscountAmountText(t);
    setDiscount(Number(discountPercentText) || 0, Number(t) || 0);
  };
  const onTaxPercentChange = (t: string) => {
    setTaxPercentText(t);
    setTax(Number(t) || 0);
  };

  const resetForm = () => {
    clearCart();
    setSelectedCustomer(null);
    setDiscountPercentText('');
    setDiscountAmountText('');
    setTaxPercentText('');
    setPaidAmountText('');
  };

  // ── إتمام البيع — محلي دائماً أولاً ───────────────────────────
  const handleCheckout = async (asDraft: boolean) => {
    if (items.length === 0) {
      Alert.alert('السلة فارغة', 'أضف منتجاً واحداً على الأقل قبل إتمام البيع');
      return;
    }
    if (paymentMethod === 'credit' && !customerId) {
      Alert.alert('اختر عميلاً', 'البيع الآجل يتطلب اختيار عميل');
      return;
    }

    setSubmitting(true);

    try {
      const paidAmount = paymentMethod === 'credit'
        ? (Number(paidAmountText) || 0)
        : total;
      const remainingAmount = Math.max(0, total - paidAmount);

      // ✅ تغليف جميع العمليات الحساسة في Transaction (All-or-Nothing)
      runInTransaction(() => {
        // ── خطوة 1: احفظ الفاتورة محلياً في SQLite فوراً ────────────
        const invoiceItems = items.map(i => ({
          invoice_id: '', // سيُملأ داخل createLocalInvoice
          product_id: i.product.id,
          product_name: i.product.name_ar || i.product.name,
          quantity: i.quantity,
          unit_type: i.unit_type,
          unit_price: i.unit_price,
          cost_price: i.product.cost_price,
          pieces_per_carton: i.product.pieces_per_carton,
          total: i.unit_price * i.quantity - i.discount_amount,
        }));

        createLocalInvoice({
          invoice_number: null, // سيُعطى من السيرفر عند المزامنة
          invoice_type: 'sale',
          status: asDraft ? 'draft' : 'completed',
          payment_method: paymentMethod as any,
          payment_status: remainingAmount <= 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
          customer_id: customerId || null,
          customer_name: selectedCustomer?.name || null,
          supplier_id: null,
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total,
          paid_amount: paidAmount,
          remaining_amount: remainingAmount,
          notes: notes || null,
          sync_status: 'pending_create',
        }, invoiceItems);

        // ── خطوة 2: تحديث مخزون المنتجات محلياً ──────────────────────
        for (const item of items) {
          const qtyInPieces = item.unit_type === 'carton'
            ? item.quantity * item.product.pieces_per_carton
            : item.quantity;
          updateProductStock(item.product.id, -qtyInPieces);
        }

        // ── خطوة 3: تحديث دين العميل محلياً (إذا كان آجل) ────────────
        if (paymentMethod === 'credit' && customerId && remainingAmount > 0) {
          updateCustomerDebt(customerId, remainingAmount);
        }
      });

      resetForm();

      // ── خطوة 4: مزامنة بالخلفية (بدون انتظار) ───────────────────
      isBackendReachable().then(online => {
        if (online) {
          runFullSync().catch(err => console.log('[POS] Post-sale sync error:', err));
        }
      });

      Alert.alert(
        asDraft ? '📝 تم حفظ المسودة' : '✅ تمت عملية البيع',
        `الإجمالي: ${total.toFixed(2)} ₪\nتم الحفظ محلياً وسيتزامن تلقائياً مع السيرفر.`,
      );

    } catch (e: any) {
      Alert.alert('خطأ', e?.message || 'تعذّر إتمام البيع');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          🧾 نقطة البيع
        </Text>
        {items.length > 0 && (
          <TouchableOpacity onPress={() => Alert.alert('تفريغ السلة', 'هل تريد حذف كل المنتجات من السلة؟', [
            { text: 'إلغاء', style: 'cancel' },
            { text: 'تفريغ', style: 'destructive', onPress: resetForm },
          ])}>
            <Ionicons name="trash-outline" size={22} color={Colors.danger} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 260 }}>
        {/* Search */}
        <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
          <Input
            placeholder="ابحث عن منتج بالاسم أو الباركود..."
            value={search}
            onChangeText={setSearch}
            leftIcon={<Ionicons name="search" size={18} color={Colors.gray400} />}
            rightIcon={
              <TouchableOpacity onPress={() => router.push({ pathname: '/scan', params: { source: 'pos' } })}>
                <Ionicons name="barcode-outline" size={22} color={Colors.primary} />
              </TouchableOpacity>
            }
          />

          {searching && <ActivityIndicator style={{ marginBottom: Spacing.md }} color={Colors.primary} />}

          {results.length > 0 && (
            <View style={{ marginBottom: Spacing.md, gap: 8 }}>
              {results.map(p => (
                <View key={p.id} style={{
                  backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
                  flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                  ...Shadow.sm,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>
                      {p.name_ar || p.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                      متوفر: {p.stock_quantity} · {p.retail_price.toFixed(2)} ₪
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row-reverse', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => handleAdd(p, 'piece')}
                      style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 8 }}
                    >
                      <Ionicons name="add" size={18} color={Colors.white} />
                    </TouchableOpacity>
                    {p.carton_price > 0 && (
                      <TouchableOpacity
                        onPress={() => handleAdd(p, 'carton')}
                        style={{ backgroundColor: Colors.gray100, borderRadius: Radius.md,
                                 paddingHorizontal: 10, justifyContent: 'center' }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.gray600 }}>كرتونة</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Cart */}
        <View style={{ paddingHorizontal: Spacing.lg }}>
          {items.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: Spacing['3xl'] }}>
              <Text style={{ fontSize: 48, marginBottom: 12 }}>🛒</Text>
              <Text style={{ color: Colors.gray400, fontSize: 15 }}>ابحث عن منتج لإضافته للسلة</Text>
            </View>
          ) : (
            <View style={{ gap: 8, marginBottom: Spacing.lg }}>
              {items.map(item => (
                <CartRow
                  key={`${item.product.id}-${item.unit_type}`}
                  item={item}
                  onIncrement={() => updateQty(item.product.id, item.unit_type, item.quantity + 1)}
                  onDecrement={() => updateQty(item.product.id, item.unit_type, item.quantity - 1)}
                  onRemove={() => removeItem(item.product.id, item.unit_type)}
                />
              ))}
            </View>
          )}
        </View>

        {items.length > 0 && (
          <View style={{ paddingHorizontal: Spacing.lg }}>
            {/* Customer */}
            <TouchableOpacity
              onPress={() => setShowCustomerPicker(true)}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
                marginBottom: Spacing.md, ...Shadow.sm,
              }}
            >
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
                <Ionicons name="person-outline" size={20} color={Colors.primary} />
                <Text style={{ fontWeight: '700', color: Colors.gray800 }}>
                  {selectedCustomer ? selectedCustomer.name : 'عميل نقدي (بدون اسم)'}
                </Text>
              </View>
              <Ionicons name="chevron-back" size={18} color={Colors.gray400} />
            </TouchableOpacity>

            {/* Discount & Tax */}
            <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Input label="خصم %" value={discountPercentText} onChangeText={onDiscountPercentChange}
                       keyboardType="decimal-pad" placeholder="0" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="خصم (₪)" value={discountAmountText} onChangeText={onDiscountAmountChange}
                       keyboardType="decimal-pad" placeholder="0" />
              </View>
              <View style={{ flex: 1 }}>
                <Input label="ضريبة %" value={taxPercentText} onChangeText={onTaxPercentChange}
                       keyboardType="decimal-pad" placeholder="0" />
              </View>
            </View>

            {/* Payment method */}
            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.gray600,
                           textAlign: 'right', marginBottom: 8 }}>
              طريقة الدفع
            </Text>
            <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: Spacing.md }}>
              {PAYMENT_OPTIONS.map(opt => {
                const active = paymentMethod === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => setPaymentMethod(opt.value)}
                    style={{
                      flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10,
                      borderRadius: Radius.lg,
                      backgroundColor: active ? Colors.primary : Colors.white,
                      borderWidth: active ? 0 : 1, borderColor: Colors.gray200,
                    }}
                  >
                    <Ionicons name={opt.icon} size={18} color={active ? Colors.white : Colors.gray500} />
                    <Text style={{ fontSize: 12, fontWeight: '700',
                                   color: active ? Colors.white : Colors.gray600 }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {paymentMethod === 'credit' && (
              <Input
                label="المبلغ المدفوع الآن (اتركه فارغاً إذا آجل بالكامل)"
                value={paidAmountText}
                onChangeText={setPaidAmountText}
                keyboardType="decimal-pad"
                placeholder="0"
              />
            )}

            <Input
              label="ملاحظات (اختياري)"
              value={notes}
              onChangeText={setNotes}
              placeholder="مثال: طلب خاص، توصيل..."
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom summary bar */}
      {items.length > 0 && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          backgroundColor: Colors.white, borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'],
          padding: Spacing.lg, ...Shadow.lg,
        }}>
          <SummaryRow label="المجموع الفرعي" value={subtotal} />
          <SummaryRow label="الضريبة" value={taxAmount} />
          <SummaryRow label="الإجمالي" value={total} bold />

          <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: Spacing.md }}>
            <Button
              title="حفظ كمسودة"
              variant="secondary"
              onPress={() => handleCheckout(true)}
              loading={submitting}
              style={{ flex: 1 }}
            />
            <Button
              title="إتمام البيع"
              variant="success"
              onPress={() => handleCheckout(false)}
              loading={submitting}
              style={{ flex: 2 }}
            />
          </View>
        </View>
      )}

      <CustomerPickerModal
        visible={showCustomerPicker}
        onClose={() => setShowCustomerPicker(false)}
        onSelect={handleSelectCustomer}
      />
    </SafeAreaView>
  );
}

// ── Cart row ─────────────────────────────────────────────
function CartRow({ item, onIncrement, onDecrement, onRemove }: {
  item: { product: Product; quantity: number; unit_type: string; unit_price: number };
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
}) {
  const lineTotal = item.unit_price * item.quantity;
  return (
    <View style={{
      backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
      flexDirection: 'row-reverse', alignItems: 'center', gap: Spacing.sm, ...Shadow.sm,
    }}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>
          {item.product.name_ar || item.product.name}
        </Text>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <Text style={{ fontSize: 12, color: Colors.gray400 }}>
            {item.unit_price.toFixed(2)} ₪
          </Text>
          {item.unit_type === 'carton' && <Badge label="كرتونة" color="blue" />}
        </View>
      </View>

      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
        <TouchableOpacity onPress={onDecrement} style={styles.stepBtn}>
          <Ionicons name={item.quantity <= 1 ? 'trash-outline' : 'remove'} size={16} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontWeight: '800', fontSize: 15, minWidth: 20, textAlign: 'center' }}>
          {item.quantity}
        </Text>
        <TouchableOpacity onPress={onIncrement} style={styles.stepBtn}>
          <Ionicons name="add" size={16} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      <Text style={{ fontWeight: '800', fontSize: 15, color: Colors.primary, minWidth: 60, textAlign: 'left' }}>
        {lineTotal.toFixed(2)}
      </Text>

      <TouchableOpacity onPress={onRemove}>
        <Ionicons name="close-circle" size={20} color={Colors.gray300} />
      </TouchableOpacity>
    </View>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: bold ? 0 : 4 }}>
      <Text style={{ fontSize: bold ? 17 : 13, fontWeight: bold ? '800' : '500',
                    color: bold ? Colors.gray800 : Colors.gray500 }}>
        {label}
      </Text>
      <Text style={{ fontSize: bold ? 20 : 13, fontWeight: bold ? '800' : '600',
                    color: bold ? Colors.primary : Colors.gray600 }}>
        {value.toFixed(2)} ₪
      </Text>
    </View>
  );
}

const styles = {
  stepBtn: {
    width: 28, height: 28, borderRadius: Radius.md, backgroundColor: Colors.gray100,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
};