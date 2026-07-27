import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ProductForm, productToFormValues, formValuesToPayload } from '../../../src/components/ProductForm';
import { LoadingScreen } from '../../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../../src/types/theme';
import { productsApi } from '../../../src/api';
import type { Product } from '../../../src/types';
import type { ProductFormValues } from '../../../src/components/ProductForm';
import { getProductCache, localProductToProduct, updateProductLocal, runProductSync } from '../../../src/db/productsCache';
import { isBackendReachable } from '../../../src/api/client';

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const productId = Number(id);

  const [initialValues, setInitialValues] = useState<ProductFormValues | null>(null);

  useEffect(() => {
    const local = getProductCache(productId);
    if (local) {
      setInitialValues(productToFormValues(localProductToProduct(local)));
    } else if (productId > 0) {
      productsApi.get(productId)
        .then((p: Product) => setInitialValues(productToFormValues(p)))
        .catch(() => {
          Alert.alert('خطأ', 'تعذّر تحميل بيانات المنتج');
          router.back();
        });
    } else {
       Alert.alert('خطأ', 'تعذّر إيجاد المنتج محلياً');
       router.back();
    }
  }, [productId]);

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
          
          updateProductLocal(productId, {
             name: payload.name,
             name_ar: payload.name_ar,
             barcode_piece: payload.barcode_piece,
             barcode_carton: payload.barcode_carton,
             retail_price: payload.retail_price,
             carton_price: payload.carton_price,
             cost_price: payload.cost_price,
             tax_rate: payload.tax_rate,
             pieces_per_carton: payload.pieces_per_carton,
             is_active: payload.is_active ? 1 : 0
          } as any);

          isBackendReachable().then((online) => {
            if (online) {
              runProductSync().catch(() => {});
            }
          });

          router.replace({ pathname: '/product/[id]', params: { id: String(productId) } });
        }}
      />
    </SafeAreaView>
  );
}