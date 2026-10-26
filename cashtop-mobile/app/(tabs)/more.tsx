import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useIsAdmin } from '../../src/store/authStore';
import { Card, StatCard } from '../../src/components/ui';
import { Colors, Spacing, Fonts, Radius } from '../../src/types/theme';
import { getDashboardStats } from '../../src/db/database';
import { isBackendReachable } from '../../src/api/client';
import { runFullSync } from '../../src/db/syncManager';


interface MenuItemProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress: () => void;
  color?: string;
  badge?: string;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, subtitle, onPress, color, badge }) => (
  <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.7}>
    <Ionicons name="chevron-back" size={18} color={Colors.gray300} />
    <View style={{ flex: 1 }}>
      <Text style={[styles.itemLabel, color ? { color } : {}]}>{label}</Text>
      {subtitle && <Text style={styles.itemSub}>{subtitle}</Text>}
    </View>
    {badge && (
      <View style={styles.itemBadge}>
        <Text style={styles.itemBadgeText}>{badge}</Text>
      </View>
    )}
    <Text style={{ fontSize: 22, marginLeft: 4 }}>{icon}</Text>
  </TouchableOpacity>
);

export default function MoreScreen() {
  const { user, logout } = useAuthStore();
  const isAdmin = useIsAdmin();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(() => {
    try {
      const stats = getDashboardStats();
      setData(stats.summary);
    } catch (e) {
      console.log('Error loading stats:', e);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    loadStats();
    isBackendReachable().then(setIsOnline).catch(() => {});
  }, [loadStats]));

  const onRefresh = async () => {
    setRefreshing(true);
    const online = await isBackendReachable();
    setIsOnline(online);
    if (online) {
      await runFullSync().catch(() => {});
    }
    loadStats();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert('تسجيل الخروج', 'هل تريد تسجيل الخروج؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'خروج', style: 'destructive', onPress: logout },
    ]);
  };

  const fmt = (n: number) => n?.toLocaleString('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* ── بيانات المستخدم ─────────────────────────── */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.full_name?.charAt(0) ?? '?'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', flex: 1 }}>
            <Text style={styles.profileName}>{user?.full_name}</Text>
            <Text style={styles.profileRole}>
              {{ admin: 'مدير النظام', manager: 'مدير', cashier: 'كاشير' }[user?.role ?? 'cashier']}
            </Text>
          </View>
          <View style={{
            flexDirection: 'row-reverse', alignItems: 'center',
            backgroundColor: isOnline ? 'rgba(76, 175, 80, 0.2)' : 'rgba(244, 67, 54, 0.2)',
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
          }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isOnline ? '#4CAF50' : '#F44336', marginLeft: 6 }} />
            <Text style={{ color: 'white', fontSize: 11, fontWeight: '600' }}>
              {isOnline ? 'متصل' : 'أوفلاين'}
            </Text>
          </View>
        </View>

        {/* ── إحصائيات سريعة ─────────────────────────── */}
        {data && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>إحصائيات اليوم</Text>
            <View style={{ flexDirection: 'row-reverse', gap: Spacing.sm }}>
              <StatCard
                title="المبيعات"
                value={fmt(data?.today?.revenue ?? 0)}
                subtitle="₪"
                color={Colors.primary}
                style={{ flex: 1 }}
              />
              <StatCard
                title="الربح"
                value={fmt(data?.today?.profit ?? 0)}
                subtitle={`${data?.today?.margin?.toFixed(0) ?? 0}% هامش`}
                color={Colors.success}
                style={{ flex: 1 }}
              />
            </View>

            <View style={{ flexDirection: 'row-reverse', gap: Spacing.sm, marginTop: Spacing.sm }}>
              <StatCard
                title="ديون العملاء"
                value={fmt(data?.finance?.customers_debt ?? 0)}
                subtitle="₪ مستحقة لك"
                color={Colors.success}
                style={{ flex: 1 }}
              />
              <StatCard
                title="ديون الموردين"
                value={fmt(data?.finance?.suppliers_debt ?? 0)}
                subtitle="₪ مستحقة عليك"
                color={Colors.danger}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}

        {/* ── الإدارة ──────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>الإدارة</Text>
          <Card padding={0}>
            <MenuItem icon="📦" label="المنتجات" subtitle="إدارة المنتجات والمخزون"
              onPress={() => router.push('/(tabs)/products')} />
            <View style={styles.divider} />
            <MenuItem icon="💰" label="المالية" subtitle="الديون والتقارير المالية"
              onPress={() => router.push('/finance')} />
          </Card>
        </View>

        {/* ── التقارير ──────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>التقارير والتصدير</Text>
          <Card padding={0}>
            <MenuItem icon="🧾" label="سجل الفواتير"
              subtitle="عرض الفواتير السابقة وتصديرها"
              onPress={() => router.push('/invoices')} />
            <View style={styles.divider} />
            <MenuItem icon="📊" label="التقارير والتصدير"
              subtitle="Excel • PDF • فواتير"
              onPress={() => router.push('/reports')} />
          </Card>
        </View>

        {/* ── الإعدادات ─────────────────────────────── */}
        {isAdmin && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>الإعدادات</Text>
            <Card padding={0}>
              <MenuItem icon="👥" label="المستخدمون" subtitle="إضافة وإدارة الموظفين"
                onPress={() => router.push('/users')} />
              <View style={styles.divider} />
              <MenuItem icon="⚙️" label="إعدادات النظام" onPress={() => router.push('/settings')} />
              <View style={styles.divider} />
              <MenuItem icon="🔑" label="الاشتراك والتفعيل" subtitle="تجديد أو إدخال مفتاح التفعيل" onPress={() => router.push('/settings/activation')} />
            </Card>
          </View>
        )}

        {/* ── تسجيل الخروج ──────────────────────────── */}
        <View style={styles.section}>
          <Card padding={0}>
            <MenuItem
              icon="🚪"
              label="تسجيل الخروج"
              onPress={handleLogout}
              color={Colors.danger}
            />
          </Card>
        </View>

        <Text style={styles.version}>v1.0.1 (Offline-First) © 2025 Maksab</Text>
        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  profileSection: {
    flexDirection:  'row-reverse',
    alignItems:     'center',
    gap:            Spacing.md,
    padding:        Spacing.xl,
    backgroundColor: Colors.primary,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:    { fontSize: 24, fontWeight: '800', color: Colors.white },
  profileName:   { fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.white },
  profileRole:   { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  section:       { paddingHorizontal: Spacing.lg, marginTop: Spacing.xl },
  sectionLabel:  { fontSize: 12, fontWeight: '700', color: Colors.gray400,
                  textAlign: 'right', marginBottom: Spacing.sm, textTransform: 'uppercase' },
  item:          {
    flexDirection: 'row-reverse', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.md,
  },
  itemLabel:     { fontSize: Fonts.sizes.base, color: Colors.gray800, fontWeight: '600',
                  textAlign: 'right' },
  itemSub:       { fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 },
  divider:       { height: 1, backgroundColor: Colors.gray100, marginHorizontal: Spacing.lg },
  itemBadge:     { backgroundColor: Colors.danger, borderRadius: Radius.full,
                  paddingHorizontal: 8, paddingVertical: 2 },
  itemBadgeText: { color: Colors.white, fontSize: 11, fontWeight: '700' },
  version:       { textAlign: 'center', color: Colors.gray300, fontSize: 12,
                  marginTop: Spacing.xl },
});