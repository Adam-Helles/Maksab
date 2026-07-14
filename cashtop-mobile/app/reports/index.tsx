import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Card } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import { reportsApi } from '../../src/api/reports';
import { useIsManager } from '../../src/store/authStore';

export default function ReportsScreen() {
  const router = useRouter();
  const isManager = useIsManager();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<void>) => {
    setLoadingKey(key);
    try {
      await action();
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 403) {
        Alert.alert('صلاحية غير كافية', 'هذا التقرير متاح للمدير فقط');
      } else {
        Alert.alert('خطأ', e?.response?.data?.detail || 'تعذّر إنشاء الملف');
      }
    } finally {
      setLoadingKey(null);
    }
  };

  const from = dateFrom.trim() || undefined;
  const to = dateTo.trim() || undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          📊 التقارير والتصدير
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.gray500,
                       textAlign: 'right', marginBottom: Spacing.sm }}>
          فترة التقرير (اختياري — اتركها فارغة لكل الفترات)
        </Text>
        <Card style={{ marginBottom: Spacing.lg }}>
          <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Input label="من تاريخ" value={dateFrom} onChangeText={setDateFrom} placeholder="2026-01-01" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="إلى تاريخ" value={dateTo} onChangeText={setDateTo} placeholder="2026-07-04" />
            </View>
          </View>
        </Card>

        <SectionTitle text="تصدير Excel" />
        <Card style={{ marginBottom: Spacing.lg, gap: 4 }} padding={0}>
          <ReportRow
            icon="apps-outline" label="تقرير شامل" subtitle="مبيعات + مخزون + ديون (4 أوراق)"
            loading={loadingKey === 'full'} locked={!isManager}
            onPress={() => run('full', () => reportsApi.exportExcel('full', from, to))}
          />
          <Divider />
          <ReportRow
            icon="cart-outline" label="المبيعات فقط"
            loading={loadingKey === 'sales'}
            onPress={() => run('sales', () => reportsApi.exportSalesExcel(from, to))}
          />
          <Divider />
          <ReportRow
            icon="cube-outline" label="المخزون فقط"
            loading={loadingKey === 'inventory'} locked={!isManager}
            onPress={() => run('inventory', () => reportsApi.exportInventoryExcel())}
          />
          <Divider />
          <ReportRow
            icon="cash-outline" label="الديون فقط"
            loading={loadingKey === 'debts'} locked={!isManager}
            onPress={() => run('debts', () => reportsApi.exportDebtsExcel())}
          />
        </Card>

        <SectionTitle text="تصدير PDF" />
        <Card padding={0}>
          <ReportRow
            icon="document-text-outline" label="تقرير مبيعات PDF" subtitle="جاهز للطباعة أو المشاركة"
            loading={loadingKey === 'pdf-sales'} locked={!isManager}
            onPress={() => run('pdf-sales', () => reportsApi.exportSalesPdf(from, to))}
          />
        </Card>

        <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'center', marginTop: Spacing.xl }}>
          فواتير المبيعات الفردية (PDF) تُصدَّر من داخل شاشة تفاصيل كل فاتورة
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.gray500,
                   textAlign: 'right', marginBottom: Spacing.sm }}>
      {text}
    </Text>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.gray100, marginHorizontal: Spacing.lg }} />;
}

function ReportRow({ icon, label, subtitle, onPress, loading, locked }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress: () => void;
  loading?: boolean;
  locked?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={locked ? undefined : onPress}
      activeOpacity={locked ? 1 : 0.7}
      style={{
        flexDirection: 'row-reverse', alignItems: 'center', gap: Spacing.md,
        paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, opacity: locked ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon} size={20} color={Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '600', color: Colors.gray800, textAlign: 'right' }}>
          {label}
        </Text>
        {subtitle && (
          <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : locked ? (
        <Ionicons name="lock-closed-outline" size={16} color={Colors.gray300} />
      ) : (
        <Ionicons name="share-outline" size={18} color={Colors.gray300} />
      )}
    </TouchableOpacity>
  );
}