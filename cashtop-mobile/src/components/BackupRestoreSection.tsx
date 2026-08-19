import React, { useEffect, useState } from 'react';
import { View, Text, Alert, ActivityIndicator } from 'react-native';
let DocumentPicker: any;
try {
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.warn('expo-document-picker is not available natively yet');
}
import * as Sharing from 'expo-sharing';
import { Card, Button } from './ui';
import { Colors, Fonts, Spacing } from '../types/theme';
import { createLocalBackup } from '../db/backup';
import { restoreLocalBackup } from '../db/restore';
import { getLastSyncTime, getUnsyncedRecordsCount } from '../db/database';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

export function BackupRestoreSection() {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState<number>(0);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const loadStatus = () => {
    setLastSync(getLastSyncTime());
    setUnsyncedCount(getUnsyncedRecordsCount());
  };

  useEffect(() => {
    import('react-native').then(({ InteractionManager }) => {
      InteractionManager.runAfterInteractions(() => {
        loadStatus();
      });
    });
  }, []);

  const handleExportBackup = async () => {
    setIsBackingUp(true);
    try {
      const backupInfo = await createLocalBackup();
      
      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(backupInfo.path, {
          mimeType: 'application/octet-stream',
          dialogTitle: 'حفظ النسخة الاحتياطية',
          UTI: 'public.database'
        });
        Alert.alert('تم إنشاء النسخة بنجاح ✅', 'تم استخراج وحفظ النسخة الاحتياطية بنجاح.');
      } else {
        Alert.alert('النسخة جاهزة', `تم حفظها في: ${backupInfo.path}`);
      }
    } catch (e: any) {
      Alert.alert('فشل إنشاء النسخة', e.message || 'حدث خطأ غير متوقع');
    } finally {
      setIsBackingUp(false);
      loadStatus();
    }
  };

  const handleRestoreBackup = async () => {
    if (!DocumentPicker) {
      Alert.alert('تحديث مطلوب', 'يرجى تحديث التطبيق من المتجر لاستخدام ميزة الاستعادة.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      if (!file.name.endsWith('.db')) {
        Alert.alert('خطأ', 'يرجى اختيار ملف قاعدة بيانات صالح بصيغة .db');
        return;
      }

      Alert.alert(
        'استعادة النسخة',
        'سيتم دمج البيانات المفقودة من النسخة الاحتياطية مع البيانات الحالية. هل أنت متأكد؟',
        [
          { text: 'إلغاء', style: 'cancel' },
          {
            text: 'استعادة',
            style: 'destructive',
            onPress: async () => {
              setIsRestoring(true);
              try {
                // Remove the "file://" prefix if present on Android
                const path = file.uri.replace('file://', '');
                await restoreLocalBackup(path);
                Alert.alert('تمت الاستعادة بنجاح ✅', 'تم دمج النسخة الاحتياطية بأمان وسيتم مزامنتها مع الخادم قريباً.');
                loadStatus();
              } catch (error: any) {
                let msg = 'حدث خطأ أثناء الاستعادة';
                if (error.message.includes('TENANT_MISMATCH')) msg = 'النسخة الاحتياطية تخص متجرًا آخر!';
                else if (error.message.includes('CORRUPT_BACKUP')) msg = 'ملف النسخة الاحتياطية تالف أو غير صالح.';
                else if (error.message.includes('SCHEMA_MISMATCH')) msg = 'النسخة الاحتياطية غير متوافقة مع الإصدار الحالي.';
                else msg = error.message;

                Alert.alert('فشلت عملية الاستعادة', msg);
              } finally {
                setIsRestoring(false);
              }
            }
          }
        ]
      );
    } catch (e: any) {
      Alert.alert('خطأ', 'تعذر فتح مدير الملفات');
    }
  };

  const formatLastSync = (dateString: string | null) => {
    if (!dateString) return 'لم تتم المزامنة';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return 'لم تتم المزامنة';
      return format(d, 'PPP p', { locale: ar });
    } catch {
      return 'لم تتم المزامنة';
    }
  };

  return (
    <Card style={{ marginBottom: Spacing.lg }}>
      <View style={{ alignItems: 'center', marginBottom: Spacing.md }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: Colors.primary, marginBottom: 4 }}>
          النسخ الاحتياطي والمزامنة
        </Text>
        <Text style={{ fontSize: 13, color: Colors.gray500, textAlign: 'center', marginBottom: Spacing.sm }}>
          آخر مزامنة: {formatLastSync(lastSync)}
        </Text>
      </View>
      
      <View style={{ marginBottom: Spacing.lg }}>
        <Text style={{ color: Colors.gray600, fontSize: Fonts.sizes.sm }}>سجلات غير متزامنة (Pending):</Text>
        <Text style={{ color: unsyncedCount > 0 ? Colors.danger : Colors.success, fontWeight: '600' }}>
          {unsyncedCount} سجل
        </Text>
      </View>

      <View style={{ gap: Spacing.md }}>
        <Button 
          title={isBackingUp ? "جاري الإنشاء..." : "إنشاء نسخة احتياطية (Export)"} 
          onPress={handleExportBackup}
          loading={isBackingUp}
          disabled={isBackingUp || isRestoring}
        />
        
        <Button 
          title={isRestoring ? "جاري الاستعادة..." : "استعادة نسخة احتياطية (Restore)"} 
          onPress={handleRestoreBackup}
          loading={isRestoring}
          disabled={isBackingUp || isRestoring}
          variant="secondary"
        />
      </View>
    </Card>
  );
}
