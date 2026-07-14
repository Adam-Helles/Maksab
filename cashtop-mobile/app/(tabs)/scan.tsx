import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Vibration, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius } from '../../src/types/theme';
import { productsApi } from '../../src/api';

const SCAN_COOLDOWN_MS = 1500;

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(true);
  const [looking, setLooking] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  // Re-enable scanning every time the tab regains focus (coming back from a product screen)
  useFocusEffect(useCallback(() => {
    setScanning(true);
    setLooking(false);
  }, []));

  const lookupBarcode = useCallback(async (code: string) => {
    setLooking(true);
    setScanning(false);
    try {
      const result: any = await productsApi.getByBarcode(code);
      const product = result?.product ?? result; // support either { product } or the product itself
      if (product?.id) {
        Vibration.vibrate(80);
        router.push({ pathname: '/product/[id]', params: { id: String(product.id) } });
      } else {
        handleNotFound(code);
      }
    } catch (e) {
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

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    const code = result.data?.trim();
    if (!code) return;
    const now = Date.now();
    if (code === lastScanRef.current.code && now - lastScanRef.current.time < SCAN_COOLDOWN_MS) {
      return; // ignore duplicate rapid-fire scans of the same code
    }
    lastScanRef.current = { code, time: now };
    lookupBarcode(code);
  };

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualMode(false);
    setManualCode('');
    lookupBarcode(code);
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
          <Text style={styles.headerTitle}>📷 امسح الباركود</Text>
        </View>

        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.hint}>وجّه الكاميرا نحو الباركود</Text>
        </View>

        {looking && (
          <View style={styles.loadingPill}>
            <ActivityIndicator color={Colors.white} size="small" />
            <Text style={styles.loadingText}>جاري البحث عن المنتج...</Text>
          </View>
        )}

        <View style={styles.footer}>
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
              <Button title="بحث" onPress={submitManual} fullWidth disabled={!manualCode.trim()} />
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
  frameWrap: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  frame: { width: 260, height: 160, borderRadius: Radius.lg, borderWidth: 3, borderColor: Colors.accent,
           backgroundColor: 'transparent' },
  hint: { color: Colors.white, fontSize: 13, fontWeight: '600',
          textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  loadingPill: { position: 'absolute', top: '48%', alignSelf: 'center',
                 flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
                 backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 16, paddingVertical: 10,
                 borderRadius: Radius.full },
  loadingText: { color: Colors.white, fontSize: 13, fontWeight: '600' },
  footer: { padding: Spacing.xl, alignItems: 'center' },
  manualBtn: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
               backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 20, paddingVertical: 12,
               borderRadius: Radius.full },
  manualBtnText: { color: Colors.white, fontWeight: '700', fontSize: 14 },
  manualSheet: { position: 'absolute', bottom: 0, left: 0, right: 0,
                 backgroundColor: Colors.white, borderTopLeftRadius: Radius['2xl'],
                 borderTopRightRadius: Radius['2xl'] },
});