import { api } from './client';
import { saveAndShareFile } from '../utils/fileDownload';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MIME = 'application/pdf';

const todayStamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

export const reportsApi = {
  /** full | sales | inventory | debts — يتطلب صلاحية manager فما فوق بالباكيند */
  exportExcel: async (
    reportType: 'full' | 'sales' | 'inventory' | 'debts' = 'full',
    dateFrom?: string,
    dateTo?: string,
  ): Promise<void> => {
    const { data } = await api.get('/reports/excel', {
      params: { report_type: reportType, date_from: dateFrom, date_to: dateTo },
      responseType: 'arraybuffer',
    });
    await saveAndShareFile(data, `maksab_${reportType}_${todayStamp()}.xlsx`, XLSX_MIME);
  },

  /** متاح لكل المستخدمين المسجّلين (مش بس المدير) */
  exportSalesExcel: async (dateFrom?: string, dateTo?: string): Promise<void> => {
    const { data } = await api.get('/reports/excel/sales', {
      params: { date_from: dateFrom, date_to: dateTo },
      responseType: 'arraybuffer',
    });
    await saveAndShareFile(data, `sales_${todayStamp()}.xlsx`, XLSX_MIME);
  },

  exportInventoryExcel: async (): Promise<void> => {
    const { data } = await api.get('/reports/excel/inventory', { responseType: 'arraybuffer' });
    await saveAndShareFile(data, `inventory_${todayStamp()}.xlsx`, XLSX_MIME);
  },

  exportDebtsExcel: async (): Promise<void> => {
    const { data } = await api.get('/reports/excel/debts', { responseType: 'arraybuffer' });
    await saveAndShareFile(data, `debts_${todayStamp()}.xlsx`, XLSX_MIME);
  },

  exportInvoicePdf: async (invoiceId: number, shopName = 'Maksab'): Promise<void> => {
    const { data } = await api.get(`/reports/pdf/invoice/${invoiceId}`, {
      params: { shop_name: shopName },
      responseType: 'arraybuffer',
    });
    await saveAndShareFile(data, `invoice_${invoiceId}.pdf`, PDF_MIME);
  },

  /** يتطلب صلاحية manager فما فوق بالباكيند */
  exportSalesPdf: async (dateFrom?: string, dateTo?: string, shopName = 'Maksab'): Promise<void> => {
    const { data } = await api.get('/reports/pdf/sales', {
      params: { date_from: dateFrom, date_to: dateTo, shop_name: shopName },
      responseType: 'arraybuffer',
    });
    await saveAndShareFile(data, `sales_report_${todayStamp()}.pdf`, PDF_MIME);
  },
};