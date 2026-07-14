import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, RefreshControl,
  StyleSheet, TouchableOpacity, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi } from '../../src/api';
import { useAuthStore } from '../../src/store/authStore';
import { StatCard, Card, LoadingScreen, Badge } from '../../src/components/ui';
import { Colors, Spacing, Fonts, Radius } from '../../src/types/theme';
import type { DashboardSummary } from '../../src/types';

const { width } = Dimensions.get('window');

export default function DashboardScreen() {
  const [data,      setData]      = useState<DashboardSummary | null>(null);
  const [topProds,  setTopProds]  = useState<any>(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user, logout } = useAuthStore();

  const fetch = useCallback(async () => {
    try {
      const [summary, tops] = await Promise.all([
        dashboardApi.summary(),
        dashboardApi.chartTopProducts(30, 5),
      ]);
      setData(summary);
      setTopProds(tops);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetch(); }, []);

  const onRefresh = () => { setRefreshing(true); fetch(); };

  if (loading) return <LoadingScreen message="جاري التحميل..." />;

  const fmt = (n: number) => n.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ──────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={styles.greeting}>مرحباً، {user?.full_name} 👋</Text>
          <Text style={styles.headerSub}>لوحة التحكم</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* ── بطاقات اليوم ─────────────────────────────── */}
        <Text style={styles.sectionTitle}>إحصائيات اليوم</Text>
        <View style={styles.statsRow}>
          <StatCard
            title="المبيعات"
            value={fmt(data?.today.revenue ?? 0)}
            subtitle="₪"
            change={data?.today.revenue_change_pct}
            color={Colors.primary}
            style={{ flex: 1 }}
          />
          <StatCard
            title="الربح"
            value={fmt(data?.today.profit ?? 0)}
            subtitle={`${data?.today.margin ?? 0}% هامش`}
            change={data?.today.profit_change_pct}
            color={Colors.success}
            style={{ flex: 1 }}
          />
        </View>
        <View style={[styles.statsRow, { marginTop: Spacing.sm }]}>
          <StatCard
            title="الفواتير"
            value={String(data?.today.count ?? 0)}
            subtitle="فاتورة اليوم"
            change={data?.today.orders_change_pct}
            style={{ flex: 1 }}
          />
          <StatCard
            title="المقبوض"
            value={fmt(data?.today.collected ?? 0)}
            subtitle="₪ نقداً"
            style={{ flex: 1 }}
          />
        </View>

        {/* ── الشهر ─────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: Spacing.xl }]}>هذا الشهر</Text>
        <Card style={styles.monthCard}>
          <View style={styles.monthRow}>
            <View style={styles.monthStat}>
              <Text style={styles.monthVal}>{fmt(data?.month.revenue ?? 0)}</Text>
              <Text style={styles.monthLabel}>إجمالي المبيعات ₪</Text>
            </View>
            <View style={[styles.monthStat, { borderRightWidth: 1, borderRightColor: Colors.gray200 }]}>
              <Text style={[styles.monthVal, { color: Colors.success }]}>{fmt(data?.month.profit ?? 0)}</Text>
              <Text style={styles.monthLabel}>صافي الربح ₪</Text>
            </View>
          </View>
        </Card>

        {/* ── التنبيهات ─────────────────────────────────── */}
        {data && (
          (data.alerts.low_stock > 0 || data.alerts.out_stock > 0 ||
           data.alerts.drafts > 0 || data.alerts.unpaid > 0) && (
          <View style={{ marginTop: Spacing.xl }}>
            <Text style={styles.sectionTitle}>⚠️ التنبيهات</Text>
            <Card>
              <View style={{ gap: Spacing.md }}>
                {data.alerts.out_stock > 0 && (
                  <AlertRow icon="❌" label="منتجات نفذت" count={data.alerts.out_stock} color="red" />
                )}
                {data.alerts.low_stock > 0 && (
                  <AlertRow icon="⚠️" label="مخزون منخفض" count={data.alerts.low_stock} color="yellow" />
                )}
                {data.alerts.unpaid > 0 && (
                  <AlertRow icon="💳" label="فواتير غير مسددة" count={data.alerts.unpaid} color="red" />
                )}
                {data.alerts.drafts > 0 && (
                  <AlertRow icon="📋" label="فواتير معلّقة" count={data.alerts.drafts} color="blue" />
                )}
              </View>
            </Card>
          </View>
        ))}

        {/* ── المخزون ───────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: Spacing.xl }]}>المخزون</Text>
        <Card>
          <View style={styles.invRow}>
            <InvStat label="المنتجات" value={data?.inventory.total_products ?? 0} />
            <InvStat label="قيمة المخزون" value={`${fmt(data?.inventory.stock_value ?? 0)} ₪`} />
            <InvStat label="منخفض" value={data?.inventory.low_stock_count ?? 0} warn />
          </View>
        </Card>

        {/* ── أعلى المنتجات ─────────────────────────────── */}
        {topProds?.labels?.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: Spacing.xl }]}>أعلى المنتجات مبيعاً</Text>
            <Card>
              {topProds.labels.map((name: string, i: number) => (
                <View key={i} style={[styles.topRow,
                  i < topProds.labels.length - 1 && styles.topRowBorder]}>
                  <Text style={styles.topRevenue}>{fmt(topProds.revenue[i])} ₪</Text>
                  <Text style={styles.topName} numberOfLines={1}>{name}</Text>
                  <View style={styles.topRank}>
                    <Text style={styles.topRankText}>{i + 1}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </>
        )}

        {/* ── المركز المالي ─────────────────────────────── */}
        <Text style={[styles.sectionTitle, { marginTop: Spacing.xl }]}>المركز المالي</Text>
        <View style={styles.statsRow}>
          <StatCard
            title="ديون العملاء"
            value={fmt(data?.finance.customers_debt ?? 0)}
            subtitle="₪ مستحقة لك"
            color={Colors.success}
            style={{ flex: 1 }}
          />
          <StatCard
            title="ديون الموردين"
            value={fmt(data?.finance.suppliers_debt ?? 0)}
            subtitle="₪ مستحقة عليك"
            color={Colors.danger}
            style={{ flex: 1 }}
          />
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── مساعدات ─────────────────────────────────────────────
const AlertRow = ({ icon, label, count, color }: any) => (
  <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 8 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ fontSize: 14, color: Colors.gray700, fontWeight: '500' }}>{label}</Text>
    </View>
    <Badge label={String(count)} color={color} />
  </View>
);

const InvStat = ({ label, value, warn }: any) => (
  <View style={{ alignItems: 'center', flex: 1 }}>
    <Text style={{ fontSize: 20, fontWeight: '800',
                   color: warn && value > 0 ? Colors.warning : Colors.primary }}>
      {value}
    </Text>
    <Text style={{ fontSize: 11, color: Colors.gray500, marginTop: 3 }}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: Colors.primary },
  header:       {
    flexDirection: 'row-reverse', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    paddingBottom: Spacing.xl, backgroundColor: Colors.primary,
  },
  greeting:     { fontSize: Fonts.sizes.lg, fontWeight: '700', color: Colors.white },
  headerSub:    { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  logoutBtn:    { padding: 8 },
  content:      { padding: Spacing.lg, backgroundColor: Colors.background, minHeight: '100%' },
  sectionTitle: { fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray700,
                  textAlign: 'right', marginBottom: Spacing.sm },
  statsRow:     { flexDirection: 'row-reverse', gap: Spacing.sm },
  monthCard:    {},
  monthRow:     { flexDirection: 'row-reverse' },
  monthStat:    { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm },
  monthVal:     { fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary },
  monthLabel:   { fontSize: 11, color: Colors.gray400, marginTop: 4 },
  invRow:       { flexDirection: 'row-reverse', justifyContent: 'space-around',
                  paddingVertical: Spacing.sm },
  topRow:       { flexDirection: 'row-reverse', alignItems: 'center',
                  paddingVertical: Spacing.md, gap: Spacing.sm },
  topRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.gray100 },
  topRank:      { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primary,
                  alignItems: 'center', justifyContent: 'center' },
  topRankText:  { color: Colors.white, fontSize: 13, fontWeight: '800' },
  topName:      { flex: 1, fontSize: 14, color: Colors.gray700, textAlign: 'right', fontWeight: '500' },
  topRevenue:   { fontSize: 13, color: Colors.success, fontWeight: '700' },
});
