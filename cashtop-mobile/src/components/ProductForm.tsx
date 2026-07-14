import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input, Card } from './ui';
import { Colors, Fonts, Spacing, Radius } from '../types/theme';
import { categoriesApi } from '../api';
import type { Product, Category, UnitType } from '../types';

const UNIT_OPTIONS: { value: UnitType; label: string }[] = [
  { value: 'piece',  label: 'قطعة'  },
  { value: 'carton', label: 'كرتونة' },
  { value: 'kg',     label: 'كيلو'  },
  { value: 'liter',  label: 'لتر'   },
  { value: 'meter',  label: 'متر'   },
];

export interface ProductFormValues {
  name: string;
  name_ar: string;
  barcode_piece: string;
  barcode_carton: string;
  base_unit: UnitType;
  pieces_per_carton: string;
  cost_price: string;
  retail_price: string;
  wholesale_price: string;
  carton_price: string;
  category_id?: number;
  min_stock_alert: string;
  tax_rate: string;
  has_expiry: boolean;
  expiry_date: string;
  is_featured: boolean;
}

const emptyForm: ProductFormValues = {
  name: '', name_ar: '', barcode_piece: '', barcode_carton: '',
  base_unit: 'piece', pieces_per_carton: '1', cost_price: '', retail_price: '',
  wholesale_price: '', carton_price: '', category_id: undefined,
  min_stock_alert: '5', tax_rate: '0', has_expiry: false, expiry_date: '', is_featured: false,
};

export function productToFormValues(p: Product): ProductFormValues {
  return {
    name: p.name, name_ar: p.name_ar || '',
    barcode_piece: p.barcode_piece || '', barcode_carton: p.barcode_carton || '',
    base_unit: p.base_unit, pieces_per_carton: String(p.pieces_per_carton ?? 1),
    cost_price: String(p.cost_price ?? ''), retail_price: String(p.retail_price ?? ''),
    wholesale_price: String(p.wholesale_price ?? ''), carton_price: String(p.carton_price ?? ''),
    category_id: p.category_id, min_stock_alert: String(p.min_stock_alert ?? 5),
    tax_rate: String(p.tax_rate ?? 0), has_expiry: p.has_expiry,
    expiry_date: p.expiry_date || '', is_featured: p.is_featured,
  };
}

export function formValuesToPayload(v: ProductFormValues): Partial<Product> {
  return {
    name: v.name.trim(),
    name_ar: v.name_ar.trim() || undefined,
    barcode_piece: v.barcode_piece.trim() || undefined,
    barcode_carton: v.barcode_carton.trim() || undefined,
    base_unit: v.base_unit,
    pieces_per_carton: Number(v.pieces_per_carton) || 1,
    cost_price: Number(v.cost_price) || 0,
    retail_price: Number(v.retail_price) || 0,
    wholesale_price: Number(v.wholesale_price) || Number(v.retail_price) || 0,
    carton_price: Number(v.carton_price) || 0,
    category_id: v.category_id,
    min_stock_alert: Number(v.min_stock_alert) || 0,
    tax_rate: Number(v.tax_rate) || 0,
    has_expiry: v.has_expiry,
    expiry_date: v.has_expiry ? (v.expiry_date.trim() || undefined) : undefined,
    is_featured: v.is_featured,
  };
}

interface ProductFormProps {
  initialValues?: ProductFormValues;
  initialBarcode?: string;
  submitLabel: string;
  onSubmit: (values: ProductFormValues) => Promise<void>;
}

export const ProductForm: React.FC<ProductFormProps> = ({
  initialValues, initialBarcode, submitLabel, onSubmit,
}) => {
  const [values, setValues] = useState<ProductFormValues>(
    initialValues || (initialBarcode ? { ...emptyForm, barcode_piece: initialBarcode } : emptyForm)
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ProductFormValues>(key: K, val: ProductFormValues[K]) =>
    setValues(prev => ({ ...prev, [key]: val }));

  useEffect(() => {
    categoriesApi.list().then(setCategories).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    setError('');
    if (!values.name.trim()) {
      setError('اسم المنتج مطلوب');
      return;
    }
    if (!values.retail_price || Number(values.retail_price) <= 0) {
      setError('سعر البيع مطلوب ويجب أن يكون أكبر من صفر');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'حدث خطأ أثناء الحفظ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }}>
      <SectionTitle text="المعلومات الأساسية" />
      <Card style={{ marginBottom: Spacing.lg }}>
        <Input label="اسم المنتج *" value={values.name}
               onChangeText={(t: string) => set('name', t)} placeholder="مثال: عصير برتقال 1 لتر" />
        <Input label="الاسم بالعربي" value={values.name_ar}
               onChangeText={(t: string) => set('name_ar', t)} placeholder="اختياري" />
        <Input label="باركود القطعة" value={values.barcode_piece}
               onChangeText={(t: string) => set('barcode_piece', t)} keyboardType="number-pad" />
        <Input label="باركود الكرتونة" value={values.barcode_carton}
               onChangeText={(t: string) => set('barcode_carton', t)} keyboardType="number-pad" />
      </Card>

      <SectionTitle text="الوحدة والتعبئة" />
      <Card style={{ marginBottom: Spacing.lg }}>
        <ChipRow
          options={UNIT_OPTIONS.map(u => ({ value: u.value, label: u.label }))}
          selected={values.base_unit}
          onSelect={v => set('base_unit', v as UnitType)}
        />
        <Input label="عدد القطع بالكرتونة" value={values.pieces_per_carton}
               onChangeText={(t: string) => set('pieces_per_carton', t)} keyboardType="number-pad"
               containerStyle={{ marginTop: Spacing.md }} />
      </Card>

      <SectionTitle text="الأسعار" />
      <Card style={{ marginBottom: Spacing.lg }}>
        <Input label="سعر التكلفة" value={values.cost_price}
               onChangeText={(t: string) => set('cost_price', t)} keyboardType="decimal-pad" />
        <Input label="سعر البيع (قطعة) *" value={values.retail_price}
               onChangeText={(t: string) => set('retail_price', t)} keyboardType="decimal-pad" />
        <Input label="سعر الجملة" value={values.wholesale_price}
               onChangeText={(t: string) => set('wholesale_price', t)} keyboardType="decimal-pad" />
        <Input label="سعر الكرتونة" value={values.carton_price}
               onChangeText={(t: string) => set('carton_price', t)} keyboardType="decimal-pad" />
        <Input label="نسبة الضريبة %" value={values.tax_rate}
               onChangeText={(t: string) => set('tax_rate', t)} keyboardType="decimal-pad" />
      </Card>

      <SectionTitle text="التصنيف" />
      <Card style={{ marginBottom: Spacing.lg }}>
        {categories.length === 0 ? (
          <Text style={{ color: Colors.gray400, textAlign: 'right' }}>لا توجد أصناف بعد</Text>
        ) : (
          <ChipRow
            options={categories.map(c => ({ value: c.id, label: c.name_ar || c.name }))}
            selected={values.category_id}
            onSelect={v => set('category_id', v as number)}
            allowClear
          />
        )}
      </Card>

      <SectionTitle text="المخزون وتاريخ الصلاحية" />
      <Card style={{ marginBottom: Spacing.lg }}>
        <Input label="حد التنبيه للمخزون المنخفض" value={values.min_stock_alert}
               onChangeText={(t: string) => set('min_stock_alert', t)} keyboardType="number-pad" />

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                       marginTop: Spacing.sm, marginBottom: values.has_expiry ? Spacing.md : 0 }}>
          <Text style={{ fontSize: Fonts.sizes.base, color: Colors.gray700, fontWeight: '600' }}>
            له تاريخ صلاحية
          </Text>
          <Switch
            value={values.has_expiry}
            onValueChange={v => set('has_expiry', v)}
            trackColor={{ false: Colors.gray200, true: Colors.accentLight }}
            thumbColor={values.has_expiry ? Colors.accent : Colors.gray400}
          />
        </View>
        {values.has_expiry && (
          <Input label="تاريخ الصلاحية (YYYY-MM-DD)" value={values.expiry_date}
                 onChangeText={(t: string) => set('expiry_date', t)} placeholder="2026-12-31" />
        )}

        <View style={{ flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between',
                       marginTop: Spacing.sm }}>
          <Text style={{ fontSize: Fonts.sizes.base, color: Colors.gray700, fontWeight: '600' }}>
            منتج مميز (يظهر بالمنيو)
          </Text>
          <Switch
            value={values.is_featured}
            onValueChange={v => set('is_featured', v)}
            trackColor={{ false: Colors.gray200, true: Colors.accentLight }}
            thumbColor={values.is_featured ? Colors.accent : Colors.gray400}
          />
        </View>
      </Card>

      {!!error && (
        <Text style={{ color: Colors.danger, textAlign: 'center', marginBottom: Spacing.md, fontWeight: '600' }}>
          {error}
        </Text>
      )}

      <Button title={submitLabel} onPress={handleSubmit} loading={submitting} fullWidth size="lg" />
    </ScrollView>
  );
};

// ── Helpers ──────────────────────────────────────────────

const SectionTitle: React.FC<{ text: string }> = ({ text }) => (
  <Text style={{ fontSize: Fonts.sizes.sm, fontWeight: '700', color: Colors.gray500,
                 textAlign: 'right', marginBottom: Spacing.sm, marginTop: Spacing.xs }}>
    {text}
  </Text>
);

function ChipRow<T extends string | number>({
  options, selected, onSelect, allowClear,
}: {
  options: { value: T; label: string }[];
  selected?: T;
  onSelect: (v: T) => void;
  allowClear?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const active = selected === opt.value;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            onPress={() => allowClear && active ? onSelect(undefined as any) : onSelect(opt.value)}
            style={{
              paddingHorizontal: 14, paddingVertical: 8,
              borderRadius: Radius.full,
              backgroundColor: active ? Colors.primary : Colors.gray100,
              borderWidth: active ? 0 : 1, borderColor: Colors.gray200,
            }}
          >
            <Text style={{ color: active ? Colors.white : Colors.gray600, fontWeight: '600', fontSize: 13 }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}