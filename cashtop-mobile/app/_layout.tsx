import { useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../src/store/authStore';
import { initDatabase } from '../src/db/database';
import { initCustomerTables } from '../src/db/customerSync';
import { initProductsCache } from '../src/db/productsCache';
import { initOfflineSalesTable } from '../src/db/offlineSales';

export default function RootLayout() {
  const { isAuthenticated, isLoading, restoreSession } = useAuthStore();
  const router  = useRouter();
  const segments = useSegments();

  // تهيئة قاعدة البيانات المحلية (SQLite) عند بدء التطبيق
  useEffect(() => {
    initDatabase();
    initCustomerTables();
    initProductsCache();
    initOfflineSalesTable();
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
      {isAuthenticated && useAuthStore.getState().isSubscriptionExpired && (
        <View style={{ backgroundColor: '#EF4444', padding: 10, paddingTop: 40, alignItems: 'center' }}>
          <Text style={{ color: 'white', fontWeight: 'bold' }}>انتهى الاشتراك! لا يمكنك إضافة بيانات جديدة.</Text>
          <TouchableOpacity onPress={() => router.push('/settings/activation')} style={{ marginTop: 5, backgroundColor: 'white', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 5 }}>
            <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>تجديد الآن</Text>
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