import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { dashboardApi } from '../../src/api';
import type { DashboardSummary } from '../../src/types';

import { financeApi } from '../../src/api/reports';

export default function FinanceScreen() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // أعد حساب الأرصدة أولاً قبل جلب الملخص
      await financeApi.repairDebts().catch(() => {});
      const data = await dashboardApi.summary();
      setSummary(data);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  const handleRepair = async () => {
    setRepairing(true);
    try {
      const result = await financeApi.repairDebts();
      const data   = await dashboardApi.summary();
      setSummary(data);
      Alert.alert('تم الإصلاح ✅', `تم تصحيح ${result.fixed_count} رصيد عميل من الفواتير الفعلية`);
    } catch {
      Alert.alert('خطأ', 'تعذّر إصلاح الأرصدة، تحقق من الاتصال بالسيرفر');
    } finally {
      setRepairing(false);
    }
  };

  const f = summary?.finance;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          💰 المالية
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          {/* الملخص */}
          <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg }}>
            <FinanceCard
              icon="people-outline"
              label="ديون العملاء"
              value={`${(f?.customers_debt ?? 0).toFixed(2)} ₪`}
              color={Colors.danger}
              onPress={() => router.push('/customers')}
            />
            <FinanceCard
              icon="cube-outline"
              label="مستحقات الموردين"
              value={`${(f?.suppliers_debt ?? 0).toFixed(2)} ₪`}
              color={Colors.warning}
              onPress={() => router.push('/suppliers')}
            />
            <FinanceCard
              icon="trending-up-outline"
              label="صافي المستحق لنا"
              value={`${(f?.net_receivable ?? 0).toFixed(2)} ₪`}
              color={Colors.success}
              full
            />
            <FinanceCard
              icon="person-outline"
              label="عدد العملاء"
              value={`${f?.total_customers ?? 0}`}
              color={Colors.info}
              full
            />
          </View>

          {/* روابط سريعة */}
          <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.gray500,
                         textAlign: 'right', marginBottom: Spacing.sm }}>
            إجراءات سريعة
          </Text>
          <Card padding={0}>
            <QuickLink icon="people-outline" label="عرض ديون العملاء" onPress={() => router.push('/customers')} />
            <Divider />
            <QuickLink icon="cube-outline" label="عرض مستحقات الموردين" onPress={() => router.push('/suppliers')} />
            <Divider />
            <QuickLink icon="download-outline" label="تصدير تقرير الديون" onPress={() => router.push('/reports')} />
            <Divider />
            <TouchableOpacity
              onPress={handleRepair}
              disabled={repairing}
              style={{
                flexDirection: 'row-reverse', alignItems: 'center', gap: Spacing.md,
                padding: Spacing.lg, opacity: repairing ? 0.5 : 1,
              }}
            >
              {repairing
                ? <ActivityIndicator size="small" color={Colors.warning} />
                : <Ionicons name="refresh-outline" size={20} color={Colors.warning} />}
              <Text style={{ flex: 1, fontWeight: '600', color: Colors.warning, textAlign: 'right' }}>
                إصلاح أرصدة الديون تلقائياً
              </Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function FinanceCard({ icon, label, value, color, onPress, full }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: string; color: string;
  onPress?: () => void; full?: boolean;
}) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress} style={{
      width: full ? '100%' : '47%', backgroundColor: Colors.white, borderRadius: Radius.lg,
      padding: Spacing.md, ...Shadow.sm,
    }}>
      <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
        <Ionicons name={icon} size={20} color={color} />
        {onPress && <Ionicons name="chevron-back" size={14} color={Colors.gray300} />}
      </View>
      <Text style={{ fontSize: 12, color: Colors.gray500, textAlign: 'right', marginTop: 8 }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color, textAlign: 'right', marginTop: 2 }}>{value}</Text>
    </Wrapper>
  );
}

function QuickLink({ icon, label, onPress }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={{
      flexDirection: 'row-reverse', alignItems: 'center', gap: Spacing.md,
      padding: Spacing.lg,
    }}>
      <Ionicons name={icon} size={20} color={Colors.primary} />
      <Text style={{ flex: 1, fontWeight: '600', color: Colors.gray800, textAlign: 'right' }}>{label}</Text>
      <Ionicons name="chevron-back" size={16} color={Colors.gray300} />
    </TouchableOpacity>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.gray100, marginHorizontal: Spacing.lg }} />;
}