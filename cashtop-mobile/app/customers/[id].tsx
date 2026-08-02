import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Badge, Input, LoadingScreen } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { customersApi } from '../../src/api';
import {
  getCustomerById,
  upsertCustomer,
  getPendingDebtPayments,
  createDebtPayment,
  createLocalInvoice,
  updateCustomerDebt,
  LocalCustomer,
  LocalInvoice,
  getInvoicesForCustomer,
  runInTransaction
} from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';
import { isBackendReachable } from '../../src/api/client';

export default function CustomerStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [customer, setCustomer] = useState<LocalCustomer | null>(null);
  const [invoices, setInvoices] = useState<LocalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showPay, setShowPay] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

  const [showDebt, setShowDebt] = useState(false);
  const [debtAmount, setDebtAmount] = useState('');
  const [debtNotes, setDebtNotes] = useState('');
  const [addingDebt, setAddingDebt] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');

  const loadFromLocal = useCallback(() => {
    if (!id) return;
    
    // 1. اقرأ بيانات العميل من SQLite
    const cached = getCustomerById(id);
    setCustomer(cached);
    
    // 2. اقرأ جميع العمليات (فواتير، دفعات، ديون) من SQLite
    const localInvoices = getInvoicesForCustomer(id);
    setInvoices(localInvoices);

    setLoading(false);
    setRefreshing(false);
  }, [id]);

  // تحديث الشاشة عند الفتح (من الكاش) ثم محاولة المزامنة
  useFocusEffect(useCallback(() => {
    loadFromLocal();

    isBackendReachable().then(online => {
      if (online) {
        runFullSync().then(() => loadFromLocal()).catch(() => {});
      }
    });
  }, [loadFromLocal]));

  // سحب للتحديث اليدوي
  const onRefresh = async () => {
    setRefreshing(true);
    const online = await isBackendReachable();
    if (online) {
      await runFullSync().catch(() => {});
    }
    loadFromLocal();
  };

  const submitPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('أدخل مبلغاً صحيحاً');
      return;
    }
    setPaying(true);
    try {
      runInTransaction(() => {
        // 1. تسجيل دفعة محلياً
        createDebtPayment({
          customer_id: id,
          amount: amount,
          method: 'cash',
          notes: 'دفعة سداد دين',
        });
        
        // 2. تحديث رصيد العميل فوراً
        updateCustomerDebt(id, -amount);
      });
      
      // 3. مزامنة
      isBackendReachable().then(online => { if (online) runFullSync().catch(() => {}); });

      setShowPay(false);
      setPayAmount('');
      loadFromLocal();
      Alert.alert('تم تسجيل الدفعة ✅', 'تم الحفظ محلياً وستتم المزامنة.');
    } finally {
      setPaying(false);
    }
  };

  const submitDebt = async () => {
    const amount = Number(debtAmount);
    if (!amount || amount <= 0) {
      Alert.alert('أدخل مبلغاً صحيحاً');
      return;
    }
    setAddingDebt(true);
    try {
      runInTransaction(() => {
        // 1. الدين اليدوي يُسجل كفاتورة آجل وهمية لتظهر في كشف الحساب
        createLocalInvoice({
          invoice_number: null,
          invoice_type: 'sale',
          status: 'completed',
          payment_method: 'credit',
          payment_status: 'unpaid',
          customer_id: id,
          customer_name: customer?.name || null,
          supplier_id: null,
          subtotal: amount,
          discount_amount: 0,
          tax_amount: 0,
          total: amount,
          paid_amount: 0,
          remaining_amount: amount,
          notes: debtNotes.trim() || 'دين يدوي مسجل من التطبيق',
          sync_status: 'pending_create'
        }, [
          {
            product_id: 'general-debt', // معرف وهمي لمنتج الدين
            product_name: 'دين يدوي / عام',
            quantity: 1,
            unit_type: 'piece',
            unit_price: amount,
            cost_price: 0,
            pieces_per_carton: 1,
            total: amount
          }
        ]);
        
        // 2. تحديث رصيد العميل محلياً
        updateCustomerDebt(id, amount);
      });
      
      // 3. مزامنة
      isBackendReachable().then(online => { if (online) runFullSync().catch(() => {}); });

      setShowDebt(false);
      setDebtAmount('');
      setDebtNotes('');
      loadFromLocal();
      Alert.alert('تم تسجيل الدين ✅', 'تم الحفظ محلياً وستتم المزامنة.');
    } finally {
      setAddingDebt(false);
    }
  };

  const submitEdit = () => {
    if (!customer) return;
    if (!editName.trim()) {
      Alert.alert('الاسم مطلوب');
      return;
    }
    
    upsertCustomer({
      ...customer,
      name: editName.trim(),
      phone: editPhone.trim() || null,
      address: editAddress.trim() || null,
      sync_status: 'pending_update', // سيتزامن لاحقاً
    });
    
    isBackendReachable().then(online => { if (online) runFullSync().catch(() => {}); });
    
    setShowEdit(false);
    loadFromLocal();
  };

  if (loading) return <LoadingScreen message="جاري التحميل..." />;
  if (!customer) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, color: Colors.gray500 }}>العميل غير موجود</Text>
      </View>
    );
  }

  // فرز الفواتير تنازلياً
  const sortedInvoices = [...invoices].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={26} color={Colors.gray800} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
          ملف العميل
        </Text>
        <TouchableOpacity onPress={() => {
          setEditName(customer.name);
          setEditPhone(customer.phone || '');
          setEditAddress(customer.address || '');
          setShowEdit(true);
        }}>
          <Ionicons name="create-outline" size={24} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={{ paddingBottom: Spacing['3xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
      >
        {/* بطاقة العميل */}
        <View style={{ backgroundColor: Colors.primary, padding: Spacing.xl, borderBottomLeftRadius: Radius['2xl'], borderBottomRightRadius: Radius['2xl'] }}>
          <Text style={{ color: Colors.white, fontSize: 24, fontWeight: '800', textAlign: 'right' }}>
            {customer.name}
          </Text>
          {customer.phone && <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'right', marginTop: 4 }}>📞 {customer.phone}</Text>}
          
          <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: Radius.lg, padding: Spacing.md, marginTop: Spacing.lg, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>الدين الحالي</Text>
              <Text style={{ color: Colors.white, fontSize: 28, fontWeight: '800' }}>
                {customer.current_debt.toFixed(2)} ₪
              </Text>
            </View>
            {customer.credit_limit > 0 && (
              <View style={{ alignItems: 'flex-start' }}>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>سقف الدين</Text>
                <Text style={{ color: Colors.white, fontSize: 16, fontWeight: '700' }}>
                  {customer.credit_limit.toFixed(0)} ₪
                </Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: Spacing.lg }}>
            <TouchableOpacity onPress={() => setShowPay(true)} style={{ flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: Colors.success, fontWeight: '700' }}>استلام دفعة</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowDebt(true)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: Colors.white, fontWeight: '700' }}>إضافة دين</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* العمليات (أوفلاين) */}
        <View style={{ padding: Spacing.lg }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: Colors.gray800, marginBottom: Spacing.md, textAlign: 'right' }}>
            كشف الحساب والسجل (محلي)
          </Text>

          {sortedInvoices.length === 0 ? (
            <View style={{ backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center', marginTop: Spacing.lg }}>
              <Ionicons name="document-text-outline" size={48} color={Colors.gray300} />
              <Text style={{ color: Colors.gray500, marginTop: 10, fontWeight: '600' }}>لا توجد فواتير أو ديون سابقة</Text>
            </View>
          ) : (
            <View style={{ gap: Spacing.sm }}>
              {sortedInvoices.map(inv => (
                <TouchableOpacity
                  key={inv.id}
                  onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: inv.id } })}
                  style={{ backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', ...Shadow.sm }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>
                      {inv.notes || (inv.payment_method === 'credit' ? 'بيع آجل' : 'فاتورة مبيعات')}
                    </Text>
                    <Text style={{ fontSize: 12, color: Colors.gray500, textAlign: 'right', marginTop: 2 }}>
                      {new Date(inv.created_at).toLocaleDateString('ar')} • {inv.invoice_number || 'معلّقة'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-start' }}>
                    <Text style={{ fontWeight: '800', fontSize: 16, color: inv.payment_method === 'credit' && inv.remaining_amount > 0 ? Colors.danger : Colors.gray800 }}>
                      {inv.total.toFixed(2)} ₪
                    </Text>
                    {inv.sync_status !== 'synced' && (
                      <Badge label="تنتظر المزامنة" color="blue" />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* مودال الدفعة */}
      {showPay && (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.lg }}>
          <View style={{ backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, ...Shadow.lg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.md }}>استلام دفعة من العميل</Text>
            <Input label="المبلغ (₪)" value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" autoFocus />
            <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: Spacing.lg }}>
              <Button title="استلام وحفظ" onPress={submitPayment} loading={paying} style={{ flex: 1 }} />
              <Button title="إلغاء" variant="secondary" onPress={() => setShowPay(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      )}

      {/* مودال الدين اليدوي */}
      {showDebt && (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.lg }}>
          <View style={{ backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, ...Shadow.lg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.md }}>تسجيل دين يدوي (آجل)</Text>
            <Input label="المبلغ (₪)" value={debtAmount} onChangeText={setDebtAmount} keyboardType="decimal-pad" autoFocus />
            <Input label="ملاحظات (اختياري)" value={debtNotes} onChangeText={setDebtNotes} />
            <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: Spacing.lg }}>
              <Button title="تسجيل الدين" onPress={submitDebt} loading={addingDebt} style={{ flex: 1 }} />
              <Button title="إلغاء" variant="secondary" onPress={() => setShowDebt(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      )}
      
      {/* مودال تعديل العميل */}
      {showEdit && (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.lg }}>
          <View style={{ backgroundColor: Colors.white, borderRadius: Radius.xl, padding: Spacing.xl, ...Shadow.lg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: Spacing.md }}>تعديل بيانات العميل</Text>
            <Input label="الاسم" value={editName} onChangeText={setEditName} autoFocus />
            <Input label="الهاتف" value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad" />
            <Input label="العنوان" value={editAddress} onChangeText={setEditAddress} />
            <View style={{ flexDirection: 'row-reverse', gap: 10, marginTop: Spacing.lg }}>
              <Button title="حفظ التعديلات" onPress={submitEdit} style={{ flex: 1 }} />
              <Button title="إلغاء" variant="secondary" onPress={() => setShowEdit(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}