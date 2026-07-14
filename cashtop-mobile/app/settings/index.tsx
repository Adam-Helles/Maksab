import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Button, Card } from '../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { settingsApi, type StoreSettings } from '../../src/api/settings';
import { useIsManager } from '../../src/store/authStore';

export default function SettingsScreen() {
  const router = useRouter();
  const isManager = useIsManager();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<StoreSettings>>({});

  useEffect(() => {
    settingsApi.get()
      .then(setForm)
      .catch(() => Alert.alert('خطأ', 'تعذّر تحميل إعدادات المحل'))
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.store_name?.trim()) {
      Alert.alert('اسم المحل مطلوب');
      return;
    }
    setSaving(true);
    try {
      const updated = await settingsApi.update({
        store_name: form.store_name?.trim(),
        logo_url: form.logo_url?.trim() || undefined,
        currency: form.currency?.trim() || undefined,
        phone: form.phone?.trim() || undefined,
        address: form.address?.trim() || undefined,
        tax_number: form.tax_number?.trim() || undefined,
        invoice_footer_note: form.invoice_footer_note?.trim() || undefined,
      });
      setForm(updated);
      Alert.alert('تم الحفظ ✅');
    } catch (e: any) {
      const status = e?.response?.status;
      Alert.alert('خطأ', status === 403
        ? 'تعديل الإعدادات متاح للمدير فقط'
        : (e?.response?.data?.detail || 'تعذّر حفظ الإعدادات'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          ⚙️ إعدادات النظام
        </Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }}>
          {!isManager && (
            <Card style={{ marginBottom: Spacing.lg, backgroundColor: Colors.warningLight }}>
              <Text style={{ color: '#92400E', textAlign: 'center', fontWeight: '600', fontSize: 13 }}>
                يمكنك الاطلاع على الإعدادات فقط — التعديل متاح للمدير
              </Text>
            </Card>
          )}

          <Card style={{ marginBottom: Spacing.lg }}>
            <Input
              label="اسم المحل *"
              value={form.store_name ?? ''}
              onChangeText={(t: string) => set('store_name', t)}
              editable={isManager}
            />
            <Input
              label="رابط الشعار (Logo URL)"
              value={form.logo_url ?? ''}
              onChangeText={(t: string) => set('logo_url', t)}
              placeholder="https://..."
              editable={isManager}
            />
            <Input
              label="رمز العملة"
              value={form.currency ?? ''}
              onChangeText={(t: string) => set('currency', t)}
              placeholder="₪"
              editable={isManager}
            />
          </Card>

          <Card style={{ marginBottom: Spacing.lg }}>
            <Input
              label="هاتف المحل"
              value={form.phone ?? ''}
              onChangeText={(t: string) => set('phone', t)}
              keyboardType="phone-pad"
              editable={isManager}
            />
            <Input
              label="العنوان"
              value={form.address ?? ''}
              onChangeText={(t: string) => set('address', t)}
              editable={isManager}
            />
            <Input
              label="الرقم الضريبي"
              value={form.tax_number ?? ''}
              onChangeText={(t: string) => set('tax_number', t)}
              editable={isManager}
            />
          </Card>

          <Card style={{ marginBottom: Spacing.lg }}>
            <Input
              label="ملاحظة أسفل الفاتورة"
              value={form.invoice_footer_note ?? ''}
              onChangeText={(t: string) => set('invoice_footer_note', t)}
              placeholder="مثال: شكراً لتعاملكم معنا"
              editable={isManager}
            />
          </Card>

          {isManager && (
            <Button title="حفظ الإعدادات" onPress={handleSave} loading={saving} fullWidth size="lg" />
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}