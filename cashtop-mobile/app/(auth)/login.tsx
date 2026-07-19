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

export default function LoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass,  setShowPass] = useState(false);
  const [errors,    setErrors]   = useState<{ username?: string; password?: string }>({});

  const { login, isLoading, error, clearError } = useAuthStore();

  const validate = () => {
    const e: typeof errors = {};
    if (!username.trim()) e.username = 'اسم المستخدم مطلوب';
    if (!password.trim()) e.password = 'كلمة المرور مطلوبة';
    if (password.length > 0 && password.length < 6)
      e.password = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) return;
    clearError();
    try {
      await login(username.trim().toLowerCase(), password);
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
              <Text style={styles.logoEmoji}>💰</Text>
            </View>
            <Text style={styles.appName}>مَكْسَب</Text>
            <Text style={styles.appSub}>نظام إدارة المحل المتكامل</Text>
          </View>

          {/* ── Form Card ───────────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>تسجيل الدخول</Text>

            {/* رسالة الخطأ */}
            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={18} color={Colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* اسم المستخدم */}
            <Input
              label="اسم المستخدم"
              value={username}
              onChangeText={(t) => { setUsername(t); setErrors(e => ({ ...e, username: undefined })); }}
              placeholder="أدخل اسم المستخدم"
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.username}
              leftIcon={<Ionicons name="person-outline" size={18} color={Colors.gray400} />}
            />

            {/* كلمة المرور */}
            <Input
              label="كلمة المرور"
              value={password}
              onChangeText={(t) => { setPassword(t); setErrors(e => ({ ...e, password: undefined })); }}
              placeholder="أدخل كلمة المرور"
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

            {/* زر الدخول */}
            <Button
              title="دخول"
              onPress={handleLogin}
              loading={isLoading}
              fullWidth
              size="lg"
              style={{ marginTop: Spacing.sm }}
            />

            {/* رابط تسجيل تاجر جديد */}
            <Pressable style={styles.signupLink} onPress={() => router.push('/(auth)/signup')}>
              <Text style={styles.signupLinkText}>ليس لديك محل مسجّل؟ سجّل الآن</Text>
            </Pressable>
          </View>

          {/* ── Footer ──────────────────────────────────── */}
          <Text style={styles.footer}>v1.0.0 © 2025 Maksab</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient:     { flex: 1 },
  scroll:       { flexGrow: 1, justifyContent: 'center', padding: Spacing.xl },
  logoSection:  { alignItems: 'center', marginBottom: Spacing['3xl'] },
  logoCircle:   {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  logoEmoji:    { fontSize: 44 },
  appName:      { fontSize: 34, fontWeight: '900', color: Colors.white, letterSpacing: 1 },
  appSub:       { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4 },

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
    marginBottom: Spacing.xl,
  },
  errorBox:     {
    flexDirection: 'row-reverse', alignItems: 'center', gap: 8,
    backgroundColor: Colors.dangerLight, borderRadius: Radius.md,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  errorText:    { color: Colors.danger, fontSize: 13, flex: 1, textAlign: 'right' },

  signupLink:     { alignItems: 'center', marginTop: Spacing.lg },
  signupLinkText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },

  footer:       { textAlign: 'center', color: 'rgba(255,255,255,0.4)', marginTop: Spacing.xl, fontSize: 12 },
});