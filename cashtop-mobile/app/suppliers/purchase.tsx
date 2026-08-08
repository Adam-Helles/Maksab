import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input, Card, LoadingScreen } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import {
  getAllSuppliers,
  getAllProducts,
  createLocalInvoice,
  updateProductStock,
  updateSupplierBalance
} from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';
import type { Supplier, Product } from '../../src/types';

export default function PurchaseInvoiceScreen() {
  const router = useRouter();
  const { supplierId } = useLocalSearchParams<{ supplierId: string }>();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<any | null>(null);
  
  const [showSupplierModal, setShowSupplierModal] = useState(!supplierId);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [searchResults, setSearchResults] = useState<Product[]>([]);

  // سلة المشتريات
  const [cart, setCart] = useState<Array<{
    product: Product;
    quantity: number;
    cost_price: number;
  }>>([]);

  const [paidAmount, setPaidAmount] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    async function loadData() {
      try {
        const localSups = getAllSuppliers();
        setSuppliers(localSups);

        const localProds = getAllProducts(true).map(p => ({
          id: p.id, name: p.name, name_ar: p.name_ar || undefined,
          barcode_piece: p.barcode_piece || undefined, barcode_carton: p.barcode_carton || undefined,
          base_unit: 'piece' as const, pieces_per_carton: p.pieces_per_carton,
          cost_price: p.cost_price, retail_price: p.retail_price,
          wholesale_price: p.retail_price, carton_price: p.carton_price,
          piece_price_from_carton: p.pieces_per_carton > 0 ? p.carton_price / p.pieces_per_carton : 0,
          stock_quantity: p.stock_quantity,
          stock_in_cartons: p.pieces_per_carton > 0 ? p.stock_quantity / p.pieces_per_carton : 0,
          min_stock_alert: 5, is_low_stock: p.stock_quantity <= 5,
          profit_margin: p.cost_price > 0 ? ((p.retail_price - p.cost_price) / p.cost_price) * 100 : 0,
          has_expiry: false, tax_rate: p.tax_rate,
          is_active: p.is_active === 1, category_id: p.category_id || undefined,
          supplier_id: p.supplier_id || undefined,
          is_featured: false,
          created_at: p.created_at,
        }));
        setProducts(localProds);

        if (supplierId) {
          const s = localSups.find(x => x.id === supplierId);
          if (s) setSelectedSupplier(s);
        }
      } catch (e) {
        Alert.alert('خطأ', 'فشل تحميل البيانات');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [supplierId]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    const res = products.filter(p => 
      p.name.toLowerCase().includes(q) || 
      (p.barcode_piece && p.barcode_piece.includes(q)) ||
      (p.barcode_carton && p.barcode_carton.includes(q))
    ).slice(0, 10);
    setSearchResults(res);
  }, [searchQuery, products]);

  const addToCart = (product: Product) => {
    const exists = cart.find(x => x.product.id === product.id);
    if (exists) {
      setCart(cart.map(x => x.product.id === product.id ? { ...x, quantity: x.quantity + 1 } : x));
    } else {
      setCart([...cart, { product, quantity: 1, cost_price: product.cost_price || 0 }]);
    }
    setSearchQuery('');
  };

  const updateCart = (productId: string, field: 'quantity' | 'cost_price', value: string) => {
    const num = Number(value);
    if (isNaN(num)) return;
    setCart(cart.map(x => x.product.id === productId ? { ...x, [field]: num } : x));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(x => x.product.id !== productId));
  };

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.quantity * item.cost_price), 0);
  }, [cart]);

  const total = subtotal; 
  const remaining = total - (Number(paidAmount) || 0);

  const handleSubmit = async () => {
    if (!selectedSupplier) {
      Alert.alert('تنبيه', 'الرجاء اختيار المورد');
      return;
    }
    if (cart.length === 0) {
      Alert.alert('تنبيه', 'الفاتورة فارغة');
      return;
    }

    setSubmitting(true);
    try {
      const itemsData = cart.map(item => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_type: 'piece',
        unit_price: item.cost_price,
        cost_price: item.cost_price,
        pieces_per_carton: item.product.pieces_per_carton,
        total: item.quantity * item.cost_price
      }));

      createLocalInvoice({
        invoice_number: null,
        invoice_type: 'purchase',
        status: 'completed',
        payment_method: 'cash',
        payment_status: remaining > 0 ? 'partial' : 'paid',
        customer_id: null,
        customer_name: null,
        supplier_id: selectedSupplier.id,
        subtotal: total,
        discount_amount: 0,
        tax_amount: 0,
        total: total,
        paid_amount: Number(paidAmount) || 0,
        remaining_amount: remaining > 0 ? remaining : 0,
        notes: notes || null,
      }, itemsData);

      // زيادة المخزون بناءً على فاتورة المشتريات
      for (const item of cart) {
        updateProductStock(item.product.id, item.quantity);
      }

      // زيادة رصيد المورد (الدين) إذا كان هناك متبقي
      if (remaining > 0) {
        updateSupplierBalance(selectedSupplier.id, remaining);
      }

      runFullSync().catch(() => {});

      Alert.alert('نجاح', 'تم حفظ فاتورة المشتريات بنجاح', [
        { text: 'موافق', onPress: () => router.back() }
      ]);
    } catch (e: any) {
      Alert.alert('خطأ', e.message || 'فشل حفظ الفاتورة');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingScreen message="جاري التحميل..." />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>فاتورة مشتريات</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 150 }} keyboardShouldPersistTaps="handled">
        
        {/* اختيار المورد */}
        <TouchableOpacity 
          style={{
            backgroundColor: Colors.white, padding: Spacing.md, borderRadius: Radius.md,
            flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border
          }}
          onPress={() => setShowSupplierModal(true)}
        >
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10 }}>
            <Ionicons name="business" size={24} color={Colors.primary} />
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: selectedSupplier ? Colors.gray800 : Colors.gray400 }}>
              {selectedSupplier ? selectedSupplier.name : 'اختر المورد...'}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={20} color={Colors.gray400} />
        </TouchableOpacity>

        {/* البحث عن المنتجات */}
        <View style={{ marginBottom: Spacing.lg, zIndex: 10 }}>
          <Input 
            placeholder="ابحث عن منتج أو باركود لإضافته..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            leftIcon={<Ionicons name="search" size={20} color={Colors.gray400} />}
          />
          {searchResults.length > 0 && (
            <Card style={{ position: 'absolute', top: 55, left: 0, right: 0, zIndex: 20, maxHeight: 200, padding: 0, overflow: 'hidden' }}>
              <ScrollView keyboardShouldPersistTaps="handled">
                {searchResults.map(p => (
                  <TouchableOpacity key={p.id} onPress={() => addToCart(p)}
                    style={{ padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '700', color: Colors.gray800 }}>{p.name}</Text>
                    <Text style={{ color: Colors.gray500 }}>{p.stock_quantity} متوفر</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </Card>
          )}
        </View>

        {/* السلة */}
        <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '800', color: Colors.gray800, textAlign: 'right', marginBottom: Spacing.sm }}>
          المنتجات ({cart.length})
        </Text>
        {cart.map((item, index) => (
          <Card key={index} style={{ marginBottom: Spacing.md }}>
            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm }}>
              <Text style={{ fontWeight: '800', color: Colors.primary }}>{item.product.name}</Text>
              <TouchableOpacity onPress={() => removeFromCart(item.product.id)}>
                <Ionicons name="trash-outline" size={20} color={Colors.danger} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Input 
                  label="الكمية" 
                  value={String(item.quantity)} 
                  onChangeText={(v) => updateCart(item.product.id, 'quantity', v)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input 
                  label="سعر الشراء للوحدة" 
                  value={String(item.cost_price)} 
                  onChangeText={(v) => updateCart(item.product.id, 'cost_price', v)}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <Text style={{ textAlign: 'left', fontWeight: '700', color: Colors.gray700 }}>
              الإجمالي: {(item.quantity * item.cost_price).toFixed(2)} ₪
            </Text>
          </Card>
        ))}

        {cart.length > 0 && (
          <>
            <Card style={{ marginVertical: Spacing.lg, backgroundColor: '#F8FAFC' }}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
                <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray600 }}>إجمالي الفاتورة:</Text>
                <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '800', color: Colors.gray800 }}>{total.toFixed(2)} ₪</Text>
              </View>
              <View style={{ borderBottomWidth: 1, borderBottomColor: Colors.border, marginVertical: Spacing.sm }} />
              <Input 
                label="المدفوع نقداً للمورد (₪)"
                value={paidAmount}
                onChangeText={setPaidAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
              />
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: Spacing.sm }}>
                <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.danger }}>الباقي دين علينا:</Text>
                <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '800', color: Colors.danger }}>{remaining.toFixed(2)} ₪</Text>
              </View>
            </Card>

            <Input 
              label="ملاحظات (اختياري)"
              value={notes}
              onChangeText={setNotes}
              placeholder="اكتب أي ملاحظات على الفاتورة"
            />
          </>
        )}

      </ScrollView>

      {/* شريط الإجراء السفلي */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.white,
        padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border,
        shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.1, shadowRadius: 5, elevation: 10
      }}>
        <Button 
          title={`حفظ الفاتورة (${total.toFixed(2)} ₪)`} 
          onPress={handleSubmit} 
          loading={submitting} 
          disabled={cart.length === 0}
          fullWidth size="lg" 
        />
      </View>

      {/* نافذة اختيار المورد */}
      <Modal visible={showSupplierModal} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: Colors.white, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, height: '70%' }}>
            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.md }}>
              <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.gray800 }}>اختر المورد</Text>
              <TouchableOpacity onPress={() => setShowSupplierModal(false)}>
                <Ionicons name="close" size={24} color={Colors.gray500} />
              </TouchableOpacity>
            </View>
            <FlatList 
              data={suppliers}
              keyExtractor={item => String(item.id)}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={{ padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border }}
                  onPress={() => { setSelectedSupplier(item); setShowSupplierModal(false); }}
                >
                  <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>{item.name}</Text>
                  {!!item.notes && <Text style={{ color: Colors.gray500, textAlign: 'right' }}>{item.notes}</Text>}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{ textAlign: 'center', marginTop: 20, color: Colors.gray400 }}>لا يوجد موردين</Text>}
            />
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}
