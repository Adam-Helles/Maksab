import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Button } from '../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { customersApi } from '../../src/api';
import type { Customer } from '../../src/types';

export default function NewCustomerScreen() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError('اسم العميل مطلوب');
      return;
    }
    setNameError('');

    const payload: Partial<Customer> = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      credit_limit: creditLimit.trim() ? Number(creditLimit) : 0,
    };

    setSaving(true);
    try {
      const created = await customersApi.create(payload);
      router.replace({ pathname: '/customers/[id]', params: { id: String(created.id) } });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'حدث خطأ أثناء حفظ العميل';
      Alert.alert('تعذر الحفظ', String(detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
          إضافة عميل جديد
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }} keyboardShouldPersistTaps="handled">
        <Input
          label="اسم العميل *"
          placeholder="مثال: أبو محمد"
          value={name}
          onChangeText={(t) => { setName(t); if (nameError) setNameError(''); }}
          error={nameError}
        />

        <Input
          label="رقم الهاتف"
          placeholder="05xxxxxxxx"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <Input
          label="البريد الإلكتروني"
          placeholder="example@mail.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Input
          label="العنوان"
          placeholder="اختياري"
          value={address}
          onChangeText={setAddress}
        />

        <Input
          label="سقف الدين المسموح (₪)"
          placeholder="0"
          value={creditLimit}
          onChangeText={setCreditLimit}
          keyboardType="numeric"
        />

        <Button
          title="حفظ العميل"
          onPress={handleSubmit}
          loading={saving}
          fullWidth
          style={{ marginTop: Spacing.md }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}