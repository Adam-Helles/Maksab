import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

export const BASE_URL = 'http://10.5.0.3:8000/api/v1';
export const ROOT_URL = BASE_URL.replace(/\/api\/v1\/?$/, '');

/**
 * فحص "أونلاين" الحقيقي المناسب لهاد المشروع: هل التطبيق قادر يوصل
 * للباكيند نفسه فعلياً، مش هل الجهاز عنده "إنترنت عام" (expo-network
 * بيفحص وصول عام للإنترنت، وهاد غير دقيق هون لأنه الجوال نفسه غالباً
 * مصدر الهوتسبوت — وضع الطيران عليه بيقفل الشبكة كلها مش بس النت).
 * Timeout قصير (2.5 ثانية) عشان ما توقف واجهة المستخدم لو الباكيند
 * مش قادر يوصله.
 */
export async function isBackendReachable(timeoutMs = 2500): Promise<boolean> {
  try {
    await axios.get(`${ROOT_URL}/health`, { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

const KEYS = {
  ACCESS:  'cashtop_access_token',
  REFRESH: 'cashtop_refresh_token',
};

// ── دوال التخزين الآمن ────────────────────────────────────
export const TokenStorage = {
  getAccess:     () => SecureStore.getItemAsync(KEYS.ACCESS),
  getRefresh:    () => SecureStore.getItemAsync(KEYS.REFRESH),
  setAccess:     (t: string) => SecureStore.setItemAsync(KEYS.ACCESS, t),
  setRefresh:    (t: string) => SecureStore.setItemAsync(KEYS.REFRESH, t),
  clear:         async () => {
    await SecureStore.deleteItemAsync(KEYS.ACCESS);
    await SecureStore.deleteItemAsync(KEYS.REFRESH);
  },
};

// ── Axios instance ─────────────────────────────────────────
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor — يضيف الـ token تلقائياً ────────
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await TokenStorage.getAccess();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response interceptor — يجدّد الـ token تلقائياً ───────
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 401 → حاول تجديد الـ token
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // طلبات متعددة تنتظر التجديد
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await TokenStorage.getRefresh();
        if (!refreshToken) throw new Error('No refresh token');

        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });

        // ⚠️ Refresh Token Rotation: السيرفر بيلغي الـ refresh token
        // القديم فوراً وبيرجّع وحدة جديدة مكانه. لازم نخزّن الاثنين
        // (access + refresh) وإلا المرة الجاية رح نحاول نستخدم توكن
        // ملغى، والسيرفر رح يعتبرها محاولة سرقة ويقفل الجلسة بالكامل.
        const newAccessToken = data.access_token;
        const newRefreshToken = data.refresh_token;
        await TokenStorage.setAccess(newAccessToken);
        await TokenStorage.setRefresh(newRefreshToken);
        api.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`;
        processQueue(null, newAccessToken);

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        await TokenStorage.clear();
        // الـ store يستمع لهذا الحدث ويعمل logout
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // استخرج رسالة الخطأ العربية من الـ backend
    // ⚠️ إصلاح: FastAPI بيرجّع detail كـ array من objects بحالات كتير
    // (خصوصاً 422 validation errors — راجع مثال limit > 200)، مش نص
    // عادي دايماً. لازم نتأكد إنه string قبل ما نستخدمه كـ Error message،
    // وإلا new Error(object) بيطلع "[object Object]" وبيضيع سبب
    // الخطأ الحقيقي (هيك بالضبط صار وقاد لباگ بحث المنتجات أوفلاين).
    const rawDetail = (error.response?.data as { detail?: unknown })?.detail;
    const detail = typeof rawDetail === 'string' ? rawDetail : undefined;
    const message = detail || getErrorMessage(error.response?.status);

    if (error.response?.status === 402) {
      // Import dynamically to avoid circular dependency issues at boot
      const { useAuthStore } = require('../store/authStore');
      useAuthStore.getState().setSubscriptionExpired(true);
    }

    return Promise.reject(new Error(message));
  },
);

function getErrorMessage(status?: number): string {
  switch (status) {
    case 400: return 'بيانات غير صحيحة';
    case 401: return 'يرجى تسجيل الدخول مجدداً';
    case 402: return 'انتهى الاشتراك، المرجو التجديد للاستمرار في حفظ البيانات';
    case 403: return 'غير مصرح لك بهذه العملية';
    case 404: return 'العنصر غير موجود';
    case 422: return 'بيانات غير مكتملة';
    case 500: return 'خطأ في الخادم، حاول مجدداً';
    default:  return 'حدث خطأ غير متوقع';
  }
}