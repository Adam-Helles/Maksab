import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Button } from '../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { recordNewSupplierLocal } from '../../src/db/supplierSync';

export default function NewSupplierScreen() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) {
      setNameError('اسم المورد مطلوب');
      return;
    }
    setNameError('');
    setSaving(true);
    try {
      recordNewSupplierLocal({
        name: name.trim(),
        company: company.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      router.replace('/suppliers');
    } catch (err: any) {
      Alert.alert('خطأ', 'حدث خطأ أثناء الحفظ');
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
        <View style={{ backgroundColor: Colors.info + '20', padding: Spacing.md, borderRadius: 8, marginBottom: Spacing.lg }}>
          <Text style={{ color: Colors.info, textAlign: 'right', fontSize: 13, fontWeight: '600' }}>
            📶 سيتم حفظ المورد محلياً ومزامنته تلقائياً عند توفر الإنترنت
          </Text>
        </View>

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