import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Input, Button, Badge, EmptyState } from '../../src/components/ui';
import { Colors, Fonts, Spacing, Radius, Shadow } from '../../src/types/theme';
import { usersApi } from '../../src/api/users';
import { useIsAdmin } from '../../src/store/authStore';
import type { User, UserRole } from '../../src/types';

const ROLE_LABELS: Record<UserRole, string> = { admin: 'مدير النظام', manager: 'مدير', cashier: 'كاشير' };
const ROLE_OPTIONS: UserRole[] = ['admin', 'manager', 'cashier'];

export default function UsersScreen() {
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = () => {
    usersApi.list().then(setUsers).catch(() => {
      Alert.alert('خطأ', 'تعذّر تحميل قائمة المستخدمين');
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // حماية إضافية على مستوى الواجهة (الباكيند أصلاً يرفض غير الأدمن)
  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <EmptyState icon="🔒" title="هذه الصفحة للمدير فقط" />
      </SafeAreaView>
    );
  }

  const toggleActive = (u: User) => {
    Alert.alert(
      u.is_active ? 'تعطيل المستخدم' : 'تفعيل المستخدم',
      `${u.full_name}`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تأكيد',
          onPress: async () => {
            try {
              await usersApi.update(u.id, { is_active: !u.is_active });
              load();
            } catch {
              Alert.alert('خطأ', 'تعذّر تنفيذ العملية');
            }
          },
        },
      ],
    );
  };

  const changeRole = (u: User) => {
    Alert.alert('تغيير الصلاحية', u.full_name, [
      ...ROLE_OPTIONS.filter(r => r !== u.role).map(r => ({
        text: ROLE_LABELS[r],
        onPress: async () => {
          try {
            await usersApi.update(u.id, { role: r });
            load();
          } catch {
            Alert.alert('خطأ', 'تعذّر تغيير الصلاحية');
          }
        },
      })),
      { text: 'إلغاء', style: 'cancel' as const },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <Text style={{ fontSize: Fonts.sizes.xl, fontWeight: '800', color: Colors.primary }}>
          👥 المستخدمون
        </Text>
        <TouchableOpacity onPress={() => setShowCreate(true)}>
          <Ionicons name="add-circle" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={u => String(u.id)}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
          renderItem={({ item }) => (
            <View style={{
              backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, ...Shadow.sm,
            }}>
              <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: Colors.gray800, textAlign: 'right' }}>
                    {item.full_name}
                  </Text>
                  <Text style={{ fontSize: 12, color: Colors.gray400, textAlign: 'right', marginTop: 2 }}>
                    @{item.username}
                  </Text>
                </View>
                {!item.is_active && <Badge label="معطّل" color="gray" />}
              </View>

              <View style={{ flexDirection: 'row-reverse', gap: 8, marginTop: Spacing.sm }}>
                <TouchableOpacity onPress={() => changeRole(item)}>
                  <Badge label={ROLE_LABELS[item.role]} color="blue" size="md" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => toggleActive(item)}
                  style={{ marginRight: 'auto' }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700',
                                 color: item.is_active ? Colors.danger : Colors.success }}>
                    {item.is_active ? 'تعطيل' : 'تفعيل'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      <CreateUserModal visible={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </SafeAreaView>
  );
}

// ── Create user modal ────────────────────────────────────

function CreateUserModal({ visible, onClose, onCreated }: {
  visible: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('cashier');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setUsername(''); setFullName(''); setPassword(''); setRole('cashier'); };

  const submit = async () => {
    if (!username.trim() || !fullName.trim() || !password.trim()) {
      Alert.alert('املأ الحقول المطلوبة');
      return;
    }
    setSubmitting(true);
    try {
      await usersApi.create({ username: username.trim(), full_name: fullName.trim(), password, role });
      reset();
      onClose();
      onCreated();
    } catch (e: any) {
      Alert.alert('خطأ', e?.response?.data?.detail || 'تعذّر إنشاء المستخدم');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={{
          flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
          padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
        }}>
          <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
            إضافة مستخدم جديد
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={26} color={Colors.gray600} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: Spacing.lg }}>
          <Input label="الاسم الكامل *" value={fullName} onChangeText={setFullName} />
          <Input label="اسم المستخدم *" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <Input label="كلمة المرور *" value={password} onChangeText={setPassword} secureTextEntry />

          <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.gray600,
                         textAlign: 'right', marginBottom: 8 }}>
            الصلاحية
          </Text>
          <View style={{ flexDirection: 'row-reverse', gap: 8, marginBottom: Spacing.lg }}>
            {ROLE_OPTIONS.map(r => {
              const active = role === r;
              return (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRole(r)}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: Radius.lg,
                    backgroundColor: active ? Colors.primary : Colors.white,
                    borderWidth: active ? 0 : 1, borderColor: Colors.gray200,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: active ? Colors.white : Colors.gray600 }}>
                    {ROLE_LABELS[r]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Button title="إنشاء المستخدم" onPress={submit} loading={submitting} fullWidth />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}