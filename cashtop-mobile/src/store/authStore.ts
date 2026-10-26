import { create } from 'zustand';
import { authApi } from '../api/auth';
import { TokenStorage } from '../api/client';
import type { User } from '../types';
import { getStoreId, setStoreId, clearDatabase, hasPendingUnsyncedData, updateLicenseMeta } from '../db/database';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Device transfer state
  deviceMismatch: boolean;
  clearDeviceMismatch: () => void;

  // Actions
  login:         (username: string, password: string) => Promise<void>;
  transferDevice: (username: string, password: string) => Promise<void>;
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
  daysUntilExpiry: number | null;
  fetchSubscriptionStatus: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:            null,
  isAuthenticated: false,
  isLoading:       true,   // true عند بدء التطبيق
  error:           null,
  deviceMismatch:  false,
  isSubscriptionExpired: false,
  daysUntilExpiry: null,
  setSubscriptionExpired: (expired: boolean) => set({ isSubscriptionExpired: expired }),
  clearDeviceMismatch: () => set({ deviceMismatch: false, error: null }),
  
  fetchSubscriptionStatus: async () => {
    try {
      const data = await authApi.getLicenseStatus(); 
      if (data.days_until_expiry !== undefined && data.days_until_expiry !== null) {
        set({ 
          daysUntilExpiry: data.days_until_expiry,
          isSubscriptionExpired: data.days_until_expiry <= 0 || !data.is_active
        });

        // Save true server time & expiry for Offline Enforcement
        if (data.subscription_expires_at && data.server_time) {
          updateLicenseMeta(data.subscription_expires_at, data.server_time, Date.now());
        }
      }
    } catch (e) {
      // Ignore network errors for this status check
    }
  },

  // ── تسجيل الدخول ──────────────────────────────────────
  login: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const tokens = await authApi.login(username, password);

      if (!tokens.user?.store_id) {
        throw new Error('فشل تسجيل الدخول: لم يتم إرجاع معرف المتجر (Missing store_id)');
      }

      // Tenant Isolation Check
      const localStoreId = getStoreId();
      if (localStoreId && localStoreId !== tokens.user.store_id) {
        if (hasPendingUnsyncedData()) {
          throw new Error('يوجد بيانات غير متزامنة للمتجر السابق. الرجاء الدخول بالحساب السابق ومزامنتها أولاً.');
        } else {
          clearDatabase();
        }
      }
      setStoreId(tokens.user.store_id);

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
      const serverMessage = err?.message || 'فشل تسجيل الدخول';
      // Detect device mismatch (403 with specific message)
      const isDeviceMismatch = err?.response?.status === 403 &&
        (serverMessage.includes('جهاز آخر') || serverMessage.includes('device'));
      set({
        isLoading: false,
        error: serverMessage,
        deviceMismatch: isDeviceMismatch,
      });
      throw err;
    }
  },

  // ── نقل الجهاز (Device Transfer) ──────────────────────────
  transferDevice: async (username, password) => {
    set({ isLoading: true, error: null });
    try {
      const tokens = await authApi.transferDevicePublic(username, password);

      if (!tokens.user?.store_id) {
        throw new Error('فشل نقل الجهاز: لم يتم إرجاع معرف المتجر');
      }

      // Clear old data for new device - fresh start
      clearDatabase();
      setStoreId(tokens.user.store_id);

      await TokenStorage.setAccess(tokens.access_token);
      await TokenStorage.setRefresh(tokens.refresh_token);
      await TokenStorage.setUser(tokens.user);
      set({
        user: tokens.user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        deviceMismatch: false,
      });
    } catch (err: any) {
      const serverMessage = err?.message || 'فشل نقل الجهاز';
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
      
      if (!tokens.user?.store_id) {
        throw new Error('فشل إنشاء الحساب: لم يتم إرجاع معرف المتجر (Missing store_id)');
      }
      
      // Tenant Isolation Check
      const localStoreId = getStoreId();
      if (localStoreId && localStoreId !== tokens.user.store_id) {
        if (hasPendingUnsyncedData()) {
          throw new Error('يوجد بيانات غير متزامنة للمتجر السابق. الرجاء الدخول بالحساب السابق ومزامنتها أولاً.');
        } else {
          clearDatabase();
        }
      }
      setStoreId(tokens.user.store_id);

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

      if (!localUser.store_id) {
        await TokenStorage.clear();
        set({ isLoading: false, isAuthenticated: false, error: 'بيانات الجلسة غير صالحة (Missing store_id)' });
        return;
      }

      // Backward compatibility for existing logged-in users before store_id was tracked locally
      const localStoreId = getStoreId();
      if (!localStoreId) {
        setStoreId(localUser.store_id);
      } else if (localStoreId !== localUser.store_id) {
        if (hasPendingUnsyncedData()) {
          // Dangerous state: token says Store A, local DB says Store B and has unsynced data.
          // Force logout to force manual login and handle the data gracefully.
          await TokenStorage.clear();
          set({ isLoading: false, isAuthenticated: false });
          return;
        } else {
          clearDatabase();
          setStoreId(localUser.store_id);
        }
      }

      // 1. الدخول فوراً باستخدام البيانات المحلية (Offline-First)
      // يضمن أن التطبيق يفتح فوراً بدون إنترنت، ويتجاوز شاشة الدخول بنجاح.
      set({ user: localUser, isAuthenticated: true, isLoading: false });
      get().fetchSubscriptionStatus();

      // 2. تحديث بيانات المستخدم في الخلفية (إذا كان متصلاً)
      try {
        const user = await authApi.me();
        
        if (!user?.store_id) {
           await TokenStorage.clear();
           set({ user: null, isAuthenticated: false, error: 'الجلسة غير صالحة: الخادم لم يرسل store_id' });
           return;
        }
        
        // Final sanity check when online user is fetched
        const latestLocalStoreId = getStoreId();
        if (latestLocalStoreId && latestLocalStoreId !== user.store_id) {
           await TokenStorage.clear();
           set({ user: null, isAuthenticated: false });
           return;
        }

        await TokenStorage.setUser(user); // تحديث الكاش المحلي
        set({ user });
        get().fetchSubscriptionStatus();
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