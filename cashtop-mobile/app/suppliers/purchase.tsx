import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input, Card, LoadingScreen } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { suppliersApi, productsApi, invoicesApi } from '../../src/api';
import { searchSuppliersCache, localSupplierToSupplier } from '../../src/db/supplierSync';
import { searchProductsCache, localProductToProduct } from '../../src/db/productsCache';
import { recordOfflinePurchaseLocal } from '../../src/db/offlinePurchases';
import { isBackendReachable } from '../../src/api/client';
import type { Supplier, Product } from '../../src/types';

export default function PurchaseInvoiceScreen() {
  const router = useRouter();
  const { supplierId } = useLocalSearchParams<{ supplierId: string }>();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  
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
        // تحميل من الكاش المحلي أولاً — فوري، بدون إنترنت
        const localSups = searchSuppliersCache('', 200)
          .filter((s): s is Supplier => !('isPending' in s && s.isPending))
          .map(s => localSupplierToSupplier(s as any));
        setSuppliers(localSups);

        const localProds = searchProductsCache('', 500).map(localProductToProduct);
        setProducts(localProds);

        if (supplierId) {
          const s = localSups.find(x => x.id === Number(supplierId));
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
      (p.barcode && p.barcode.includes(q))
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

  const updateCart = (productId: number, field: 'quantity' | 'cost_price', value: string) => {
    const num = Number(value);
    if (isNaN(num)) return;
    setCart(cart.map(x => x.product.id === productId ? { ...x, [field]: num } : x));
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter(x => x.product.id !== productId));
  };

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.quantity * item.cost_price), 0);
  }, [cart]);

  const total = subtotal; // يمكن إضافة ضريبة أو خصم لاحقاً
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
      const online = await isBackendReachable();
      
      if (!online) {
        // الحفظ المحلي أوفلاين
        recordOfflinePurchaseLocal(
          selectedSupplier.id,
          selectedSupplier.name,
          cart.map(item => ({
            product_id: item.product.id,
            quantity: item.quantity,
            unit_type: 'piece',
            unit_price: item.cost_price,
            pieces_per_carton: item.product.pieces_per_carton,
          })),
          total,
          'cash'
        );
        Alert.alert('تم الحفظ محلياً', 'سيتم رفع الفاتورة عند توفر الإنترنت.', [
          { text: 'موافق', onPress: () => router.back() }
        ]);
        return;
      }

      await invoicesApi.create({
        invoice_type: 'purchase',
        supplier_id: selectedSupplier.id,
        payment_method: 'cash',
        paid_amount: Number(paidAmount) || 0,
        notes: notes,
        items: cart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_type: 'piece',
          unit_price: item.cost_price, // نرسل سعر التكلفة الجديد كسعر للوحدة في فاتورة الشراء
        }))
      });
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
            <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '700', color: selectedSupplier ? Colors.gray800 : Colors.gray400 }}>
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
        <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '800', color: Colors.gray800, textAlign: 'right', marginBottom: Spacing.sm }}>
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
                <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.gray600 }}>إجمالي الفاتورة:</Text>
                <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '800', color: Colors.gray800 }}>{total.toFixed(2)} ₪</Text>
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
                <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.danger }}>الباقي دين علينا:</Text>
                <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '800', color: Colors.danger }}>{remaining.toFixed(2)} ₪</Text>
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
                  <Text style={{ fontSize: Fonts.sizes.md, fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>{item.name}</Text>
                  {!!item.company && <Text style={{ color: Colors.gray500, textAlign: 'right' }}>{item.company}</Text>}
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
