import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Updates from 'expo-updates';
import { useAuthStore } from '../src/store/authStore';
import { initDatabase } from '../src/db/database';
import { initApiConfig } from '../src/api/client';

export default function RootLayout() {
  const { isAuthenticated, isLoading, restoreSession, isSubscriptionExpired, daysUntilExpiry } = useAuthStore();
  const router  = useRouter();
  const segments = useSegments();
  
  // حالات تتبع دورة OTA
  const [otaStatus, setOtaStatus] = useState<string>('لم يبدأ');
  const [otaError, setOtaError] = useState<string>('');
  const [showOtaLogs, setShowOtaLogs] = useState<boolean>(true);

  // تحقق من التحديثات الهوائية فور فتح التطبيق وطبّقها فوراً مع تتبع كامل
  useEffect(() => {
    async function applyOTAUpdateIfAvailable() {
      try {
        if (__DEV__) {
          setOtaStatus('وضع التطوير - تم تخطي التحديث');
          return;
        }

        setOtaStatus('جاري البحث عن تحديث...');
        const update = await Updates.checkForUpdateAsync();
        
        if (update.isAvailable) {
          setOtaStatus('تحديث متاح! جاري التنزيل...');
          const fetchResult = await Updates.fetchUpdateAsync();
          
          if (fetchResult.isNew) {
            setOtaStatus('تم التنزيل بنجاح. جاري التطبيق...');
            await Updates.reloadAsync();
          } else {
            setOtaStatus('التحديث موجود بالفعل.');
          }
        } else {
          setOtaStatus('لا يوجد تحديث متاح.');
        }
      } catch (e: any) {
        setOtaStatus('فشل أثناء دورة التحديث');
        setOtaError(e.message || String(e));
      }
    }
    applyOTAUpdateIfAvailable();
  }, []);

  // تهيئة قاعدة البيانات المحلية (SQLite) عند بدء التطبيق
  // initDatabase() تنشئ جميع الجداول الجديدة وتقوم بالهجرة من البنية القديمة تلقائياً
  useEffect(() => {
    initApiConfig();
    initDatabase();
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

      {/* OTA Diagnostics Overlay */}
      {showOtaLogs && (
        <View style={{ backgroundColor: 'rgba(0,0,0,0.85)', padding: 15, paddingTop: 45, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999 }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ color: '#FFD700', fontWeight: 'bold', fontSize: 16 }}>تشخيص التحديث الهوائي (OTA)</Text>
            <TouchableOpacity onPress={() => setShowOtaLogs(false)}><Text style={{ color: 'white' }}>إغلاق</Text></TouchableOpacity>
          </View>
          <Text style={{ color: 'white', fontSize: 12, marginBottom: 2 }}>Channel: {Updates.channel || 'N/A'}</Text>
          <Text style={{ color: 'white', fontSize: 12, marginBottom: 2 }}>Runtime Version: {Updates.runtimeVersion || 'N/A'}</Text>
          <Text style={{ color: 'white', fontSize: 12, marginBottom: 2 }}>Update ID: {Updates.updateId || 'N/A'}</Text>
          <Text style={{ color: 'white', fontSize: 12, marginBottom: 2 }}>Is Emergency: {Updates.isEmergencyLaunch ? 'Yes' : 'No'}</Text>
          <View style={{ height: 1, backgroundColor: '#555', marginVertical: 5 }} />
          <Text style={{ color: '#4CAF50', fontSize: 13, fontWeight: 'bold' }}>الحالة: {otaStatus}</Text>
          {otaError ? <Text style={{ color: '#F44336', fontSize: 12, marginTop: 5 }}>الخطأ: {otaError}</Text> : null}
        </View>
      )}

      {/* إزالة الـ Stack.Screen للمجموعات حل المشكلة.
        الـ Stack هنا سيقوم بعرض المحتوى بناءً على المسار الحالي تلقائياً.
      */}
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}