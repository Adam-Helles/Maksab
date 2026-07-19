import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { Button, Input } from '../../src/components/ui';
import { Colors, Spacing, Radius, Fonts } from '../../src/types/theme';

interface FormErrors {
  store_name?: string;
  username?: string;
  full_name?: string;
  password?: string;
  confirmPassword?: string;
  license_key?: string;
}

export default function SignupScreen() {
  const router = useRouter();
  const { signup, isLoading, error, clearError } = useAuthStore();

  const [storeName, setStoreName]   = useState('');
  const [ownerName, setOwnerName]   = useState('');
  const [storePhone, setStorePhone] = useState('');

  const [username, setUsername]     = useState('');
  const [fullName, setFullName]     = useState('');
  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass]     = useState(false);
  const [licenseKey, setLicenseKey] = useState('');

  const [errors, setErrors] = useState<FormErrors>({});

  const validate = () => {
    const e: FormErrors = {};
    if (!storeName.trim()) e.store_name = 'اسم المحل مطلوب';
    if (!username.trim()) e.username = 'اسم المستخدم مطلوب';
    else if (username.trim().length < 3) e.username = 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل';
    if (!fullName.trim()) e.full_name = 'اسمك الكامل مطلوب';
    if (!password) e.password = 'كلمة المرور مطلوبة';
    else if (password.length < 8) e.password = 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
    if (confirmPassword !== password) e.confirmPassword = 'كلمتا المرور غير متطابقتين';
    if (!licenseKey.trim()) e.license_key = 'مفتاح التفعيل مطلوب — تواصل مع الدعم للحصول عليه';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSignup = async () => {
    if (!validate()) return;
    clearError();
    try {
      await signup({
        store_name: storeName.trim(),
        owner_name: ownerName.trim() || undefined,
        store_phone: storePhone.trim() || undefined,
        username: username.trim().toLowerCase(),
        full_name: fullName.trim(),
        email: email.trim() || undefined,
        password,
        license_key: licenseKey.trim().toUpperCase(),
      });
      // النجاح بيسجّل الدخول تلقائياً — الـ layout الرئيسي رح يحوّل المستخدم لشاشة التطبيق
    } catch {
      // الخطأ يُعرض من الـ store
    }
  };

  return (
    <LinearGradient
      colors={['#1E3A5F', '#2D5187', '#1E3A5F']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.gradient}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Logo ─────────────────────────────────────── */}
          <View style={styles.logoSection}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoEmoji}>🏪</Text>
            </View>
            <Text style={styles.appName}>مَكْسَب</Text>
            <Text style={styles.appSub}>سجّل محلك وابدأ خلال دقيقة</Text>
          </View>

          {/* ── Form Card ───────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>حساب تاجر جديد</Text>

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.sectionLabel}>بيانات المحل</Text>

            <Input
              label="اسم المحل"
              value={storeName}
              onChangeText={(t) => { setStoreName(t); setErrors(e => ({ ...e, store_name: undefined })); }}
              placeholder="مثال: محل أبو علي"
              error={errors.store_name}
              leftIcon={<Ionicons name="storefront-outline" size={18} color={Colors.gray400} />}
            />

            <Input
              label="اسم صاحب المحل (اختياري)"
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="أدخل اسمك"
              leftIcon={<Ionicons name="person-outline" size={18} color={Colors.gray400} />}
            />

            <Input
              label="هاتف المحل (اختياري)"
              value={storePhone}
              onChangeText={setStorePhone}
              placeholder="05xxxxxxxx"
              keyboardType="phone-pad"
              leftIcon={<Ionicons name="call-outline" size={18} color={Colors.gray400} />}
            />

            <Text style={[styles.sectionLabel, { marginTop: Spacing.sm }]}>حساب الدخول</Text>

            <Input
              label="اسم المستخدم"
              value={username}
              onChangeText={(t) => { setUsername(t); setErrors(e => ({ ...e, username: undefined })); }}
              placeholder="أدخل اسم مستخدم للدخول"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.username}
              leftIcon={<Ionicons name="at-outline" size={18} color={Colors.gray400} />}
            />

            <Input
              label="اسمك الكامل"
              value={fullName}
              onChangeText={(t) => { setFullName(t); setErrors(e => ({ ...e, full_name: undefined })); }}
              placeholder="الاسم الكامل"
              error={errors.full_name}
              leftIcon={<Ionicons name="id-card-outline" size={18} color={Colors.gray400} />}
            />

            <Input
              label="البريد الإلكتروني (اختياري)"
              value={email}
              onChangeText={setEmail}
              placeholder="example@mail.com"
              keyboardType="email-address"
              autoCapitalize="none"
              leftIcon={<Ionicons name="mail-outline" size={18} color={Colors.gray400} />}
            />

            <Input
              label="كلمة المرور"
              value={password}
              onChangeText={(t) => { setPassword(t); setErrors(e => ({ ...e, password: undefined })); }}
              placeholder="8 أحرف على الأقل"
              secureTextEntry={!showPass}
              error={errors.password}
              leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.gray400} />}
              rightIcon={
                <Pressable onPress={() => setShowPass(v => !v)} hitSlop={8}>
                  <Ionicons
                    name={showPass ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={Colors.gray400}
                  />
                </Pressable>
              }
            />

            <Input
              label="تأكيد كلمة المرور"
              value={confirmPassword}
              onChangeText={(t) => { setConfirmPassword(t); setErrors(e => ({ ...e, confirmPassword: undefined })); }}
              placeholder="أعد إدخال كلمة المرور"
              secureTextEntry={!showPass}
              error={errors.confirmPassword}
              leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.gray400} />}
            />

            {/* ── مفتاح التفعيل ────────────────────────── */}
            <View style={styles.licenseSection}>
              <View style={styles.licenseTitleRow}>
                <Ionicons name="key-outline" size={18} color="#F59E0B" />
                <Text style={styles.licenseSectionLabel}>مفتاح التفعيل</Text>
              </View>
              <Text style={styles.licenseHint}>
                تحتاج مفتاح تفعيل للانضمام — تواصل معنا للحصول عليه
              </Text>
              <Input
                label=""
                value={licenseKey}
                onChangeText={(t) => { setLicenseKey(t); setErrors(e => ({ ...e, license_key: undefined })); }}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                error={errors.license_key}
                leftIcon={<Ionicons name="shield-checkmark-outline" size={18} color={Colors.gray400} />}
              />
            </View>

            <Button
              title="إنشاء الحساب"
              onPress={handleSignup}
              loading={isLoading}
              fullWidth
              size="lg"
              style={{ marginTop: Spacing.sm }}
            />

            <Pressable style={styles.loginLink} onPress={() => router.back()}>
              <Text style={styles.loginLinkText}>عندك حساب مسبقاً؟ سجّل الدخول</Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>v1.0.0 © 2025 Maksab</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient:     { flex: 1 },
  scroll:       { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  logoSection:  { alignItems: 'center', marginBottom: Spacing['2xl'] },
  logoCircle:   {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  logoEmoji:    { fontSize: 38 },
  appName:      { fontSize: 30, fontWeight: '900', color: Colors.white, letterSpacing: 1 },
  appSub:       { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 4 },

  card:         {
    backgroundColor: Colors.white,
    borderRadius: Radius['2xl'],
    padding: Spacing['2xl'],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 12,
  },
  cardTitle:    {
    fontSize: Fonts.sizes['2xl'], fontWeight: '800',
    color: Colors.primary, textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    fontSize: 13, fontWeight: '700', color: Colors.gray500,
    textAlign: 'right', marginBottom: Spacing.sm,
  },
  errorBox:     {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    backgroundColor: Colors.dangerLight, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  errorText:    { color: Colors.danger, fontSize: 13, flex: 1, textAlign: 'right' },

  licenseSection: {
    marginTop: Spacing.md,
    backgroundColor: '#FFFBEB',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  licenseTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  licenseSectionLabel: {
    fontSize: 14, fontWeight: '800', color: '#92400E',
    textAlign: 'right',
  },
  licenseHint: {
    fontSize: 12, color: '#92400E', textAlign: 'right',
    marginBottom: Spacing.sm,
  },

  loginLink:     { alignItems: 'center', marginTop: Spacing.lg },
  loginLinkText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  footer:       { textAlign: 'center', color: 'rgba(255,255,255,0.4)', marginTop: Spacing.xl, fontSize: 12 },
});