import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Badge, LoadingScreen } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import { productsApi } from '../../src/api';
import type { Product } from '../../src/types';

export default function ProductDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const productId = Number(id);

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjusting, setAdjusting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await productsApi.get(productId);
      setProduct(data);
    } catch (e) {
      Alert.alert('خطأ', 'تعذّر تحميل بيانات المنتج');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const adjustStock = async (change: number) => {
    if (!product) return;
    setAdjusting(true);
    try {
      await productsApi.adjustStock(product.id, change, change > 0 ? 'تعديل يدوي - إضافة' : 'تعديل يدوي - خصم');
      await load();
    } catch (e: any) {
      Alert.alert('خطأ', e?.response?.data?.detail || 'تعذّر تعديل المخزون');
    } finally {
      setAdjusting(false);
    }
  };

  const toggleActive = () => {
    if (!product) return;
    Alert.alert(
      product.is_active ? 'إلغاء تفعيل المنتج' : 'تفعيل المنتج',
      product.is_active ? 'سيتم إخفاء المنتج من نقطة البيع. هل تريد المتابعة؟' : 'هل تريد إعادة تفعيل هذا المنتج؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تأكيد', style: 'destructive',
          onPress: async () => {
            try {
              await productsApi.update(product.id, { is_active: !product.is_active });
              await load();
            } catch {
              Alert.alert('خطأ', 'تعذّر تنفيذ العملية');
            }
          },
        },
      ],
    );
  };

  if (loading || !product) return <LoadingScreen message="جاري تحميل المنتج..." />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
          تفاصيل المنتج
        </Text>
        <TouchableOpacity onPress={() => router.push({ pathname: '/product/edit/[id]', params: { id: String(product.id) } })}>
          <Ionicons name="create-outline" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }}>
        <Card style={{ marginBottom: Spacing.lg }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: Fonts.sizes['2xl'], fontWeight: '800', color: Colors.gray800, textAlign: 'right' }}>
                {product.name_ar || product.name}
              </Text>
              {!!product.name_ar && (
                <Text style={{ fontSize: 13, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                  {product.name}
                </Text>
              )}
            </View>
          </View>
          <View style={{ flexDirection: 'row-reverse', gap: 6, marginTop: Spacing.sm, flexWrap: 'wrap' }}>
            {product.is_low_stock && <Badge label="مخزون منخفض" color="red" />}
            {!product.is_active && <Badge label="غير نشط" color="gray" />}
            {product.is_featured && <Badge label="مميز" color="yellow" />}
          </View>
        </Card>

        <SectionTitle text="الأسعار والربحية" />
        <Card style={{ marginBottom: Spacing.lg }}>
          <Row label="سعر البيع" value={`${product.retail_price.toFixed(2)} ₪`} bold />
          <Row label="سعر التكلفة" value={`${product.cost_price.toFixed(2)} ₪`} />
          <Row label="سعر الجملة" value={`${product.wholesale_price.toFixed(2)} ₪`} />
          <Row label="سعر الكرتونة" value={`${product.carton_price.toFixed(2)} ₪`} />
          <Row label="هامش الربح" value={`${product.profit_margin.toFixed(1)}%`}
               valueColor={product.profit_margin >= 0 ? Colors.success : Colors.danger} last />
        </Card>

        <SectionTitle text="المخزون" />
        <Card style={{ marginBottom: Spacing.lg }}>
          <Row label="الكمية الحالية" value={`${product.stock_quantity} ${unitLabel(product.base_unit)}`} bold />
          <Row label="بالكراتين" value={`${product.stock_in_cartons}`} />
          <Row label="حد التنبيه" value={`${product.min_stock_alert}`} last />

          <View style={{ flexDirection: 'row-reverse', gap: Spacing.md, marginTop: Spacing.md }}>
            <Button title="إضافة 1" size="sm" variant="success" onPress={() => adjustStock(1)}
                    loading={adjusting} icon={<Ionicons name="add" size={16} color={Colors.white} />} />
            <Button title="خصم 1" size="sm" variant="danger" onPress={() => adjustStock(-1)}
                    loading={adjusting} icon={<Ionicons name="remove" size={16} color={Colors.white} />} />
          </View>
        </Card>

        <SectionTitle text="معلومات إضافية" />
        <Card style={{ marginBottom: Spacing.lg }}>
          {!!product.barcode_piece && <Row label="باركود القطعة" value={product.barcode_piece} />}
          {!!product.barcode_carton && <Row label="باركود الكرتونة" value={product.barcode_carton} />}
          <Row label="عدد القطع بالكرتونة" value={`${product.pieces_per_carton}`} />
          <Row label="نسبة الضريبة" value={`${product.tax_rate}%`} />
          {product.has_expiry && !!product.expiry_date && (
            <Row label="تاريخ الصلاحية" value={product.expiry_date} last />
          )}
        </Card>

        <Button
          title={product.is_active ? 'إلغاء تفعيل المنتج' : 'تفعيل المنتج'}
          variant={product.is_active ? 'danger' : 'success'}
          onPress={toggleActive}
          fullWidth
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function unitLabel(u: string) {
  const map: Record<string, string> = { piece: 'قطعة', carton: 'كرتونة', kg: 'كغم', liter: 'لتر', meter: 'متر' };
  return map[u] || u;
}

const SectionTitle: React.FC<{ text: string }> = ({ text }) => (
  <Text style={{ fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.gray500,
                 textAlign: 'right', marginBottom: Spacing.sm }}>
    {text}
  </Text>
);

function Row({ label, value, bold, last, valueColor }: {
  label: string; value: string; bold?: boolean; last?: boolean; valueColor?: string;
}) {
  return (
    <View style={{
      flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: Colors.gray100,
    }}>
      <Text style={{ fontSize: 13, color: Colors.gray500 }}>{label}</Text>
      <Text style={{ fontSize: bold ? 17 : 14, fontWeight: bold ? '800' : '600',
                     color: valueColor || (bold ? Colors.primary : Colors.gray700) }}>
        {value}
      </Text>
    </View>
  );
}