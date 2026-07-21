import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Badge, EmptyState } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { productsApi, categoriesApi } from '../../src/api';
import type { Product, Category } from '../../src/types';
import { isBackendReachable } from '../../src/api/client';
import { searchProductsCache } from '../../src/db/productsCache';

export default function ProductsScreen() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchProducts = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const isOnline = await isBackendReachable();
      if (isOnline) {
        const data = await productsApi.list({
          search: search.trim() || undefined,
          category_id: categoryId,
          low_stock: lowStockOnly || undefined,
          limit: 100,
        });
        setProducts(data);
      } else {
        const cached = searchProductsCache(search);
        let filtered = cached;
        if (categoryId) filtered = filtered.filter(p => p.category_id === categoryId);
        if (lowStockOnly) filtered = filtered.filter(p => p.is_low_stock);
        setProducts(filtered);
      }
    } catch (e) {
      // fallback to offline
      try {
        const cached = searchProductsCache(search);
        let filtered = cached;
        if (categoryId) filtered = filtered.filter(p => p.category_id === categoryId);
        if (lowStockOnly) filtered = filtered.filter(p => p.is_low_stock);
        setProducts(filtered);
      } catch (err) {}
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, categoryId, lowStockOnly]);

  useEffect(() => {
    categoriesApi.list().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchProducts(true), 300); // debounce search
    return () => clearTimeout(t);
  }, [fetchProducts]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchProducts(false);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      {/* Header */}
      <View style={{
        padding: Spacing.lg, paddingBottom: Spacing.md,
        borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                       marginBottom: Spacing.md }}>
          <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
            📦 المنتجات
          </Text>
          <Text style={{ fontSize: Fonts.sizes.sm, color: Colors.gray400, fontWeight: '600' }}>
            {products.length} منتج
          </Text>
        </View>

        <Input
          placeholder="ابحث بالاسم أو الباركود..."
          value={search}
          onChangeText={setSearch}
          leftIcon={<Ionicons name="search" size={18} color={Colors.gray400} />}
          containerStyle={{ marginBottom: Spacing.sm }}
        />

        <FlatList
          data={[{ id: undefined, label: 'الكل' } as any, ...categories.map(c => ({ id: c.id, label: c.name_ar || c.name }))]}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item, i) => String(item.id ?? 'all') + i}
          contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          renderItem={({ item }) => {
            const active = categoryId === item.id;
            return (
              <TouchableOpacity
                onPress={() => setCategoryId(item.id)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full,
                  backgroundColor: active ? Colors.primary : Colors.gray100,
                }}
              >
                <Text style={{ color: active ? Colors.white : Colors.gray600, fontWeight: '600', fontSize: 13 }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />

        <TouchableOpacity
          onPress={() => setLowStockOnly(v => !v)}
          style={{
            marginTop: Spacing.sm, alignSelf: 'flex-end',
            flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
            backgroundColor: lowStockOnly ? Colors.dangerLight : Colors.gray50,
          }}
        >
          <Ionicons name="alert-circle" size={16} color={lowStockOnly ? Colors.danger : Colors.gray400} />
          <Text style={{ fontSize: 12, fontWeight: '600',
                         color: lowStockOnly ? Colors.danger : Colors.gray500 }}>
            مخزون منخفض فقط
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : products.length === 0 ? (
        <EmptyState icon="📦" title="لا توجد منتجات"
                    subtitle={search ? 'جرّب كلمة بحث مختلفة' : 'اضغط + لإضافة أول منتج'} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100, gap: Spacing.sm }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />}
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: String(item.id) } })}
            />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => router.push('/product/new')}
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

function ProductRow({ product, onPress }: { product: Product; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{
      backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
      flexDirection: 'row-reverse', alignItems: 'center', gap: Spacing.md,
      ...Shadow.sm,
    }}>
      <View style={{
        width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.gray100,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name="cube-outline" size={24} color={Colors.gray400} />
      </View>

      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: Fonts.sizes.base, fontWeight: '700',
                                          color: Colors.gray800, textAlign: 'right' }}>
          {product.name_ar || product.name}
        </Text>
        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <Text style={{ fontSize: 13, color: Colors.gray400 }}>
            {product.stock_quantity} {product.base_unit === 'piece' ? 'قطعة' : product.base_unit}
          </Text>
          {product.is_low_stock && <Badge label="منخفض" color="red" />}
          {!product.is_active && <Badge label="غير نشط" color="gray" />}
        </View>
      </View>

      <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
        {product.retail_price.toFixed(2)} ₪
      </Text>
    </TouchableOpacity>
  );
}