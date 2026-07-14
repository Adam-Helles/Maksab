import { api } from './client';

export interface StoreSettings {
  id: number;
  store_name: string;
  logo_url?: string | null;
  currency: string;
  phone?: string | null;
  address?: string | null;
  tax_number?: string | null;
  invoice_footer_note?: string | null;
}

export const settingsApi = {
  get: async (): Promise<StoreSettings> => {
    const { data } = await api.get<StoreSettings>('/settings/');
    return data;
  },

  update: async (payload: Partial<Omit<StoreSettings, 'id'>>): Promise<StoreSettings> => {
    const { data } = await api.patch<StoreSettings>('/settings/', payload);
    return data;
  },
};