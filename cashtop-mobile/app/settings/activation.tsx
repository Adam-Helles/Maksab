import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuthStore } from '../../src/store/authStore';

export default function ActivationScreen() {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const setSubscriptionExpired = useAuthStore(s => s.setSubscriptionExpired);

  const handleActivate = async () => {
    if (!key.trim()) {
      Alert.alert('تنبيه', 'يرجى إدخال مفتاح التفعيل');
      return;
    }

    setIsLoading(true);
    try {
      const { data } = await api.post('/licenses/activate', { key: key.trim() });
      Alert.alert('نجاح', 'تم تفعيل الاشتراك بنجاح!');
      setSubscriptionExpired(false); // Reset the expiration state
      router.back(); // Go back to where the user was
    } catch (error: any) {
      Alert.alert('خطأ', error.message || 'فشل التفعيل، تأكد من صحة المفتاح');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>تفعيل / تجديد الاشتراك</Text>
      
      <Text style={styles.subtitle}>
        الرجاء إدخال مفتاح التفعيل الذي حصلت عليه لتجديد اشتراكك والاستمرار في استخدام ميزات النظام كاملة.
      </Text>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={key}
          onChangeText={setKey}
          autoCapitalize="characters"
        />
      </View>

      <TouchableOpacity 
        style={[styles.button, isLoading && styles.buttonDisabled]} 
        onPress={handleActivate}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>تفعيل الآن</Text>
        )}
      </TouchableOpacity>
      
      <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 20 }}>
        <Text style={{ color: '#6B7280', fontSize: 16 }}>العودة</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 24,
  },
  inputContainer: {
    width: '100%',
    marginBottom: 20,
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 15,
    fontSize: 18,
    textAlign: 'center',
    letterSpacing: 2,
  },
  button: {
    backgroundColor: '#1E3A5F',
    width: '100%',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#9CA3AF',
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
