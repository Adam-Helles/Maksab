import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Badge, Input, LoadingScreen } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import type { Supplier } from '../../src/types';
import {
  getSupplierCache,
  recordSupplierPaymentLocal,
  getPendingSupplierPayments,
  getPendingSupplierDebts,
  runSupplierSync,
  localSupplierToSupplier,
} from '../../src/db/supplierSync';
import { suppliersApi } from '../../src/api';

export default function SupplierStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const supplierId = Number(id);

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [statement, setStatement] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    // 1. Load from local cache immediately (offline-first)
    const cached = getSupplierCache(supplierId);
    if (cached) {
      setSupplier(localSupplierToSupplier(cached));
    }

    // 2. Try to get statement from server (non-blocking)
    try {
      const st = await suppliersApi.statement(supplierId);
      setStatement(st);
      // Also refresh supplier data from server if available
      const sup = await suppliersApi.get(supplierId);
      setSupplier(sup);
    } catch {
      // Ignore - server unavailable, use local cache
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, [load]));

  const submitPayment = () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('أدخل مبلغاً صحيحاً');
      return;
    }
    setPaying(true);
    try {
      recordSupplierPaymentLocal(supplierId, amount, 'cash');
      setShowPay(false);
      setPayAmount('');
      // Refresh local display
      const cached = getSupplierCache(supplierId);
      if (cached) setSupplier(localSupplierToSupplier(cached));
      Alert.alert('تم ✅', 'تم تسجيل الدفعة. ستتم المزامنة مع السيرفر تلقائياً.');
      // Trigger sync in background
      runSupplierSync().catch(() => {});
    } catch (e: any) {
      Alert.alert('خطأ', 'فشلت العملية');
    } finally {
      setPaying(false);
    }
  };

  if (loading && !supplier) return <LoadingScreen message="جاري تحميل كشف الحساب..." />;
  if (!supplier) return <LoadingScreen message="جاري التحميل..." />;

  // Merge local pending with server transactions
  const serverTransactions: any[] = statement?.transactions || [];
  const pendingPayments = getPendingSupplierPayments(supplierId);
  const pendingDebts = getPendingSupplierDebts(supplierId);

  const pendingTxn = [
    ...pendingPayments.map(p => ({
      type: 'دفعة (لم تُزامن بعد) ⏳',
      credit: p.amount,
      debit: 0,
      balance: null,
      date: p.client_created_at.substring(0, 10),
      isPending: true,
    })),
    ...pendingDebts.map(d => ({
      type: `دين مسجل (لم يُزامن بعد) ⏳${d.notes ? ' - ' + d.notes : ''}`,
      credit: 0,
      debit: d.amount,
      balance: null,
      date: d.client_created_at.substring(0, 10),
      isPending: true,
    })),
  ];

  const transactions = [...pendingTxn, ...serverTransactions];
  const currentDebt = statement?.current_debt ?? supplier.balance;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>كشف حساب مورد</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100 }}>
        <Card style={{ marginBottom: Spacing.lg }}>
          <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.gray800, textAlign: 'right', flex: 1 }}>
              {supplier.name}
            </Text>
            <TouchableOpacity onPress={load} style={{ padding: 6 }}>
              <Ionicons name="refresh-outline" size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {!!supplier.company && (
            <Text style={{ fontSize: 13, color: Colors.gray500, textAlign: 'right', marginTop: 2 }}>
              {supplier.company}
            </Text>
          )}
          {!!supplier.phone && (
            <Text style={{ fontSize: 13, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
              {supplier.phone}
            </Text>
          )}

          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: Spacing.md, flexWrap: 'wrap' }}>
            {currentDebt > 0
              ? <Badge label={`رصيد مستحق للمورد: ${Number(currentDebt).toFixed(2)} ₪`} color="red" />
              : <Badge label="لا يوجد رصيد مستحق" color="green" />}
          </View>
        </Card>

        <View style={{ flexDirection: 'row-reverse', gap: Spacing.md, marginBottom: Spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Button title="فاتورة مشتريات" variant="primary" fullWidth onPress={() => router.push(`/suppliers/purchase?supplierId=${supplier.id}`)} />
          </View>
          {currentDebt > 0 && (
            <View style={{ flex: 1 }}>
              <Button title="تسجيل دفعة" variant="success" fullWidth onPress={() => setShowPay(true)} />
            </View>
          )}
        </View>

        <Text style={{ fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.gray500,
                       textAlign: 'right', marginBottom: Spacing.sm }}>
          سجل الحركات
        </Text>
        {transactions.length === 0 ? (
          <Card>
            <Text style={{ textAlign: 'center', color: Colors.gray400, paddingVertical: Spacing.md }}>
              لا توجد حركات مسجلة بعد
            </Text>
          </Card>
        ) : (
          <View style={{ gap: 8 }}>
            {transactions.map((t, idx) => (
              <Card key={idx} padding={Spacing.md} style={t.isPending ? { borderWidth: 1, borderColor: Colors.warning } : {}}>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: t.isPending ? Colors.warning : Colors.gray700, flex: 1, textAlign: 'right' }}>
                    {t.type || t.reference || 'حركة'}
                  </Text>
                  <Text style={{ fontWeight: '800', color: (t.credit > 0) ? Colors.success : Colors.danger }}>
                    {t.credit > 0 ? `+ ${t.credit.toFixed(2)}` : `- ${t.debit.toFixed(2)}`} ₪
                  </Text>
                </View>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: Colors.gray400 }}>{t.date}</Text>
                  {t.balance !== null && (
                    <Text style={{ fontSize: 12, color: Colors.gray500, fontWeight: '700' }}>
                      الرصيد: {Number(t.balance).toFixed(2)}
                    </Text>
                  )}
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {showPay && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.white,
          borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing.lg,
          shadowColor: '#000', shadowOffset: { width: 0, height: -5 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 15
        }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
                         marginBottom: Spacing.md }}>
            <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.gray800 }}>تسجيل دفعة لمورد</Text>
            <TouchableOpacity onPress={() => setShowPay(false)}>
              <Ionicons name="close" size={22} color={Colors.gray500} />
            </TouchableOpacity>
          </View>
          <Input
            label={`المبلغ (المستحق: ${currentDebt.toFixed(2)} ₪)`}
            value={payAmount}
            onChangeText={setPayAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            autoFocus
          />
          <Button title="تأكيد الدفعة" onPress={submitPayment} loading={paying} fullWidth />
        </View>
      )}
    </SafeAreaView>
  );
}
