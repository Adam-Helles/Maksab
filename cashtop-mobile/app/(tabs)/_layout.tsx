import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow } from '../../src/types/theme';
import { useCartStore } from '../../src/store/cartStore';

type IconName = keyof typeof Ionicons.glyphMap;

interface TabIcon {
  name: IconName;
  label: string;
  badge?: number;
}

function TabBarIcon({ name, label, focused, badge }: TabIcon & { focused: boolean }) {
  return (
    <View style={styles.tabItem}>
      <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
        <Ionicons
          name={focused ? name : `${name}-outline` as IconName}
          size={22}
          color={focused ? Colors.white : Colors.tabInactive}
        />
        {badge !== undefined && badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const cartCount = useCartStore(s => s.items.length);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle:           styles.tabBar,
        tabBarShowLabel:       false,
        tabBarActiveTintColor:   Colors.primary,
        tabBarInactiveTintColor: Colors.tabInactive,
      }}
    >
      {/* ── الرئيسية ───────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name="grid" label="الرئيسية" focused={focused} />
          ),
        }}
      />

      {/* ── نقطة البيع ─────────────────────────────────── */}
      <Tabs.Screen
        name="pos"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon
              name="cart"
              label="البيع"
              focused={focused}
              badge={cartCount}
            />
          ),
        }}
      />

      {/* ── زر البيع الوسطي ──────────────────────────── */}
      <Tabs.Screen
        name="scan"
        options={{
          tabBarIcon: ({ focused }) => (
            <View style={styles.scanBtn}>
              <Ionicons name="scan" size={26} color={Colors.white} />
            </View>
          ),
        }}
      />

      {/* ── المنتجات ──────────────────────────────────── */}
      <Tabs.Screen
        name="products"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name="cube" label="المنتجات" focused={focused} />
          ),
        }}
      />

      {/* ── المزيد ─────────────────────────────────────── */}
      <Tabs.Screen
        name="more"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabBarIcon name="menu" label="المزيد" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor:  Colors.white,
    borderTopWidth:   0,
    height:           70,
    paddingBottom:    8,
    paddingTop:       6,
    ...Shadow.md,
  },
  tabItem: {
    alignItems: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 42, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.lg,
  },
  iconWrapActive: {
    backgroundColor: Colors.primary,
    width: 50, height: 36,
  },
  tabLabel: {
    fontSize: 10,
    color: Colors.tabInactive,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  // زر المسح الوسطي
  scanBtn: {
    width:  58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...Shadow.lg,
  },
  badge: {
    position: 'absolute',
    top: -4, right: -4,
    backgroundColor: Colors.danger,
    borderRadius: 10,
    minWidth: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: Colors.white, fontSize: 10, fontWeight: '800',
  },
});
