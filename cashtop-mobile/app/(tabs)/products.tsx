import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Badge, EmptyState } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { getAllProducts, searchProducts, getAllCategories, LocalProduct, LocalCategory } from '../../src/db/database';
import { runFullSync } from '../../src/db/syncManager';
import { isBackendReachable } from '../../src/api/client';
import type { Product } from '../../src/types';

// مساعد للتحويل
function localProductToUI(p: LocalProduct): Product {
  return {
    id: p.id,
    name: p.name,
    name_ar: p.name_ar || undefined,
    barcode_piece: p.barcode_piece || undefined,
    barcode_carton: p.barcode_carton || undefined,
    base_unit: 'piece',
    pieces_per_carton: p.pieces_per_carton,
    cost_price: p.cost_price,
    retail_price: p.retail_price,
    wholesale_price: p.retail_price,
    carton_price: p.carton_price,
    piece_price_from_carton: p.pieces_per_carton > 0 ? p.carton_price / p.pieces_per_carton : 0,
    stock_quantity: p.stock_quantity,
    stock_in_cartons: p.pieces_per_carton > 0 ? p.stock_quantity / p.pieces_per_carton : 0,
    min_stock_alert: 5,
    is_low_stock: p.stock_quantity <= 5,
    profit_margin: p.cost_price > 0 ? ((p.retail_price - p.cost_price) / p.cost_price) * 100 : 0,
    has_expiry: false,
    tax_rate: p.tax_rate,
    is_active: p.is_active === 1,
    is_featured: false,
    created_at: p.created_at,
  };
}

export default function ProductsScreen() {
  const router = useRouter();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromLocal = useCallback(() => {
    try {
      let local: LocalProduct[];
      if (search.trim()) {
        local = searchProducts(search.trim(), 200);
      } else {
        local = getAllProducts(false); // لا تعرض المحذوفة
      }

      if (categoryId) local = local.filter(p => p.category_id === categoryId);
      if (lowStockOnly) local = local.filter(p => p.stock_quantity <= 5);
      
      setProducts(local.map(localProductToUI));
      setCategories(getAllCategories());
    } catch (e) {
      console.log('Error loading products from local db:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, categoryId, lowStockOnly]);

  useFocusEffect(useCallback(() => {
    loadFromLocal();
    
    isBackendReachable().then(online => {
      if (online) {
        runFullSync().then(() => loadFromLocal()).catch(() => {});
      }
    });
  }, [loadFromLocal]));

  const onRefresh = async () => {
    setRefreshing(true);
    const online = await isBackendReachable();
    if (online) {
      await runFullSync().catch(() => {});
    }
    loadFromLocal();
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
          data={[{ id: undefined, label: 'الكل' } as any, ...categories.map(c => ({ id: c.id, label: c.name }))]}
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