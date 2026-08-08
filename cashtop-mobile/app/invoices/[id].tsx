import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, LoadingScreen, Badge } from '../../src/components/ui';
import { Colors, Fonts, Spacing } from '../../src/types/theme';
import { reportsApi } from '../../src/api';
import { getInvoiceWithItems } from '../../src/db/database';
import { isBackendReachable } from '../../src/api/client';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { format } from 'date-fns';

export default function InvoiceDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceIdStr = Array.isArray(id) ? id[0] : id;

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  useEffect(() => {
    function load() {
      try {
        const data = getInvoiceWithItems(invoiceIdStr);
        if (!data) {
          Alert.alert('خطأ', 'الفاتورة غير موجودة');
          router.back();
          return;
        }
        
        // Map LocalInvoice to expected UI shape
        const mappedInvoice = {
          ...data.invoice,
          items: data.items.map(item => ({
            ...item,
            discount_amount: 0 // LocalInvoiceItem doesn't have discount_amount
          }))
        };
        
        setInvoice(mappedInvoice);
      } catch (e) {
        Alert.alert('خطأ', 'فشل تحميل بيانات الفاتورة');
        router.back();
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [invoiceIdStr]);

  const handleExportPDF = async () => {
    const isOnline = await isBackendReachable();
    if (!isOnline) {
      Alert.alert('يتطلب اتصال بالإنترنت', 'لا يمكن تصدير الفاتورة كـ PDF إلا عند توفر اتصال بالإنترنت.');
      return;
    }
    
    setGeneratingPdf(true);
    try {
      // NOTE: server requires numeric ID or UUID? If server uses numeric IDs in old API, this might fail for local-only invoices.
      // We wrap in try-catch.
      const response = await reportsApi.exportInvoicePdf(invoiceIdStr as any);
      const responseStr = typeof response === 'string' ? response : JSON.stringify(response);
      const fileUri = `${(FileSystem as any).documentDirectory ?? ''}invoice_${invoiceIdStr}.pdf`;
      const base64Data = responseStr.split(',')[1] || responseStr;
      await FileSystem.writeAsStringAsync(fileUri, base64Data, {
        encoding: (FileSystem as any).EncodingType?.Base64 ?? 'base64',
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { UTI: '.pdf', mimeType: 'application/pdf' });
      } else {
        Alert.alert('تنبيه', 'المشاركة غير مدعومة على هذا الجهاز');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('خطأ', 'فشل تصدير الفاتورة');
    } finally {
      setGeneratingPdf(false);
    }
  };

  if (loading || !invoice) return <LoadingScreen message="جاري التحميل..." />;

  const isSale = invoice.invoice_type === 'sale';
  
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={{
        flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
        padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.white,
      }}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-forward" size={26} color={Colors.gray600} />
        </TouchableOpacity>
        <Text style={{ fontSize: Fonts.sizes.lg, fontWeight: '800', color: Colors.primary }}>
          تفاصيل الفاتورة #{invoice.invoice_number}
        </Text>
        <TouchableOpacity onPress={handleExportPDF} disabled={generatingPdf}>
          <Ionicons name="print-outline" size={24} color={generatingPdf ? Colors.gray400 : Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 100 }}>
        
        <Card style={{ marginBottom: Spacing.md }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray700 }}>النوع:</Text>
            <Badge label={isSale ? "مبيعات" : "مشتريات"} color={isSale ? "green" : "blue"} />
          </View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray700 }}>التاريخ:</Text>
            <Text style={{ fontSize: Fonts.sizes.base, color: Colors.gray800 }}>
              {format(new Date(invoice.created_at), 'yyyy-MM-dd HH:mm')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray700 }}>الحالة:</Text>
            <Text style={{ fontSize: Fonts.sizes.base, color: Colors.gray800 }}>
              {invoice.status === 'completed' ? 'مكتملة ✅' : invoice.status === 'cancelled' ? 'ملغاة ❌' : 'مسودة'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '700', color: Colors.gray700 }}>حالة الدفع:</Text>
            <Text style={{ fontSize: Fonts.sizes.base, color: Colors.gray800 }}>
              {invoice.payment_status === 'paid' ? 'مدفوعة بالكامل' : invoice.payment_status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة'}
            </Text>
          </View>
        </Card>

        <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '800', color: Colors.gray800, textAlign: 'right', marginBottom: Spacing.sm }}>
          المنتجات ({invoice.items.length})
        </Text>
        
        {invoice.items.map((item: any) => (
          <Card key={item.id} style={{ marginBottom: Spacing.sm, padding: Spacing.md }}>
            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '800', color: Colors.gray800 }}>{item.product_name}</Text>
              <Text style={{ fontWeight: '700', color: Colors.primary }}>{item.total.toFixed(2)} ₪</Text>
            </View>
            <Text style={{ color: Colors.gray500, textAlign: 'right', marginTop: 4 }}>
              الكمية: {item.quantity} {item.unit_type === 'piece' ? 'قطعة' : 'كرتونة'} × {item.unit_price.toFixed(2)} ₪
            </Text>
            {item.discount_amount > 0 && (
              <Text style={{ color: Colors.danger, textAlign: 'right', marginTop: 2, fontSize: 12 }}>
                خصم: {item.discount_amount.toFixed(2)} ₪
              </Text>
            )}
          </Card>
        ))}

        <Card style={{ marginTop: Spacing.md, backgroundColor: '#F8FAFC' }}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
            <Text style={{ color: Colors.gray600 }}>المجموع الفرعي:</Text>
            <Text style={{ fontWeight: '700' }}>{invoice.subtotal.toFixed(2)} ₪</Text>
          </View>
          {invoice.discount_amount > 0 && (
            <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
              <Text style={{ color: Colors.danger }}>خصم إضافي:</Text>
              <Text style={{ fontWeight: '700', color: Colors.danger }}>- {invoice.discount_amount.toFixed(2)} ₪</Text>
            </View>
          )}
          <View style={{ borderBottomWidth: 1, borderBottomColor: Colors.border, marginVertical: Spacing.sm }} />
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '800', color: Colors.gray800 }}>الإجمالي النهائي:</Text>
            <Text style={{ fontSize: Fonts.sizes.base, fontWeight: '800', color: Colors.primary }}>{invoice.total.toFixed(2)} ₪</Text>
          </View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
            <Text style={{ color: Colors.success, fontWeight: '700' }}>المدفوع:</Text>
            <Text style={{ color: Colors.success, fontWeight: '700' }}>{invoice.paid_amount.toFixed(2)} ₪</Text>
          </View>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between' }}>
            <Text style={{ color: Colors.danger, fontWeight: '700' }}>الباقي (دين):</Text>
            <Text style={{ color: Colors.danger, fontWeight: '700' }}>{invoice.remaining_amount.toFixed(2)} ₪</Text>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
