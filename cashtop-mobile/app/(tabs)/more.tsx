import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useIsAdmin } from '../../src/store/authStore';
import { Card } from '../../src/components/ui';
import { Colors, Spacing, Fonts, Radius } from '../../src/types/theme';


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

  const handleLogout = () => {
    Alert.alert('تسجيل الخروج', 'هل تريد تسجيل الخروج؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'خروج', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* ── بيانات المستخدم ─────────────────────────── */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.full_name?.charAt(0) ?? '?'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.profileName}>{user?.full_name}</Text>
            <Text style={styles.profileRole}>
              {{ admin: 'مدير النظام', manager: 'مدير', cashier: 'كاشير' }[user?.role ?? 'cashier']}
            </Text>
          </View>
        </View>

        {/* ── القسم الرئيسي ──────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>الإدارة</Text>
          <Card padding={0}>
            <MenuItem icon="👤" label="العملاء" subtitle="إدارة العملاء والديون"
              onPress={() => router.push('/customers')} />
            <View style={styles.divider} />
            <MenuItem icon="🏭" label="الموردون" subtitle="إدارة الموردين والمشتريات"
              onPress={() => router.push('/suppliers')} />
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

        <Text style={styles.version}>v1.0.0 © 2025 Maksab</Text>
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