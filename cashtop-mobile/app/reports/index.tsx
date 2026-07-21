import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
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
      const msg = e?.message || 'تعذّر إنشاء الملف';
      const isWakingUp = msg.startsWith('⏳');
      Alert.alert(
        isWakingUp ? '⏳ جاري تشغيل الخادم' : 'خطأ في التصدير',
        isWakingUp
          ? 'الخادم يستيقظ من وضع السكون.\nانتظر 20-30 ثانية ثم أعد المحاولة.'
          : msg,
        [{ text: 'حسناً' }]
      );
    } finally {
      setLoadingKey(null);
    }
  };

  const from = dateFrom.trim() || undefined;
  const to   = dateTo.trim() || undefined;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      {/* Header */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border,
        backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          📊 التقارير والتصدير
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 40 }}>

        {/* ─── فترة التقرير ─────────────────────────────────── */}
        <SectionHeader title="🗓️ فترة التقرير" subtitle="اتركها فارغة لتصدير كل البيانات" />
        <View style={styles.card}>
          <View style={{ flexDirection: 'row-reverse', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Input label="من تاريخ" value={dateFrom} onChangeText={setDateFrom}
                     placeholder="2026-01-01" />
            </View>
            <View style={{ flex: 1 }}>
              <Input label="إلى تاريخ" value={dateTo} onChangeText={setDateTo}
                     placeholder="2026-12-31" />
            </View>
          </View>
        </View>

        {/* ─── تصدير Excel ──────────────────────────────────── */}
        <SectionHeader
          title="📗 تصدير Excel"
          subtitle="ملف Excel منظم بأوراق متعددة — للتحليل والأرشفة"
          color="#1B6E3E"
        />
        <View style={styles.card}>
          <ExportRow
            icon="apps-outline"
            label="تقرير شامل"
            subtitle="مبيعات + مخزون + ديون العملاء + ديون الموردين (4 أوراق)"
            color="#1B6E3E"
            loading={loadingKey === 'full'}
            locked={!isManager}
            onPress={() => run('full', () => reportsApi.exportExcel('full', from, to))}
          />
          <Divider />
          <ExportRow
            icon="cart-outline"
            label="المبيعات فقط"
            subtitle="جميع الفواتير المكتملة في الفترة المحددة"
            color="#1B6E3E"
            loading={loadingKey === 'sales'}
            onPress={() => run('sales', () => reportsApi.exportSalesExcel(from, to))}
          />
          <Divider />
          <ExportRow
            icon="cube-outline"
            label="المخزون فقط"
            subtitle="قائمة المنتجات مع الكميات والأسعار وقيم المخزون"
            color="#1B6E3E"
            loading={loadingKey === 'inventory'}
            locked={!isManager}
            onPress={() => run('inventory', () => reportsApi.exportInventoryExcel())}
          />
          <Divider />
          <ExportRow
            icon="cash-outline"
            label="الديون فقط"
            subtitle="ديون العملاء + ديون الموردين المستحقة"
            color="#1B6E3E"
            loading={loadingKey === 'debts'}
            locked={!isManager}
            onPress={() => run('debts', () => reportsApi.exportDebtsExcel())}
          />
        </View>

        {/* ─── تصدير PDF ────────────────────────────────────── */}
        <SectionHeader
          title="📕 تصدير PDF"
          subtitle="ملف PDF جاهز للطباعة أو الإرسال عبر واتساب"
          color="#8B0000"
        />
        <View style={styles.card}>
          <ExportRow
            icon="document-text-outline"
            label="تقرير المبيعات الشامل"
            subtitle="جميع فواتير الفترة مع الملخص المالي الكامل"
            color="#8B0000"
            loading={loadingKey === 'pdf-sales'}
            locked={!isManager}
            onPress={() => run('pdf-sales', () => reportsApi.exportSalesPdf(from, to))}
          />
        </View>

        {/* ─── تلميح ────────────────────────────────────────── */}
        <View style={styles.tip}>
          <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
          <Text style={styles.tipText}>
            لتصدير فاتورة مبيعات فردية كـ PDF، افتح تفاصيل الفاتورة من شاشة الفواتير
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ── مكونات مساعدة ─────────────────────────────────────────

function SectionHeader({ title, subtitle, color }: {
  title: string; subtitle?: string; color?: string;
}) {
  return (
    <View style={{ marginBottom: Spacing.sm, marginTop: Spacing.lg }}>
      <Text style={{
        fontSize: Fonts.sizes.base, fontWeight: '800',
        color: color || Colors.gray800, textAlign: 'right',
      }}>
        {title}
      </Text>
      {subtitle && (
        <Text style={{
          fontSize: 12, color: Colors.gray400,
          textAlign: 'right', marginTop: 2,
        }}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function Divider() {
  return (
    <View style={{ height: 1, backgroundColor: Colors.gray100, marginHorizontal: Spacing.lg }} />
  );
}

function ExportRow({
  icon, label, subtitle, color, onPress, loading, locked,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  color: string;
  onPress: () => void;
  loading?: boolean;
  locked?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={locked ? () => Alert.alert('صلاحيات محدودة', 'هذا التقرير للمدير فقط') : onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row-reverse', alignItems: 'center',
        paddingHorizontal: Spacing.lg, paddingVertical: 14,
        opacity: locked ? 0.55 : 1,
      }}
    >
      {/* أيقونة يسار */}
      <View style={{
        width: 40, height: 40, borderRadius: Radius.md,
        backgroundColor: color + '18',
        alignItems: 'center', justifyContent: 'center', marginLeft: Spacing.md,
      }}>
        <Ionicons name={icon} size={20} color={color} />
      </View>

      {/* نص */}
      <View style={{ flex: 1 }}>
        <Text style={{
          fontSize: Fonts.sizes.base, fontWeight: '700',
          color: Colors.gray800, textAlign: 'right',
        }}>
          {label}
        </Text>
        {subtitle && (
          <Text style={{
            fontSize: 11, color: Colors.gray400,
            textAlign: 'right', marginTop: 2, lineHeight: 16,
          }}>
            {subtitle}
          </Text>
        )}
      </View>

      {/* حالة يمين */}
      <View style={{
        width: 32, height: 32, borderRadius: Radius.md,
        backgroundColor: locked ? Colors.gray100 : color + '12',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {loading ? (
          <ActivityIndicator size="small" color={color} />
        ) : locked ? (
          <Ionicons name="lock-closed-outline" size={15} color={Colors.gray400} />
        ) : (
          <Ionicons name="share-outline" size={17} color={color} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = {
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    ...Shadow.sm,
    overflow: 'hidden' as const,
    marginBottom: Spacing.sm,
  },
  tip: {
    flexDirection: 'row-reverse' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    backgroundColor: Colors.primaryLight || '#EEF2FF',
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.xl,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: Colors.primary,
    textAlign: 'right' as const,
    lineHeight: 18,
  },
};