import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

export const BASE_URL = 'https://maksab-api.onrender.com/api/v1';
export const ROOT_URL = BASE_URL.replace(/\/api\/v1\/?$/, '');

/**
 * فحص "أونلاين" الحقيقي: هل التطبيق قادر يوصل للباكيند فعلياً.
 * Timeout قصير (2.5 ثانية) عشان ما يوقف الـ UI.
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
  ACCESS:  'maksab_access_token',
  REFRESH: 'maksab_refresh_token',
  USER:    'maksab_user_data',
};

// ── دوال التخزين الآمن ────────────────────────────────────
export const TokenStorage = {
  getAccess:     () => SecureStore.getItemAsync(KEYS.ACCESS),
  getRefresh:    () => SecureStore.getItemAsync(KEYS.REFRESH),
  getUser:       async () => {
    const data = await SecureStore.getItemAsync(KEYS.USER);
    return data ? JSON.parse(data) : null;
  },
  setAccess:     (t: string) => SecureStore.setItemAsync(KEYS.ACCESS, t),
  setRefresh:    (t: string) => SecureStore.setItemAsync(KEYS.REFRESH, t),
  setUser:       (u: any) => SecureStore.setItemAsync(KEYS.USER, JSON.stringify(u)),
  clear:         async () => {
    await SecureStore.deleteItemAsync(KEYS.ACCESS);
    await SecureStore.deleteItemAsync(KEYS.REFRESH);
    await SecureStore.deleteItemAsync(KEYS.USER);
  },
};

// ── Axios instance ─────────────────────────────────────────
// timeout = 35s: Render cold start قد يأخذ 15-30 ثانية على الخطة المجانية.
// الـ 15 ثانية الافتراضية السابقة كانت تقطع الاتصال قبل ما السيرفر يصحى.
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 35000,
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
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // 402 → انتهاء الاشتراك
    if (error.response?.status === 402) {
      const { useAuthStore } = require('../store/authStore');
      useAuthStore.getState().setSubscriptionExpired(true);
    }

    // ── استخرج رسالة الخطأ العربية ──────────────────────
    // تمييز خاص لـ Render Cold Start (500/502/503/504/ECONNABORTED):
    // بدل ما يطلع "خطأ في الخادم" المحيّر، يطلع رسالة واضحة للتاجر.
    const status = error.response?.status;
    const isNetworkTimeout = !error.response && (
      error.code === 'ECONNABORTED' ||
      error.code === 'ERR_NETWORK' ||
      error.message?.includes('timeout')
    );

    if (isNetworkTimeout || status === 502 || status === 503 || status === 504) {
      return Promise.reject(
        new Error('⏳ جاري تشغيل الخادم، انتظر لحظة ثم أعد المحاولة...')
      );
    }

    if (status === 500) {
      return Promise.reject(
        new Error('⚠️ حدث خطأ بالخادم — حاول مجدداً، أو تواصل مع الدعم إذا تكرر')
      );
    }

    const rawDetail = (error.response?.data as { detail?: unknown })?.detail;
    const detail = typeof rawDetail === 'string' ? rawDetail : undefined;
    const message = detail || getErrorMessage(status);

    return Promise.reject(new Error(message));
  },
);

function getErrorMessage(status?: number): string {
  switch (status) {
    case 400: return 'بيانات غير صحيحة';
    case 401: return 'يرجى تسجيل الدخول مجدداً';
    case 402: return 'انتهى الاشتراك، الرجاء تجديده للاستمرار في حفظ البيانات';
    case 403: return 'غير مصرح لك بهذه العملية';
    case 404: return 'العنصر غير موجود';
    case 422: return 'بيانات غير مكتملة أو غير صحيحة';
    case 429: return 'طلبات كثيرة جداً، انتظر قليلاً ثم أعد المحاولة';
    default:  return 'حدث خطأ غير متوقع';
  }
}