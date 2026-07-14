import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { customersApi } from "../api";
import { isBackendReachable } from "../api/client";
import { searchCustomersCache } from "../db/customerSync";
import type { Customer } from "../types";
import { Colors, Fonts, Radius, Spacing } from "../types/theme";
import { Badge, Input } from "./ui";

interface CustomerPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (customer: Customer | null) => void;
}

export const CustomerPickerModal: React.FC<CustomerPickerModalProps> = ({
  visible,
  onClose,
  onSelect,
}) => {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const isOnline = await isBackendReachable();

        if (isOnline) {
          const data = await customersApi.list({ search: search.trim() || undefined });
          setOffline(false);
          setCustomers(data);
        } else {
          // ⚠️ لا يوجد نت — نبحث بالكاش المحلي (customers_cache).
          // LocalCustomer فيها نفس الحقول المعروضة هون (name/phone/current_debt)
          // بس ناقصها بعض حقول Customer الكاملة (available_credit وغيرها) —
          // مش مستخدمة بهاي الشاشة أصلاً، فالـ cast آمن هون.
          const cached = searchCustomersCache(search.trim());
          setOffline(true);
          setCustomers(cached as unknown as Customer[]);
        }
      } catch {
        // فشل الطلب الأونلاين (مثلاً انقطع النت أثناء المحاولة) → fallback للكاش
        const cached = searchCustomersCache(search.trim());
        setOffline(true);
        setCustomers(cached as unknown as Customer[]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View
        style={{ flex: 1, backgroundColor: Colors.background, paddingTop: 50 }}
      >
        <View
          style={{
            flexDirection: "row-reverse",
            alignItems: "center",
            justifyContent: "space-between",
            padding: Spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: Colors.border,
            backgroundColor: Colors.white,
          }}
        >
          <Text
            style={{
              fontSize: Fonts.sizes.lg,
              fontWeight: "800",
              color: Colors.primary,
            }}
          >
            اختيار العميل
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={26} color={Colors.gray600} />
          </TouchableOpacity>
        </View>

        {offline && (
          <View
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: 6,
              backgroundColor: "#FFF3CD",
              paddingVertical: 8,
              paddingHorizontal: Spacing.lg,
            }}
          >
            <Ionicons name="cloud-offline-outline" size={16} color="#8A6D00" />
            <Text style={{ fontSize: 12, color: "#8A6D00", fontWeight: "600" }}>
              أوفلاين — نتائج من آخر مزامنة، قد لا تكون محدّثة تماماً
            </Text>
          </View>
        )}

        <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
          <Input
            placeholder="ابحث بالاسم أو الهاتف..."
            value={search}
            onChangeText={setSearch}
            leftIcon={
              <Ionicons name="search" size={18} color={Colors.gray400} />
            }
          />

          <TouchableOpacity
            onPress={() => {
              onSelect(null);
              onClose();
            }}
            style={{
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: 10,
              backgroundColor: Colors.white,
              borderRadius: Radius.lg,
              padding: Spacing.md,
              marginBottom: Spacing.md,
              borderWidth: 1,
              borderColor: Colors.gray200,
            }}
          >
            <Ionicons
              name="person-remove-outline"
              size={20}
              color={Colors.gray500}
            />
            <Text style={{ fontWeight: "700", color: Colors.gray600 }}>
              بدون عميل (عميل نقدي)
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator
            style={{ marginTop: Spacing.xl }}
            color={Colors.primary}
          />
        ) : (
          <FlatList
            data={customers}
            keyExtractor={(c) => String(c.id)}
            contentContainerStyle={{
              padding: Spacing.lg,
              paddingTop: 0,
              gap: Spacing.sm,
            }}
            ListEmptyComponent={
              <Text
                style={{
                  textAlign: "center",
                  color: Colors.gray400,
                  marginTop: Spacing.xl,
                }}
              >
                لا يوجد عملاء مطابقين
              </Text>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => {
                  onSelect(item);
                  onClose();
                }}
                style={{
                  backgroundColor: Colors.white,
                  borderRadius: Radius.lg,
                  padding: Spacing.md,
                  flexDirection: "row-reverse",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontWeight: "700",
                      color: Colors.gray800,
                      textAlign: "right",
                    }}
                  >
                    {item.name}
                  </Text>
                  {!!item.phone && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: Colors.gray400,
                        textAlign: "right",
                        marginTop: 2,
                      }}
                    >
                      {item.phone}
                    </Text>
                  )}
                </View>
                {item.current_debt > 0 && (
                  <Badge
                    label={`دين: ${item.current_debt.toFixed(0)} ₪`}
                    color="red"
                  />
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
};