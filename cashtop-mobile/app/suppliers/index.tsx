import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Badge, Button, EmptyState } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import {
  getAllSuppliers,
  updateSupplierBalance,
} from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';

export default function SuppliersScreen() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadLocal = useCallback(() => {
    let data = getAllSuppliers();
    const query = search.trim().toLowerCase();
    if (query) {
      data = data.filter(s => s.name.toLowerCase().includes(query));
    }
    setSuppliers(data);
  }, [search]);

  // Initial load from local cache (instant, no spinner)
  useFocusEffect(useCallback(() => {
    loadLocal();
  }, [loadLocal]));

  // Trigger sync in background
  useEffect(() => {
    const t = setTimeout(() => {
      runFullSync().then(loadLocal).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // Re-filter on search change
  useEffect(() => {
    loadLocal();
  }, [search]);

  const submitPayment = (supplierId: string) => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert('أدخل مبلغاً صحيحاً');
      return;
    }
    setSubmitting(true);
    try {
      // Payment reduces the balance
      updateSupplierBalance(supplierId, -amount);
      setPayingId(null);
      setPayAmount('');
      loadLocal();
      Alert.alert('تم تسجيل الدفعة ✅', 'ستتم المزامنة مع السيرفر تلقائياً عند توفر الإنترنت');
      runFullSync().catch(() => {});
    } catch (e: any) {
      Alert.alert('خطأ', 'تعذّر تسجيل الدفعة');
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
          <TouchableOpacity onPress={() => router.replace('/customers')}>
            <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13 }}>العملاء ←</Text>
          </TouchableOpacity>
        </View>
        <Input
          placeholder="ابحث عن مورد..."
          value={search}
          onChangeText={setSearch}
          leftIcon={<Ionicons name="search" size={18} color={Colors.gray400} />}
        />
      </View>

      {suppliers.length === 0 ? (
        <EmptyState icon="🚚" title="لا يوجد موردين" subtitle={search ? 'جرّب كلمة بحث مختلفة' : 'اضغط + لإضافة أول مورد'} />
      ) : (
        <FlatList
          data={suppliers}
          keyExtractor={s => s.id}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100, gap: Spacing.sm }}
          renderItem={({ item }) => {
            const isPending = item.sync_status === 'pending_create';
            const balance = item.current_balance;
            return (
              <TouchableOpacity
                style={{ backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, ...Shadow.sm }}
                onPress={() => !isPending && router.push(`/suppliers/${item.id}`)}
              >
                <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>{item.name}</Text>
                      {isPending && (
                        <View style={{ backgroundColor: Colors.warning + '33', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 10, color: Colors.warning, fontWeight: '700' }}>⏳ معلق</Text>
                        </View>
                      )}
                    </View>
                    {!!item.phone && (
                      <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                        {item.phone}
                      </Text>
                    )}
                  </View>
                  {!isPending && (
                    balance > 0 ? (
                      <Badge label={`مستحق: ${balance.toFixed(0)} ₪`} color="red" />
                    ) : (
                      <Badge label="لا يوجد مستحقات" color="green" />
                    )
                  )}
                </View>

                {!isPending && balance > 0 && (
                  payingId === item.id ? (
                    <View style={{ marginTop: Spacing.sm }}>
                      <Input
                        placeholder={`المبلغ (المستحق: ${balance.toFixed(2)} ₪)`}
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
              </TouchableOpacity>
            );
          }}
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