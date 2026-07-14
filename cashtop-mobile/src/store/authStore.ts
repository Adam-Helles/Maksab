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
      set({
        user: tokens.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
    // 1. استخراج الخطأ من Axios
    const serverMessage = err.response?.data?.detail || 'فشل تسجيل الدخول';
    
    // 2. طباعة الخطأ في التيرمنال (المهم جداً للتشخيص)
    console.log("❌ تفاصيل الخطأ:", err.response?.data);
    
    // 3. تحديث الـ state ليظهر الخطأ للمستخدم
    set({
      isLoading: false,
      error: typeof serverMessage === 'string' ? serverMessage : JSON.stringify(serverMessage),
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
      set({
        user: tokens.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      const serverMessage = err.response?.data?.detail || 'فشل إنشاء الحساب';

      console.log("❌ تفاصيل خطأ التسجيل:", err.response?.data);

      set({
        isLoading: false,
        error: typeof serverMessage === 'string' ? serverMessage : JSON.stringify(serverMessage),
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
      if (!accessToken) {
        set({ isLoading: false, isAuthenticated: false });
        return;
      }
      // تحقق من صلاحية الـ token بجلب بيانات المستخدم
      const user = await authApi.me();
      set({ user, isAuthenticated: true, isLoading: false });
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