import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getAllCustomers, getAllSuppliers, getDashboardStats } from '../db/database';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

function fmt(n: number) {
  return n?.toFixed(2) ?? '0.00';
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function generateAndShareReport(storeName?: string): Promise<void> {
  const now = new Date();
  const dateLabel = format(now, 'PPP', { locale: ar });
  const timeLabel = format(now, 'HH:mm', { locale: ar });

  const customers = getAllCustomers(false);   // false = exclude deleted
  const suppliers = getAllSuppliers();
  const stats = getDashboardStats().summary;

  const customersWithDebt = customers.filter(c => c.current_debt > 0);
  const totalCustomerDebt = customers.reduce((s, c) => s + c.current_debt, 0);
  const totalSupplierBalance = suppliers.reduce((s, s2) => s + s2.current_balance, 0);

  const customerRows = customersWithDebt.slice(0, 200).map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${c.phone || '-'}</td>
      <td class="amount debt">${fmt(c.current_debt)} ₪</td>
    </tr>
  `).join('');

  const supplierRows = suppliers.filter(s => s.current_balance > 0).slice(0, 200).map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.phone || '-'}</td>
      <td class="amount debt">${fmt(s.current_balance)} ₪</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>تقرير مَكْسَب</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #F8FAFC;
      color: #1E293B;
      direction: rtl;
    }
    .header {
      background: linear-gradient(135deg, #1E3A5F, #2D5187);
      color: white;
      padding: 32px;
      text-align: center;
    }
    .header h1 { font-size: 28px; font-weight: 900; margin-bottom: 4px; }
    .header p  { font-size: 14px; opacity: 0.8; }
    .store-name { font-size: 16px; font-weight: 700; margin-top: 8px; opacity: 0.9; }
    .meta { font-size: 13px; opacity: 0.7; margin-top: 4px; }

    .body { max-width: 960px; margin: 0 auto; padding: 32px 24px; }

    /* Summary Cards */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      border: 1px solid #E2E8F0;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .card-label { font-size: 12px; color: #64748B; font-weight: 600; margin-bottom: 8px; }
    .card-value { font-size: 24px; font-weight: 900; }
    .card-value.green { color: #10B981; }
    .card-value.red   { color: #EF4444; }
    .card-value.blue  { color: #1E3A5F; }
    .card-sub { font-size: 12px; color: #94A3B8; margin-top: 4px; }

    /* Sections */
    .section { margin-bottom: 32px; }
    .section-title {
      font-size: 18px;
      font-weight: 900;
      color: #1E3A5F;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #1E3A5F;
    }
    .section-sub { font-size: 13px; color: #64748B; margin-bottom: 12px; }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      background: #1E3A5F;
      color: white;
      padding: 10px 14px;
      text-align: right;
      font-weight: 700;
    }
    td {
      padding: 10px 14px;
      border-bottom: 1px solid #E2E8F0;
      text-align: right;
    }
    tr:nth-child(even) td { background: #F8FAFC; }
    tr:hover td { background: #EFF6FF; }

    .amount { font-family: monospace; font-weight: 700; }
    .amount.debt { color: #EF4444; }
    .amount.credit { color: #10B981; }

    .total-row td { font-weight: 900; background: #F1F5F9 !important; font-size: 14px; }

    /* Empty state */
    .empty { text-align: center; padding: 32px; color: #94A3B8; }

    /* Footer */
    footer {
      text-align: center;
      color: #94A3B8;
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #E2E8F0;
    }

    @media print {
      body { background: white; }
      .header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .card { break-inside: avoid; }
      .section { break-inside: avoid; }
    }
  </style>
</head>
<body>

<div class="header">
  <h1>💰 مَكْسَب</h1>
  ${storeName ? `<div class="store-name">${escapeHtml(storeName)}</div>` : ''}
  <p>تقرير شامل للديون والموردين</p>
  <div class="meta">📅 ${dateLabel} &nbsp;|&nbsp; 🕐 ${timeLabel}</div>
</div>

<div class="body">

  <!-- Summary Cards -->
  <div class="cards">
    <div class="card">
      <div class="card-label">مبيعات اليوم</div>
      <div class="card-value blue">${fmt(stats?.today?.revenue ?? 0)} ₪</div>
      <div class="card-sub">${stats?.today?.count ?? 0} فاتورة</div>
    </div>
    <div class="card">
      <div class="card-label">ربح اليوم</div>
      <div class="card-value green">${fmt(stats?.today?.profit ?? 0)} ₪</div>
      <div class="card-sub">هامش ${(stats?.today?.margin ?? 0).toFixed(0)}%</div>
    </div>
    <div class="card">
      <div class="card-label">إجمالي ديون العملاء</div>
      <div class="card-value red">${fmt(totalCustomerDebt)} ₪</div>
      <div class="card-sub">${customersWithDebt.length} عميل عليه دين</div>
    </div>
    <div class="card">
      <div class="card-label">إجمالي ديون الموردين</div>
      <div class="card-value red">${fmt(totalSupplierBalance)} ₪</div>
      <div class="card-sub">${suppliers.filter(s => s.current_balance > 0).length} مورد مستحق</div>
    </div>
    <div class="card">
      <div class="card-label">صافي المستحقات</div>
      <div class="card-value ${totalCustomerDebt - totalSupplierBalance >= 0 ? 'green' : 'red'}">${fmt(totalCustomerDebt - totalSupplierBalance)} ₪</div>
      <div class="card-sub">للصالح - عليك</div>
    </div>
  </div>

  <!-- Customer Debts -->
  <div class="section">
    <div class="section-title">👥 ديون العملاء</div>
    ${customersWithDebt.length === 0
      ? '<div class="empty">✅ لا يوجد عملاء عليهم ديون</div>'
      : `
    <table>
      <thead>
        <tr>
          <th>اسم العميل</th>
          <th>الهاتف</th>
          <th>المبلغ المستحق</th>
        </tr>
      </thead>
      <tbody>
        ${customerRows}
        <tr class="total-row">
          <td colspan="2">الإجمالي</td>
          <td class="amount debt">${fmt(totalCustomerDebt)} ₪</td>
        </tr>
      </tbody>
    </table>
    `}
  </div>

  <!-- Supplier Debts -->
  <div class="section">
    <div class="section-title">🚚 مستحقات الموردين</div>
    ${suppliers.filter(s => s.current_balance > 0).length === 0
      ? '<div class="empty">✅ لا يوجد مستحقات للموردين</div>'
      : `
    <table>
      <thead>
        <tr>
          <th>اسم المورد</th>
          <th>الهاتف</th>
          <th>المبلغ المستحق</th>
        </tr>
      </thead>
      <tbody>
        ${supplierRows}
        <tr class="total-row">
          <td colspan="2">الإجمالي</td>
          <td class="amount debt">${fmt(totalSupplierBalance)} ₪</td>
        </tr>
      </tbody>
    </table>
    `}
  </div>

  <footer>
    تم إنشاء هذا التقرير بواسطة مَكْسَب &nbsp;•&nbsp; ${dateLabel}
    <br/>يمكنك طباعته من المتصفح أو حفظه كـ PDF
  </footer>

</div>
</body>
</html>`;

  // حفظ الملف
  const filename = `Maksab_Report_${format(now, 'yyyyMMdd_HHmm')}.html`;
  const filePath = `${FileSystem.documentDirectory}${filename}`;

  await FileSystem.writeAsStringAsync(filePath, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // مشاركة الملف
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(filePath, {
      mimeType: 'text/html',
      dialogTitle: 'تصدير تقرير مَكْسَب',
      UTI: 'public.html',
    });
  }
}
