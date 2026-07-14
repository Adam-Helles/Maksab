# CashTop Mobile 📱

تطبيق React Native (Expo) لنظام إدارة المحل CashTop.

## 🚀 التشغيل

### 1. تثبيت المكتبات
```bash
npm install
```

### 2. ضبط عنوان الـ API
افتح `src/api/client.ts` وعدّل:
```ts
export const BASE_URL = 'http://YOUR_SERVER_IP:8000/api/v1';
```
> ⚠️ استخدم IP جهازك على الشبكة (مش `localhost`)
> Windows: `ipconfig` → IPv4 Address
> Mac/Linux: `ifconfig` → inet

### 3. تشغيل التطبيق
```bash
# تشغيل Expo DevTools
npx expo start

# مباشرة على Android
npx expo start --android

# مباشرة على iOS
npx expo start --ios
```

### 4. تشغيل على الجهاز
1. نزّل **Expo Go** من متجر التطبيقات
2. امسح QR Code الظاهر في الترمينال

---

## 🏗️ هيكل المشروع

```
cashtop-mobile/
├── app/                    ← Expo Router (شاشات)
│   ├── _layout.tsx         ← Root layout + Auth guard
│   ├── (auth)/
│   │   └── login.tsx       ← شاشة تسجيل الدخول
│   └── (tabs)/
│       ├── _layout.tsx     ← Bottom Tab Navigation
│       ├── index.tsx       ← Dashboard (الرئيسية)
│       ├── pos.tsx         ← نقطة البيع
│       ├── scan.tsx        ← مسح الباركود
│       ├── products.tsx    ← المنتجات
│       └── more.tsx        ← المزيد / الإعدادات
│
├── src/
│   ├── api/
│   │   ├── client.ts       ← Axios + auto token refresh
│   │   ├── auth.ts         ← Auth API calls
│   │   └── index.ts        ← Products, Customers, Invoices, Dashboard
│   │
│   ├── store/
│   │   ├── authStore.ts    ← Zustand: المصادقة
│   │   └── cartStore.ts    ← Zustand: سلة POS
│   │
│   ├── components/ui/
│   │   └── index.tsx       ← Button, Input, Card, Badge, StatCard...
│   │
│   ├── hooks/
│   │   └── useQuery.ts     ← Data fetching hooks
│   │
│   └── types/
│       ├── index.ts        ← TypeScript interfaces
│       └── theme.ts        ← Colors, Fonts, Spacing, Radius
```

---

## 🎨 نظام التصميم

```ts
import { Colors, Fonts, Spacing, Radius, Shadow } from '../types/theme';

// الألوان الرئيسية
Colors.primary      // #1E3A5F (أزرق داكن)
Colors.success      // #10B981 (أخضر)
Colors.danger       // #EF4444 (أحمر)
Colors.warning      // #F59E0B (أصفر)
```

---

## 🔑 بيانات الدخول التجريبية
```
Username: admin
Password: Admin@1234
```

---

## 📱 المراحل القادمة
- [ ] المرحلة 2: إدارة المنتجات + ماسح الباركود
- [ ] المرحلة 3: شاشة POS الكاملة
- [ ] المرحلة 4: العملاء والموردين والديون
- [ ] المرحلة 5: التقارير والإعدادات
