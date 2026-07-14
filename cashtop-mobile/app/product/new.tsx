import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ProductForm, formValuesToPayload } from '../../src/components/ProductForm';
import type { ProductFormValues } from '../../src/components/ProductForm';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { productsApi } from '../../src/api';

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
          const created = await productsApi.create(payload);
          router.replace({ pathname: '/product/[id]', params: { id: String(created.id) } });
        }}
      />
    </SafeAreaView>
  );
}