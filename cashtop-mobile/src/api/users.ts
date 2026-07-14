import { api } from './client';
import type { User, UserRole } from '../types';

export const usersApi = {
  list: async (): Promise<User[]> => {
    const { data } = await api.get<User[]>('/users/');
    return data;
  },

  create: async (payload: {
    username: string;
    full_name: string;
    password: string;
    role: UserRole;
    email?: string;
    phone?: string;
  }): Promise<User> => {
    const { data } = await api.post<User>('/users/', payload);
    return data;
  },

  update: async (id: number, payload: Partial<{
    full_name: string;
    email: string;
    phone: string;
    role: UserRole;
    is_active: boolean;
    password: string;
  }>): Promise<User> => {
    const { data } = await api.patch<User>(`/users/${id}`, payload);
    return data;
  },
};