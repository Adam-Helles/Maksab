import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Badge, EmptyState } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { customersApi } from '../../src/api';
import type { Customer } from '../../src/types';
import { isBackendReachable } from '../../src/api/client';
import { searchCustomersCache, localCustomerToCustomer } from '../../src/db/customerSync';

export default function CustomersScreen() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [debtOnly, setDebtOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const isOnline = await isBackendReachable();
      if (isOnline) {
        const data = await customersApi.list({
          search: search.trim() || undefined,
          has_debt: debtOnly || undefined,
        });
        setCustomers(data);
      } else {
        let cached = searchCustomersCache(search);
        if (debtOnly) cached = cached.filter(c => c.current_debt > 0);
        setCustomers(cached.map(localCustomerToCustomer));
      }
    } catch {
      // ignore, keep previous list or fallback
      try {
        let cached = searchCustomersCache(search);
        if (debtOnly) cached = cached.filter(c => c.current_debt > 0);
        setCustomers(cached.map(localCustomerToCustomer));
      } catch {}
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, debtOnly]);

  useEffect(() => {
    const t = setTimeout(() => load(true), 300);
    return () => clearTimeout(t);
  }, [load]);

  const totalDebt = customers.reduce((s, c) => s + c.current_debt, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{ padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border,
                     backgroundColor: Colors.white }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                       marginBottom: Spacing.md }}>
          <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
            👥 العملاء
          </Text>
          <TouchableOpacity onPress={() => router.push('/suppliers')}>
            <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13 }}>الموردين ←</Text>
          </TouchableOpacity>
        </View>

        <Input
          placeholder="ابحث بالاسم أو الهاتف..."
          value={search}
          onChangeText={setSearch}
          leftIcon={<Ionicons name="search" size={18} color={Colors.gray400} />}
          containerStyle={{ marginBottom: Spacing.sm }}
        />

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={() => setDebtOnly(v => !v)}
            style={{
              flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
              backgroundColor: debtOnly ? Colors.dangerLight : Colors.gray50,
            }}
          >
            <Ionicons name="alert-circle" size={16} color={debtOnly ? Colors.danger : Colors.gray400} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: debtOnly ? Colors.danger : Colors.gray500 }}>
              عليهم دين فقط
            </Text>
          </TouchableOpacity>

          {totalDebt > 0 && (
            <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.danger }}>
              إجمالي الديون: {totalDebt.toFixed(2)} ₪
            </Text>
          )}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : customers.length === 0 ? (
        <EmptyState icon="👥" title="لا يوجد عملاء" subtitle={search ? 'جرّب كلمة بحث مختلفة' : 'اضغط + لإضافة أول عميل'} />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={c => String(c.id)}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100, gap: Spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing}
                             onRefresh={() => { setRefreshing(true); load(); }} colors={[Colors.primary]} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/customers/[id]', params: { id: String(item.id) } })}
              style={{
                backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
                flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                ...Shadow.sm,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>{item.name}</Text>
                {!!item.phone && (
                  <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                    {item.phone}
                  </Text>
                )}
              </View>
              {item.current_debt > 0 ? (
                <Badge label={`دين: ${item.current_debt.toFixed(0)} ₪`} color="red" />
              ) : (
                <Badge label="لا يوجد دين" color="green" />
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/customers/new')}
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