import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { invoicesApi, reportsApi } from '../../src/api';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';

export default function InvoicesScreen() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    try {
      const data = await invoicesApi.getAll();
      setInvoices(data);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  };

  const exportPdf = async (inv: any) => {
    try {
      await reportsApi.exportInvoicePdf(inv.id);
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
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {invoices.length === 0 ? (
            <Text style={{ textAlign: 'center', color: Colors.gray400, marginTop: 40 }}>لا توجد فواتير سابقة</Text>
          ) : (
            invoices.map(inv => (
              <View key={inv.id} style={{
                backgroundColor: Colors.white, borderRadius: Radius.lg, ...Shadow.sm,
                padding: Spacing.md, marginBottom: Spacing.md,
                flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <View>
                  <Text style={{ fontSize: Fonts.sizes.md, fontWeight: 'bold', color: Colors.gray800, textAlign: 'right' }}>
                    {inv.invoice_number}
                  </Text>
                  <Text style={{ fontSize: 13, color: Colors.gray500, textAlign: 'right', marginTop: 4 }}>
                    {inv.customer?.name || 'مبيعات نقدية'} • {inv.total} ₪
                  </Text>
                  <Text style={{ fontSize: 11, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                    {new Date(inv.created_at).toLocaleDateString()}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
                  <TouchableOpacity onPress={() => exportPdf(inv)} style={{
                    backgroundColor: Colors.primaryLight || '#EEF2FF', padding: 8, borderRadius: Radius.md,
                  }}>
                    <Ionicons name="document-text-outline" size={20} color={Colors.primary} />
                  </TouchableOpacity>
                  {inv.whatsapp_url && (
                    <TouchableOpacity onPress={() => Linking.openURL(inv.whatsapp_url)} style={{
                      backgroundColor: '#E8F5E9', padding: 8, borderRadius: Radius.md,
                    }}>
                      <Ionicons name="logo-whatsapp" size={20} color={Colors.success} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
