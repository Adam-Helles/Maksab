import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Vibration, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import { productsApi } from '../../src/api';
import { useCartStore } from '../../src/store/cartStore';
import { searchProductsCache, localProductToProduct } from '../../src/db/productsCache';

const SCAN_COOLDOWN_MS = 1200;

export default function ScanScreen() {
  const router  = useRouter();
  const params  = useLocalSearchParams<{ source?: string }>();

  /**
   * source === 'pos' → وضع نقطة البيع:
   *   - إذا وُجد المنتج: يُضاف للسلة فوراً (+1 لكل مسح) بدون فتح صفحة أخرى
   *   - إذا لم يوجد: تنبيه سريع فقط (مش "إضافة منتج جديد")
   *
   * source === undefined → وضع المخزون (السلوك الأصلي):
   *   - موجود: يفتح صفحة تعديل المنتج
   *   - غير موجود: يعرض خيار إضافة منتج جديد
   */
  const isPOSMode = params.source === 'pos';

  const { addItem } = useCartStore();

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [looking,  setLooking]  = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [lastAddedName, setLastAddedName] = useState<string | null>(null);

  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-enable scanning every time the tab regains focus
  useFocusEffect(useCallback(() => {
    setScanning(true);
    setLooking(false);
    setLastAddedName(null);
  }, []));

  // ── وضع POS: إضافة للسلة من الكاش المحلي ───────────────
  const addToCartFromCache = useCallback((code: string) => {
    // ابحث في الكاش المحلي أولاً (يعمل أونلاين وأوفلاين)
    const cached = searchProductsCache(code, 1);
    const local  = cached[0];

    if (local && local.is_active) {
      const product = localProductToProduct(local);
      addItem(product, 'piece');
      Vibration.vibrate(60);

      // عرض اسم المنتج المضاف كـ feedback بصري لحظي
      const name = local.name_ar || local.name;
      setLastAddedName(name);
      if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
      feedbackTimeout.current = setTimeout(() => setLastAddedName(null), 1800);

      // إعادة تفعيل المسح فوراً (الكاشير يمسح منتج تلو الآخر بسرعة)
      setScanning(true);
    } else {
      // المنتج غير موجود في الكاش → تنبيه مختصر
      Alert.alert(
        '⚠️ منتج غير موجود',
        `لا يوجد منتج بهذا الباركود في الكاش المحلي.\n\nالباركود: ${code}\n\n` +
        'تأكد من الاتصال بالإنترنت وأعد فتح شاشة POS لتحديث الكاش.',
        [{ text: 'حسناً', onPress: () => setScanning(true) }],
      );
    }
  }, [addItem]);

  // ── وضع المخزون: الاستعلام من السيرفر ──────────────────
  const lookupBarcode = useCallback(async (code: string) => {
    setLooking(true);
    setScanning(false);
    try {
      const result: any = await productsApi.getByBarcode(code);
      const product = result?.product ?? result;
      if (product?.id) {
        Vibration.vibrate(80);
        router.push({ pathname: '/product/[id]', params: { id: String(product.id) } });
      } else {
        handleNotFound(code);
      }
    } catch {
      handleNotFound(code);
    } finally {
      setLooking(false);
    }
  }, [router]);

  const handleNotFound = (code: string) => {
    Alert.alert(
      'المنتج غير موجود',
      `لا يوجد منتج بهذا الباركود:\n${code}`,
      [
        { text: 'إعادة المسح', style: 'cancel', onPress: () => setScanning(true) },
        {
          text: 'إضافة منتج جديد',
          onPress: () => router.push({ pathname: '/product/new', params: { barcode: code } }),
        },
      ],
    );
  };

  // ── معالج المسح الموحّد ────────────────────────────────
  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    const code = result.data?.trim();
    if (!code) return;

    const now = Date.now();
    if (code === lastScanRef.current.code && now - lastScanRef.current.time < SCAN_COOLDOWN_MS) {
      return; // تجاهل المسح السريع المتكرر لنفس الكود
    }
    lastScanRef.current = { code, time: now };

    if (isPOSMode) {
      // وضع POS: إضافة فورية من الكاش — لا حاجة لـ await
      addToCartFromCache(code);
    } else {
      // وضع المخزون: فتح صفحة المنتج
      lookupBarcode(code);
    }
  };

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualMode(false);
    setManualCode('');
    if (isPOSMode) {
      addToCartFromCache(code);
    } else {
      lookupBarcode(code);
    }
  };

  // ── Permission states ─────────────────────────────────
  if (!permission) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.center, { padding: Spacing.xl }]}>
        <Ionicons name="camera-outline" size={56} color={Colors.gray400} />
        <Text style={styles.permissionTitle}>الكاميرا مطلوبة لمسح الباركود</Text>
        <Text style={styles.permissionSubtitle}>
          نحتاج صلاحية الكاميرا لمسح باركود المنتجات
        </Text>
        <Button title="السماح باستخدام الكاميرا" onPress={requestPermission} style={{ marginTop: Spacing.lg }} />
        <TouchableOpacity onPress={() => setManualMode(true)} style={{ marginTop: Spacing.lg }}>
          <Text style={{ color: Colors.primary, fontWeight: '600' }}>أو أدخل الباركود يدوياً</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.black }}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
        }}
        onBarcodeScanned={scanning && !looking ? onBarcodeScanned : undefined}
      />

      {/* Overlay */}
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.header}>
          {isPOSMode ? (
            <View style={styles.posModeHeader}>
              <Text style={styles.headerTitle}>🛒 مسح سريع — POS</Text>
              <Text style={styles.posModeHint}>كل مسح يضيف للسلة مباشرة</Text>
            </View>
          ) : (
            <Text style={styles.headerTitle}>📷 امسح الباركود</Text>
          )}
        </View>

        <View style={styles.frameWrap} pointerEvents="none">
          <View style={[styles.frame, isPOSMode && { borderColor: Colors.accent }]} />
          <Text style={styles.hint}>وجّه الكاميرا نحو الباركود</Text>
        </View>

        {/* Feedback وضع POS: اسم المنتج المضاف */}
        {isPOSMode && lastAddedName && (
          <View style={styles.addedPill}>
            <Ionicons name="checkmark-circle" size={18} color="#10B981" />
            <Text style={styles.addedText}>✅ أُضيف: {lastAddedName}</Text>
          </View>
        )}

        {/* مؤشر البحث في وضع المخزون */}
        {looking && (
          <View style={styles.loadingPill}>
            <ActivityIndicator color={Colors.white} size="small" />
            <Text style={styles.loadingText}>جاري البحث عن المنتج...</Text>
          </View>
        )}

        <View style={styles.footer}>
          {/* زر إغلاق في وضع POS */}
          {isPOSMode && (
            <TouchableOpacity style={styles.closePOSBtn} onPress={() => router.back()}>
              <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.8)" />
              <Text style={styles.closePOSText}>إغلاق والعودة للسلة</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.manualBtn} onPress={() => setManualMode(true)}>
            <Ionicons name="keypad-outline" size={18} color={Colors.white} />
            <Text style={styles.manualBtnText}>إدخال يدوي</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Manual entry sheet */}
      {manualMode && (
        <View style={styles.manualSheet}>
          <SafeAreaView edges={['bottom']}>
            <View style={{ padding: Spacing.lg }}>
              <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center',
                             marginBottom: Spacing.md }}>
                <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.gray800 }}>
                  إدخال الباركود يدوياً
                </Text>
                <TouchableOpacity onPress={() => { setManualMode(false); setManualCode(''); }}>
                  <Ionicons name="close" size={24} color={Colors.gray500} />
                </TouchableOpacity>
              </View>
              <Input
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="اكتب رقم الباركود..."
                keyboardType="number-pad"
                autoFocus
              />
              <Button title={isPOSMode ? 'إضافة للسلة' : 'بحث'} onPress={submitManual} fullWidth disabled={!manualCode.trim()} />
            </View>
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  permissionTitle: { fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.gray800,
                      textAlign: 'center', marginTop: Spacing.lg },
  permissionSubtitle: { fontSize: 14, color: Colors.gray400, textAlign: 'center', marginTop: 6 },
  overlay: { flex: 1, justifyContent: 'space-between' },
  header: { padding: Spacing.lg, alignItems: 'center' },
  headerTitle: { color: Colors.white, fontSize: Fonts.sizes.lg, fontWeight: '800',
                 textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  posModeHeader: { alignItems: 'center', gap: 4 },
  posModeHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12,
                 textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  frameWrap: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  frame: { width: 260, height: 160, borderRadius: Radius.lg, borderWidth: 3, borderColor: Colors.accent,
           backgroundColor: 'transparent' },
  hint: { color: Colors.white, fontSize: 13, fontWeight: '600',
          textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },

  // وضع POS: بطاقة تأكيد الإضافة
  addedPill: {
    position: 'absolute', top: '48%', alignSelf: 'center',
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(16,185,129,0.92)', paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: Radius.full,
  },
  addedText: { color: Colors.white, fontSize: 14, fontWeight: '800' },

  // مؤشر البحث (وضع المخزون)
  loadingPill: { position: 'absolute', top: '48%', alignSelf: 'center',
                 flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                 backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 16, paddingVertical: 10,
                 borderRadius: Radius.full },
  loadingText: { color: Colors.white, fontSize: 13, fontWeight: '600' },

  footer: { padding: Spacing.xl, alignItems: 'center', gap: 12 },
  closePOSBtn: {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: Radius.full,
  },
  closePOSText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  manualBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
               backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 20, paddingVertical: 12,
               borderRadius: Radius.full },
  manualBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  manualSheet: { position: 'absolute', bottom: 0, left: 0, right: 0,
                 backgroundColor: Colors.white, borderTopLeftRadius: Radius['2xl'],
                 borderTopRightRadius: Radius['2xl'] },
});