import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, Linking, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { reportsApi } from '../../src/api';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { isBackendReachable } from '../../src/api/client';
import { getAllInvoices, LocalInvoice } from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';
import { Badge } from '../../src/components/ui';

export default function InvoicesScreen() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromLocal = useCallback(() => {
    const localInvoices = getAllInvoices();
    // ترتيب تنازلي (الأحدث أولاً)
    localInvoices.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setInvoices(localInvoices);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => {
    loadFromLocal();
    
    // محاولة المزامنة
    isBackendReachable().then(online => {
      if (online) {
        runFullSync().then(() => loadFromLocal()).catch(() => {});
      }
    });
  }, [loadFromLocal]));

  const onRefresh = async () => {
    setRefreshing(true);
    const online = await isBackendReachable();
    if (online) {
      await runFullSync().catch(() => {});
    }
    loadFromLocal();
  };

  const exportPdf = async (invId: string) => {
    const online = await isBackendReachable();
    if (!online) {
      Alert.alert('غير متصل', 'تصدير PDF يحتاج إلى اتصال بالإنترنت.');
      return;
    }
    try {
      await reportsApi.exportInvoicePdf(invId as any);
    } catch (e: any) {
      Alert.alert('خطأ', e.message || 'فشل التصدير');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          🧾 سجل الفواتير
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 50 }} />
      ) : invoices.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ textAlign: 'center', color: Colors.gray400 }}>لا توجد فواتير سابقة</Text>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          renderItem={({ item: inv }) => (
            <TouchableOpacity onPress={() => router.push(`/invoices/${inv.id}`)} style={{
              backgroundColor: Colors.white, borderRadius: Radius.lg, ...Shadow.sm,
              padding: Spacing.md, marginBottom: Spacing.md,
              flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center'
            }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: Fonts.sizes.base, fontWeight: 'bold', color: Colors.gray800, textAlign: 'right' }}>
                    {inv.invoice_number || 'معلّقة'}
                  </Text>
                  {inv.sync_status !== 'synced' && (
                    <Badge label="أوفلاين" color="blue" />
                  )}
                </View>
                <Text style={{ fontSize: 13, color: Colors.gray500, textAlign: 'right', marginTop: 4 }}>
                  {inv.customer_name || 'مبيعات نقدية'} • {inv.total.toFixed(2)} ₪
                </Text>
                <Text style={{ fontSize: 11, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                  {new Date(inv.created_at).toLocaleString('ar')}
                </Text>
              </View>

              <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                <TouchableOpacity onPress={() => exportPdf(inv.id)} style={{
                  backgroundColor: Colors.primaryLight || '#EEF2FF', padding: 8, borderRadius: Radius.md,
                }}>
                  <Ionicons name="document-text-outline" size={20} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
