import { api } from './client';
import type { AuthTokens, User } from '../types';

export const authApi = {
  login: async (username: string, password: string): Promise<AuthTokens> => {
    const { data } = await api.post<AuthTokens>('/auth/login', { username, password });
    return data;
  },

  signup: async (payload: {
    store_name: string;
    owner_name?: string;
    store_phone?: string;
    username: string;
    full_name: string;
    email?: string;
    phone?: string;
    password: string;
    license_key: string;        // ⚠️ إلزامي: بدون هذا لا يُقبل التسجيل
  }): Promise<AuthTokens> => {
    const { data } = await api.post<AuthTokens>('/stores/signup', payload);
    return data;
  },

  refresh: async (refreshToken: string): Promise<{ access_token: string }> => {
    const { data } = await api.post('/auth/refresh', { refresh_token: refreshToken });
    return data;
  },

  me: async (): Promise<User> => {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data } = await api.post('/auth/me/change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return data;
  },
};