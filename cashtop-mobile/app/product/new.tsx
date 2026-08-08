import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ProductForm, formValuesToPayload } from '../../src/components/ProductForm';
import type { ProductFormValues } from '../../src/components/ProductForm';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { upsertProduct } from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';
import { isBackendReachable } from '../../src/api/client';
import * as Crypto from 'expo-crypto';

export default function NewProductScreen() {
  const router = useRouter();
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();

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
          إضافة منتج جديد
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ProductForm
        submitLabel="حفظ المنتج"
        initialBarcode={barcode}
        onSubmit={async (values: ProductFormValues) => {
          const payload = formValuesToPayload(values);
          const local_uuid = Crypto.randomUUID();
          
          upsertProduct({
            id: local_uuid,
            name: payload.name,
            name_ar: payload.name_ar,
            barcode_piece: payload.barcode_piece,
            barcode_carton: payload.barcode_carton,
            pieces_per_carton: payload.pieces_per_carton || 0,
            cost_price: payload.cost_price || 0,
            retail_price: payload.retail_price || 0,
            carton_price: payload.carton_price || 0,
            stock_quantity: payload.stock_quantity || 0,
            tax_rate: payload.tax_rate || 0,
            is_active: payload.is_active ? 1 : 0,
            category_id: payload.category_id,
            supplier_id: payload.supplier_id,
            sync_status: 'pending_create',
            created_at: new Date().toISOString(),
          });
          
          isBackendReachable().then((online) => {
            if (online) {
              runFullSync().catch(() => {});
            }
          });

          router.replace({ pathname: '/product/[id]', params: { id: local_uuid } });
        }}
      />
    </SafeAreaView>
  );
}