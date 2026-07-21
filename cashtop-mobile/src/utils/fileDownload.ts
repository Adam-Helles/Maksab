import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa متوفرة عالمياً بالويب وبمحرك Hermes الحديث المستخدم بـ Expo
  return btoa(binary);
}

/**
 * يحفظ ملف ثنائي (Excel/PDF) محلياً ويفتح شاشة المشاركة الأصلية للجوال.
 * على الويب: ينزّل الملف مباشرة عبر المتصفح.
 */
export async function saveAndShareFile(
  data: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return;
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return;
  }

  const base64 = arrayBufferToBase64(data);
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: 'base64',
  });

  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: filename });
  }
}