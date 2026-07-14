import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Badge, Button, EmptyState } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { suppliersApi } from '../../src/api';
import type { Supplier } from '../../src/types';

export default function SuppliersScreen() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const data = await suppliersApi.list(search.trim() || undefined);
      setSuppliers(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => load(true), 300);
    return () => clearTimeout(t);
  }, [load]);

  const submitPayment = async (supplierId: number) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('أدخل مبلغاً صحيحاً');
      return;
    }
    setSubmitting(true);
    try {
      await suppliersApi.payDebt(supplierId, amount, 'cash');
      setPayingId(null);
      setPayAmount('');
      await load();
      Alert.alert('تم تسجيل الدفعة ✅');
    } catch (e: any) {
      Alert.alert('خطأ', e?.response?.data?.detail || 'تعذّر تسجيل الدفعة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{ padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border,
                     backgroundColor: Colors.white }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                       marginBottom: Spacing.md }}>
          <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
            🚚 الموردين
          </Text>
          <TouchableOpacity onPress={() => router.push('/customers')}>
            <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13 }}>→ العملاء</Text>
          </TouchableOpacity>
        </View>
        <Input
          placeholder="ابحث عن مورد..."
          value={search}
          onChangeText={setSearch}
          leftIcon={<Ionicons name="search" size={18} color={Colors.gray400} />}
        />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : suppliers.length === 0 ? (
        <EmptyState icon="🚚" title="لا يوجد موردين" subtitle={search ? 'جرّب كلمة بحث مختلفة' : 'اضغط + لإضافة أول مورد'} />
      ) : (
        <FlatList
          data={suppliers}
          keyExtractor={s => String(s.id)}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100, gap: Spacing.sm }}
          renderItem={({ item }) => (
            <View style={{ backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, ...Shadow.sm }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>{item.name}</Text>
                  {!!item.phone && (
                    <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                      {item.phone}
                    </Text>
                  )}
                </View>
                {item.balance > 0 ? (
                  <Badge label={`مستحق: ${item.balance.toFixed(0)} ₪`} color="red" />
                ) : (
                  <Badge label="لا يوجد مستحقات" color="green" />
                )}
              </View>

              {item.balance > 0 && (
                payingId === item.id ? (
                  <View style={{ marginTop: Spacing.sm }}>
                    <Input
                      placeholder={`المبلغ (المستحق: ${item.balance.toFixed(2)} ₪)`}
                      value={payAmount}
                      onChangeText={setPayAmount}
                      keyboardType="decimal-pad"
                      autoFocus
                    />
                    <View style={{ flexDirection: 'row-reverse', gap: 8 }}>
                      <Button title="تأكيد" variant="success" onPress={() => submitPayment(item.id)}
                              loading={submitting} style={{ flex: 1 }} size="sm" />
                      <Button title="إلغاء" variant="secondary"
                              onPress={() => { setPayingId(null); setPayAmount(''); }} style={{ flex: 1 }} size="sm" />
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setPayingId(item.id)} style={{ marginTop: Spacing.sm }}>
                    <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13, textAlign: 'center' }}>
                      تسجيل دفعة
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/suppliers/new')}
        style={{
          position: 'absolute', bottom: 24, left: 24,
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: Colors.accent,
          alignItems: 'center', justifyContent: 'center',
          ...Shadow.lg,
        }}
      >
        <Ionicons name="add" size={30} color={Colors.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}