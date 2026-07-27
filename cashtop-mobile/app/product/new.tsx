import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ProductForm, formValuesToPayload } from '../../src/components/ProductForm';
import type { ProductFormValues } from '../../src/components/ProductForm';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { productsApi } from '../../src/api';
import { recordNewProductLocal, runProductSync } from '../../src/db/productsCache';
import { useNetInfo } from '@react-native-community/netinfo';

export default function NewProductScreen() {
  const router = useRouter();
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();

  const netInfo = useNetInfo();

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
          const local_uuid = recordNewProductLocal(payload as any);
          
          if (netInfo.isConnected) {
            runProductSync().catch(() => {});
          }

          // Generate a fake numeric ID to redirect to details page or just go back
          const fakeId = -1 * parseInt(local_uuid.substring(0, 8), 16);
          router.replace({ pathname: '/product/[id]', params: { id: String(fakeId) } });
        }}
      />
    </SafeAreaView>
  );
}