import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Button } from '../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { suppliersApi } from '../../src/api';

export default function NewSupplierScreen() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError('اسم المورد مطلوب');
      return;
    }
    setNameError('');

    const payload = {
      name: name.trim(),
      company: company.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      tax_number: taxNumber.trim() || undefined,
    };

    setSaving(true);
    try {
      await suppliersApi.create(payload);
      router.replace('/suppliers');
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'حدث خطأ أثناء حفظ المورد';
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
          إضافة مورد جديد
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg }} keyboardShouldPersistTaps="handled">
        <Input
          label="اسم المورد *"
          placeholder="مثال: شركة النور للتوزيع"
          value={name}
          onChangeText={(t) => { setName(t); if (nameError) setNameError(''); }}
          error={nameError}
        />

        <Input
          label="اسم الشركة"
          placeholder="اختياري"
          value={company}
          onChangeText={setCompany}
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
          label="الرقم الضريبي"
          placeholder="اختياري"
          value={taxNumber}
          onChangeText={setTaxNumber}
        />

        <Button
          title="حفظ المورد"
          onPress={handleSubmit}
          loading={saving}
          fullWidth
          style={{ marginTop: Spacing.md }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}