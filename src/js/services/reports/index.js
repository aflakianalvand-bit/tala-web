// reports/index.js — فهرست گزارش‌ها و نقطه‌ی اجرای واحد (Phase 14)
//
// صفحه‌ی گزارش‌ها فقط با همین فایل کار می‌کند: فهرست را نشان می‌دهد، پارامتر لازم را
// می‌پرسد و `runReport` را صدا می‌زند. هر گزارش جدید = یک ردیف در REPORTS، بدون
// تغییر در UI. همه‌ی گزارش‌ها فقط‌خواندنی‌اند؛ هیچ مسیری از اینجا به نوشتن نمی‌رسد.

import { getAll } from '../../db/repo.js';
import { normalizeRange } from '../../utils/dateRange.js';
import { ACCOUNT_TYPE_LABELS, GOLD_ACCOUNT_TYPES, GOLD_ACCOUNT_TYPE_LABELS } from '../accounts.js';
import { salesReports, purchaseReports } from './invoiceReports.js';
import { inventoryTotalReport, inventoryByTypeReport, inventoryByKaratReport, inventoryFlowReport } from './inventoryReports.js';
import {
  receiptsReport,
  paymentsReport,
  receivablesReport,
  payablesReport,
  cashReport,
  customerStatementReport,
  supplierStatementReport,
} from './financialReports.js';

export { COL } from './model.js';

export const REPORT_GROUPS = [
  { key: 'sales', label: 'فروش', icon: '🧾' },
  { key: 'purchases', label: 'خرید', icon: '🛒' },
  { key: 'inventory', label: 'موجودی', icon: '⚖️' },
  { key: 'finance', label: 'مالی', icon: '💰' },
];

/**
 * param: نوع انتخاب اضافه‌ی گزارش — `customer` | `supplier` | `account` | `goldType` | null
 * paramRequired: بدون آن گزارش معنا ندارد (گردش طرف حساب).
 */
export const REPORTS = [
  { key: 'sales.byDay', group: 'sales', title: 'فروش روزانه', run: (r) => salesReports.byDay(r) },
  { key: 'sales.byMonth', group: 'sales', title: 'فروش ماهانه', run: (r) => salesReports.byMonth(r) },
  { key: 'sales.byParty', group: 'sales', title: 'فروش به تفکیک مشتری', run: (r) => salesReports.byParty(r) },
  { key: 'sales.byProduct', group: 'sales', title: 'فروش به تفکیک کالا', run: (r) => salesReports.byProduct(r) },
  { key: 'sales.byGoldType', group: 'sales', title: 'فروش به تفکیک نوع طلا', run: (r) => salesReports.byGoldType(r) },
  { key: 'sales.byWeight', group: 'sales', title: 'فروش به تفکیک وزن', run: (r) => salesReports.byWeight(r) },
  { key: 'sales.byAmount', group: 'sales', title: 'فروش به تفکیک مبلغ', run: (r) => salesReports.byAmount(r) },

  { key: 'purchases.byDay', group: 'purchases', title: 'خرید روزانه', run: (r) => purchaseReports.byDay(r) },
  { key: 'purchases.byMonth', group: 'purchases', title: 'خرید ماهانه', run: (r) => purchaseReports.byMonth(r) },
  { key: 'purchases.byParty', group: 'purchases', title: 'خرید به تفکیک تأمین‌کننده', run: (r) => purchaseReports.byParty(r) },
  { key: 'purchases.byProduct', group: 'purchases', title: 'خرید به تفکیک کالا', run: (r) => purchaseReports.byProduct(r) },
  { key: 'purchases.byWeight', group: 'purchases', title: 'خرید به تفکیک وزن', run: (r) => purchaseReports.byWeight(r) },
  { key: 'purchases.byAmount', group: 'purchases', title: 'خرید به تفکیک مبلغ', run: (r) => purchaseReports.byAmount(r) },

  { key: 'inventory.total', group: 'inventory', title: 'موجودی کل', run: (r) => inventoryTotalReport(r) },
  { key: 'inventory.byType', group: 'inventory', title: 'موجودی به تفکیک نوع طلا', run: (r) => inventoryByTypeReport(r) },
  { key: 'inventory.byKarat', group: 'inventory', title: 'موجودی به تفکیک عیار', run: (r) => inventoryByKaratReport(r) },
  { key: 'inventory.flow', group: 'inventory', title: 'گردش موجودی (ورود و خروج)', param: 'goldType', run: (r, p) => inventoryFlowReport(r, { goldType: p.goldType || 'all' }) },

  { key: 'finance.receipts', group: 'finance', title: 'دریافت‌ها', run: (r) => receiptsReport(r) },
  { key: 'finance.payments', group: 'finance', title: 'پرداخت‌ها', run: (r) => paymentsReport(r) },
  { key: 'finance.receivables', group: 'finance', title: 'مطالبات (طلب از مشتریان)', run: (r) => receivablesReport(r) },
  { key: 'finance.payables', group: 'finance', title: 'بدهی (به تأمین‌کنندگان)', run: (r) => payablesReport(r) },
  { key: 'finance.cash', group: 'finance', title: 'صندوق و حساب‌ها', param: 'account', run: (r, p) => cashReport(r, { accountId: p.accountId || null }) },
  { key: 'finance.customerStatement', group: 'finance', title: 'گردش حساب مشتری', param: 'customer', paramRequired: true, run: (r, p) => customerStatementReport(r, { partyId: p.partyId || null }) },
  { key: 'finance.supplierStatement', group: 'finance', title: 'گردش حساب تأمین‌کننده', param: 'supplier', paramRequired: true, run: (r, p) => supplierStatementReport(r, { partyId: p.partyId || null }) },
];

const BY_KEY = new Map(REPORTS.map((r) => [r.key, r]));

export function getReportDef(key) {
  return BY_KEY.get(key) || null;
}

export function reportsInGroup(group) {
  return REPORTS.filter((r) => r.group === group);
}

/**
 * گزینه‌های انتخاب پارامتر. طرف حساب/حساب حذف‌شده هم فهرست می‌شود (با برچسب)، چون
 * گزارش دوره‌ی گذشته ممکن است دقیقاً درباره‌ی همان باشد.
 */
export async function paramOptions(param) {
  const label = (x) => `${x.name}${x.code ? ` (${x.code})` : ''}${x.deletedAt ? ' — حذف‌شده' : x.active === false ? ' — غیرفعال' : ''}`;
  const sortFa = (a, b) => Number(Boolean(a.deletedAt)) - Number(Boolean(b.deletedAt)) || String(a.name).localeCompare(String(b.name), 'fa');
  switch (param) {
    case 'customer':
    case 'supplier': {
      const list = (await getAll(param === 'customer' ? 'customers' : 'suppliers')).sort(sortFa);
      return [{ value: '', label: param === 'customer' ? '— انتخاب مشتری —' : '— انتخاب تأمین‌کننده —' }, ...list.map((x) => ({ value: x.id, label: label(x) }))];
    }
    case 'account': {
      const list = (await getAll('accounts')).sort(sortFa);
      return [
        { value: '', label: 'همه‌ی حساب‌ها' },
        ...list.map((a) => ({ value: a.id, label: `${label(a)}${ACCOUNT_TYPE_LABELS[a.type] ? ` — ${ACCOUNT_TYPE_LABELS[a.type]}` : ''}` })),
      ];
    }
    case 'goldType':
      return [{ value: 'all', label: 'همه‌ی انواع' }, ...GOLD_ACCOUNT_TYPES.map((t) => ({ value: t, label: GOLD_ACCOUNT_TYPE_LABELS[t] }))];
    default:
      return [];
  }
}

/** نام پارامتر در ورودی run برای هر نوع انتخاب. */
export const PARAM_FIELD = { customer: 'partyId', supplier: 'partyId', account: 'accountId', goldType: 'goldType' };

/**
 * اجرای یک گزارش. بازه اعتبارسنجی می‌شود (DateRangeError برای بازه‌ی نامعتبر/وارونه).
 * @param {string} key
 * @param {{from?:string|null, to?:string|null, partyId?:string, accountId?:string, goldType?:string}} params
 */
export async function runReport(key, params = {}) {
  const def = getReportDef(key);
  if (!def) throw new Error(`گزارش ناشناخته: ${key}`);
  const range = normalizeRange({ from: params.from ?? null, to: params.to ?? null });
  const report = await def.run(range, params);
  return { ...report, range, group: def.group };
}
