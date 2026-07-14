import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Badge, Input, LoadingScreen } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import { customersApi } from '../../src/api';
import {
  getCustomerCache,
  getPendingPayments,
  recordPaymentLocal,
  updateCustomerProfileLocal,
  runCustomerSync,
  type LocalCustomer,
  type LocalPendingPayment,
} from '../../src/db/customerSync';

export default function CustomerStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const customerId = Number(id);

  const [customer, setCustomer] = useState<LocalCustomer | null>(null);
  const [pendingPayments, setPendingPayments] = useState<LocalPendingPayment[]>([]);
  const [statement, setStatement] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'offline' | 'synced' | 'syncing'>('syncing');
  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

  // ── تعديل بيانات العميل ────────────────────────────────
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPhone2, setEditPhone2] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setSyncStatus('syncing');

    // 1) حاول تزامن أول (بيحدّث current_debt الحقيقي من السيرفر، وبيدفع
    //    أي تعديل بروفايل محلي معلّق — بما فيه تعديل بيانات العميل)
    try {
      await runCustomerSync();
      setSyncStatus('synced');
    } catch {
      // ما في نت أو فشلت المزامنة — بنكمل بالبيانات المحلية المخزّنة
      setSyncStatus('offline');
    }

    // 2) اقرأ من الكاش المحلي دائماً (سواء نجحت المزامنة أو لأ)
    const cached = getCustomerCache(customerId);
    setCustomer(cached);
    setPendingPayments(getPendingPayments(customerId));

    // 3) كشف الحساب التفصيلي (سجل الفواتير) — أونلاين فقط حالياً
    try {
      const s = await customersApi.statement(customerId);
      setStatement(s);
    } catch {
      setStatement(null);
    }

    setLoading(false);
  }, [customerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submitPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('أدخل مبلغاً صحيحاً');
      return;
    }
    setPaying(true);
    try {
      recordPaymentLocal(customerId, amount, 'cash');
      setShowPay(false);
      setPayAmount('');
      await load();
      Alert.alert(
        'تم تسجيل الدفعة ✅',
        syncStatus === 'offline' ? 'رح تنزامن تلقائياً أول ما يتوفر نت' : undefined
      );
    } finally {
      setPaying(false);
    }
  };

  const openEdit = () => {
    if (!customer) return;
    setEditName(customer.name ?? '');
    setEditPhone(customer.phone ?? '');
    setEditPhone2(customer.phone2 ?? '');
    setEditEmail(customer.email ?? '');
    setEditAddress(customer.address ?? '');
    setEditNotes(customer.notes ?? '');
    setShowEdit(true);
  };

  const submitEdit = async () => {
    if (!editName.trim()) {
      Alert.alert('الاسم مطلوب');
      return;
    }
    setSaving(true);
    try {
      updateCustomerProfileLocal(customerId, {
        name: editName.trim(),
        phone: editPhone.trim() || null,
        phone2: editPhone2.trim() || null,
        email: editEmail.trim() || null,
        address: editAddress.trim() || null,
        notes: editNotes.trim() || null,
      });
      setShowEdit(false);
      const wasOffline = syncStatus === 'offline';
      await load();
      Alert.alert(
        'تم حفظ التعديل ✅',
        wasOffline ? 'رح يتزامن تلقائياً أول ما يتوفر نت' : undefined
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || !customer) return <LoadingScreen message="جاري تحميل كشف الحساب..." />;

  // سجل الحركات من السيرفر (لو متوفر) + الدفعات المحلية يلي لسا ما انزامنت
  const serverTransactions: any[] = Array.isArray(statement) ? statement
    : Array.isArray(statement?.transactions) ? statement.transactions
    : Array.isArray(statement?.items) ? statement.items
    : [];

  const pendingAsTransactions = pendingPayments.map((p) => ({
    id: p.id,
    type: 'دفعة (لسا ما انزامنت)',
    amount: -p.amount,
    date: p.client_created_at,
    pending: true,
  }));

  const transactions = [...pendingAsTransactions, ...serverTransactions];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>كشف الحساب</Text>
        <TouchableOpacity onPress={openEdit}>
          <Ionicons name="create-outline" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {syncStatus === 'offline' && (
        <View style={{ backgroundColor: '#FEF3C7', padding: 8 }}>
          <Text style={{ textAlign: 'center', color: '#92400E', fontSize: 12 }}>
            📡 غير متصل — البيانات المعروضة محلية، رح تنزامن تلقائياً لما يرجع النت
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100 }}>
        <Card style={{ marginBottom: Spacing.lg }}>
          <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.gray800, textAlign: 'right' }}>
            {customer.name}
          </Text>
          {!!customer.phone && (
            <Text style={{ fontSize: 13, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
              {customer.phone}
            </Text>
          )}

          <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: Spacing.md, flexWrap: 'wrap' }}>
            {customer.current_debt > 0
              ? <Badge label={`دين حالي: ${customer.current_debt.toFixed(2)} ₪`} color="red" />
              : <Badge label="لا يوجد دين" color="green" />}
            <Badge label={`حد الائتمان: ${customer.credit_limit.toFixed(0)} ₪`} color="gray" />
          </View>
        </Card>

        {customer.current_debt > 0 && (
          <Button title="تسجيل دفعة" variant="success" fullWidth onPress={() => setShowPay(true)}
                  style={{ marginBottom: Spacing.lg }} />
        )}

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
              <Card key={t.id ?? idx} padding={Spacing.md}>
                <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '700', color: Colors.gray700 }}>
                    {t.type || t.invoice_number || t.description || 'حركة'}
                    {t.pending ? ' ⏳' : ''}
                  </Text>
                  <Text style={{ fontWeight: '800',
                                 color: (t.amount ?? 0) < 0 ? Colors.success : Colors.gray800 }}>
                    {Number(t.amount ?? t.total ?? 0).toFixed(2)} ₪
                  </Text>
                </View>
                {(t.date || t.created_at) && (
                  <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 4 }}>
                    {t.date || t.created_at}
                  </Text>
                )}
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {showPay && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.white,
          borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing.lg,
        }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
                         marginBottom: Spacing.md }}>
            <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.gray800 }}>تسجيل دفعة</Text>
            <TouchableOpacity onPress={() => setShowPay(false)}>
              <Ionicons name="close" size={22} color={Colors.gray500} />
            </TouchableOpacity>
          </View>
          <Input
            label={`المبلغ (الدين الحالي: ${customer.current_debt.toFixed(2)} ₪)`}
            value={payAmount}
            onChangeText={setPayAmount}
            keyboardType="decimal-pad"
            placeholder="0.00"
            autoFocus
          />
          <Button title="تأكيد الدفعة" onPress={submitPayment} loading={paying} fullWidth />
        </View>
      )}

      {showEdit && (
        <View style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.white,
          borderTopLeftRadius: Radius['2xl'], borderTopRightRadius: Radius['2xl'], padding: Spacing.lg,
          maxHeight: '85%',
        }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
                         marginBottom: Spacing.md }}>
            <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.gray800 }}>
              تعديل بيانات العميل
            </Text>
            <TouchableOpacity onPress={() => setShowEdit(false)}>
              <Ionicons name="close" size={22} color={Colors.gray500} />
            </TouchableOpacity>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Input label="الاسم" value={editName} onChangeText={setEditName}
                   placeholder="اسم العميل" autoFocus />
            <Input label="هاتف" value={editPhone} onChangeText={setEditPhone}
                   placeholder="05xxxxxxxx" keyboardType="phone-pad" />
            <Input label="هاتف إضافي (اختياري)" value={editPhone2} onChangeText={setEditPhone2}
                   placeholder="05xxxxxxxx" keyboardType="phone-pad" />
            <Input label="البريد الإلكتروني (اختياري)" value={editEmail} onChangeText={setEditEmail}
                   placeholder="example@mail.com" keyboardType="email-address" />
            <Input label="العنوان (اختياري)" value={editAddress} onChangeText={setEditAddress}
                   placeholder="العنوان" />
            <Input label="ملاحظات (اختياري)" value={editNotes} onChangeText={setEditNotes}
                   placeholder="ملاحظات" />

            <Button title="حفظ التعديل" onPress={submitEdit} loading={saving} fullWidth
                    style={{ marginTop: Spacing.sm, marginBottom: Spacing.lg }} />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}