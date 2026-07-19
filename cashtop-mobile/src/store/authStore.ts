import { create } from 'zustand';
import { authApi } from '../api/auth';
import { TokenStorage } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login:         (username: string, password: string) => Promise<void>;
  signup:        (payload: {
    store_name: string;
    owner_name?: string;
    store_phone?: string;
    username: string;
    full_name: string;
    email?: string;
    phone?: string;
    password: string;
    license_key: string;
  }) => Promise<void>;
  logout:        () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError:    () => void;
  setSubscriptionExpired: (expired: boolean) => void;
  isSubscriptionExpired: boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:            null,
  isAuthenticated: false,
  isLoading:       true,   // true عند بدء التطبيق
  error:           null,
  isSubscriptionExpired: false,
  setSubscriptionExpired: (expired: boolean) => set({ isSubscriptionExpired: expired }),

  // ── تسجيل الدخول ──────────────────────────────────────
  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const tokens = await authApi.login(username, password);
      await TokenStorage.setAccess(tokens.access_token);
      await TokenStorage.setRefresh(tokens.refresh_token);
      await TokenStorage.setUser(tokens.user);
      set({
        user: tokens.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      // client.ts يحوّل كل أخطاء Axios لـ new Error(message) عربي —
      // الرسالة موجودة في err.message مباشرة وليس في err.response.data.detail
      const serverMessage = err?.message || 'فشل تسجيل الدخول';
      set({
        isLoading: false,
        error: serverMessage,
      });
      throw err;
    }
  },

  // ── تسجيل تاجر جديد (محل + أول أدمن) ──────────────────
  signup: async (payload) => {
    set({ isLoading: true, error: null });
    try {
      const tokens = await authApi.signup(payload);
      await TokenStorage.setAccess(tokens.access_token);
      await TokenStorage.setRefresh(tokens.refresh_token);
      await TokenStorage.setUser(tokens.user);
      set({
        user: tokens.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      // client.ts يحوّل كل أخطاء Axios لـ new Error(message) عربي
      const serverMessage = err?.message || 'فشل إنشاء الحساب';
      set({
        isLoading: false,
        error: serverMessage,
      });
      throw err;
    }
  },

  // ── تسجيل الخروج ──────────────────────────────────────
  logout: async () => {
    await TokenStorage.clear();
    set({ user: null, isAuthenticated: false, error: null });
  },

  // ── استعادة الجلسة عند فتح التطبيق ───────────────────
  restoreSession: async () => {
    set({ isLoading: true });
    try {
      const accessToken = await TokenStorage.getAccess();
      const localUser = await TokenStorage.getUser();

      if (!accessToken || !localUser) {
        set({ isLoading: false, isAuthenticated: false });
        return;
      }

      // 1. الدخول فوراً باستخدام البيانات المحلية (Offline-First)
      // يضمن أن التطبيق يفتح فوراً بدون إنترنت، ويتجاوز شاشة الدخول بنجاح.
      set({ user: localUser, isAuthenticated: true, isLoading: false });

      // 2. تحديث بيانات المستخدم في الخلفية (إذا كان متصلاً)
      try {
        const user = await authApi.me();
        await TokenStorage.setUser(user); // تحديث الكاش المحلي
        set({ user });
      } catch (err: any) {
        // إذا كان الخطأ 401 (التوكن منتهي أو غير صالح)، نقوم بتسجيل الخروج.
        // أما أخطاء الشبكة (Timeout, 500, Offline) فنتجاهلها ليبقى المستخدم مسجلاً.
        if (err.response?.status === 401) {
          await TokenStorage.clear();
          set({ user: null, isAuthenticated: false });
        }
      }
    } catch {
      await TokenStorage.clear();
      set({ isLoading: false, isAuthenticated: false });
    }
  },

  clearError: () => set({ error: null }),
}));

// ── Permission helpers ─────────────────────────────────────
export const useIsAdmin    = () => useAuthStore(s => s.user?.role === 'admin');
export const useIsManager  = () => useAuthStore(s =>
  s.user?.role === 'admin' || s.user?.role === 'manager'
);