import { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Updates from 'expo-updates';
import { useAuthStore } from '../src/store/authStore';
import { initDatabase } from '../src/db/database';
import { initCustomerTables } from '../src/db/customerSync';
import { initSupplierTables } from '../src/db/supplierSync';
import { initCategoryTables } from '../src/db/categorySync';
import { initProductsCache } from '../src/db/productsCache';
import { initOfflineSalesTable } from '../src/db/offlineSales';
import { initOfflinePurchasesTable } from '../src/db/offlinePurchases';
import { initApiConfig } from '../src/api/client';

export default function RootLayout() {
  const { isAuthenticated, isLoading, restoreSession, isSubscriptionExpired, daysUntilExpiry } = useAuthStore();
  const router  = useRouter();
  const segments = useSegments();

  // تحقق من التحديثات الهوائية فور فتح التطبيق وطبّقها فوراً
  useEffect(() => {
    async function applyOTAUpdateIfAvailable() {
      try {
        if (!__DEV__) {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync();
          }
        }
      } catch (e) {
        // تجاهل أخطاء التحديث (مثلاً عند انقطاع الإنترنت)
      }
    }
    applyOTAUpdateIfAvailable();
  }, []);

  // تهيئة قاعدة البيانات المحلية (SQLite) عند بدء التطبيق
  useEffect(() => {
    initApiConfig();
    initDatabase();
    initCustomerTables();
    initSupplierTables();
    initCategoryTables();
    initProductsCache();
    initOfflineSalesTable();
    initOfflinePurchasesTable();
  }, []);

  // استعادة الجلسة عند بدء التطبيق
  useEffect(() => { restoreSession(); }, []);

  // توجيه تلقائي بناءً على حالة المصادقة
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" backgroundColor="#1E3A5F" />
      
      {/* Subscription Expired Banner */}
      {isAuthenticated && isSubscriptionExpired && (
        <View style={{ backgroundColor: '#EF4444', padding: 10, paddingTop: 40, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>انتهى الاشتراك! لا يمكنك إضافة بيانات جديدة.</Text>
          <TouchableOpacity onPress={() => router.push('/settings/activation')} style={{ marginTop: 5, backgroundColor: 'white', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 5 }}>
            <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>تجديد الآن</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Subscription Expiring Soon Banner */}
      {isAuthenticated && !isSubscriptionExpired && daysUntilExpiry !== null && daysUntilExpiry <= 3 && (
        <View style={{ backgroundColor: '#F59E0B', padding: 10, paddingTop: 40, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>تنبيه: سينتهي الاشتراك خلال {daysUntilExpiry} أيام.</Text>
          <TouchableOpacity onPress={() => router.push('/settings/activation')} style={{ marginTop: 5, backgroundColor: 'white', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 5 }}>
            <Text style={{ color: '#F59E0B', fontWeight: 'bold' }}>تجديد مبكر</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* إزالة الـ Stack.Screen للمجموعات حل المشكلة.
        الـ Stack هنا سيقوم بعرض المحتوى بناءً على المسار الحالي تلقائياً.
      */}
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}