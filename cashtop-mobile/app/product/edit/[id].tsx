import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ProductForm, productToFormValues, formValuesToPayload, type ProductFormValues } from '../../../src/components/ProductForm';
import { LoadingScreen } from '../../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../../src/types/theme';
import { getProductById, upsertProduct, LocalProduct } from '../../../src/db/database';
import { runFullSync } from '../../../src/db/syncManager';
import { isBackendReachable } from '../../../src/api/client';
import type { Product } from '../../../src/types';

function localToProduct(p: LocalProduct): Product {
  return {
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
  };
}

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const productId = Number(id);

  const [initialValues, setInitialValues] = useState<ProductFormValues | null>(null);

  useEffect(() => {
    const local = getProductById(id);
    if (local) {
      setInitialValues(productToFormValues(localToProduct(local)));
    } else {
       Alert.alert('خطأ', 'تعذّر إيجاد المنتج محلياً');
       router.back();
    }
  }, [id]);

  if (!initialValues) return <LoadingScreen message="جاري تحميل بيانات المنتج..." />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
          تعديل المنتج
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ProductForm
        initialValues={initialValues}
        submitLabel="حفظ التعديلات"
        onSubmit={async (values: ProductFormValues) => {
          const payload = formValuesToPayload(values);
          const local = getProductById(id);
          
          if (local) {
            upsertProduct({
              ...local,
              name: payload.name,
              name_ar: payload.name_ar,
              barcode_piece: payload.barcode_piece,
              barcode_carton: payload.barcode_carton,
              retail_price: payload.retail_price || 0,
              carton_price: payload.carton_price || 0,
              cost_price: payload.cost_price || 0,
              tax_rate: payload.tax_rate || 0,
              pieces_per_carton: payload.pieces_per_carton || 0,
              is_active: payload.is_active ? 1 : 0,
              sync_status: 'pending_update',
            });
          }

          isBackendReachable().then((online) => {
            if (online) {
              runFullSync().catch(() => {});
            }
          });

          router.replace({ pathname: '/product/[id]', params: { id: id } });
        }}
      />
    </SafeAreaView>
  );
}