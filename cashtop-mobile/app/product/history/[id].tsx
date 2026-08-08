import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, LoadingScreen } from '../../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../../src/types/theme';
import { productsApi } from '../../../src/api';
import { getProductById } from '../../../src/db/database';
import { isBackendReachable } from '../../../src/api/client';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

export default function ProductStockHistoryScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);

  const [product, setProduct] = useState<any>(null);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const localProd = getProductById(id);
        if (localProd) {
          setProduct(localProd);
        }

        const online = await isBackendReachable();
        if (!online) {
          setIsOffline(true);
          setLoading(false);
          return;
        }

        if (!localProd) {
          const prod = await productsApi.get(productId);
          setProduct(prod);
        }
        
        const movs = await productsApi.getMovements(productId);
        setMovements(movs);
      } catch (e) {
        Alert.alert('خطأ', 'فشل تحميل سجل الحركات');
        router.back();
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [productId]);

  if (loading || !product) return <LoadingScreen message="جاري التحميل..." />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
          سجل الحركات: {product.name}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100 }}>
        
        <Card style={{ marginBottom: Spacing.md, backgroundColor: '#F8FAFC' }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray700 }}>الكمية الحالية المتوفرة:</Text>
            <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
              {product.stock_quantity}
            </Text>
          </View>
        </Card>

        {isOffline ? (
          <View style={{ alignItems: 'center', marginTop: 40, padding: 20, backgroundColor: Colors.white, borderRadius: Radius.lg }}>
            <Ionicons name="cloud-offline-outline" size={48} color={Colors.gray400} />
            <Text style={{ textAlign: 'center', color: Colors.gray600, marginTop: 12, fontWeight: '700' }}>
              يتطلب اتصال بالإنترنت لعرض حركة المخزون بالتفصيل
            </Text>
          </View>
        ) : movements.length === 0 ? (
          <Text style={{ textAlign: 'center', color: Colors.gray400, marginTop: 40 }}>لا توجد حركات مسجلة</Text>
        ) : (
          movements.map((mov: any) => (
            <Card key={mov.id} style={{ marginBottom: Spacing.sm }}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: Colors.gray800 }}>
                  {formatMovementType(mov.movement_type)}
                </Text>
                <Text style={{ fontWeight: '800', color: mov.quantity > 0 ? Colors.success : Colors.danger, direction: 'ltr' }}>
                  {mov.quantity > 0 ? '+' : ''}{mov.quantity}
                </Text>
              </View>
              <Text style={{ color: Colors.gray500, textAlign: 'right', marginTop: 4, fontSize: 13 }}>
                {format(new Date(mov.created_at), 'yyyy-MM-dd HH:mm', { locale: ar })}
              </Text>
              {!!mov.notes && (
                <Text style={{ color: Colors.gray400, textAlign: 'right', marginTop: 2, fontSize: 12 }}>
                  ملاحظات: {mov.notes}
                </Text>
              )}
            </Card>
          ))
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

function formatMovementType(type: string) {
  const map: any = {
    'sale': 'مبيعات',
    'purchase': 'مشتريات',
    'adjustment': 'تعديل يدوي',
    'return_from_customer': 'مرتجع من عميل',
    'return_to_supplier': 'مرتجع لمورد',
    'initial': 'رصيد افتتاحي',
  };
  return map[type] || type;
}
