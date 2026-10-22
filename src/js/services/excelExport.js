// excelExport.js — خروجی Excel برای Entityهای اصلی و برای گزارش‌های Phase 14
//
// ═══════════════════════════════════════════════════════════════════════════
// دو ورودی، یک خروجی:
//
//   Entityها  → این فایل ستون‌های خوانا می‌سازد و **شناسه‌ها را به نام تبدیل
//                می‌کند** (کاربر با «c3f1-…» کاری ندارد).
//   گزارش‌ها  → هیچ محاسبه‌ای تکرار نمی‌شود: `{columns, rows, totals}` همان
//                ساختاری است که Phase 14 برمی‌گرداند و `kind` هر ستون مستقیماً
//                نوع سلول Excel را تعیین می‌کند (قرارداد model.js).
//
// اگر روزی عدد گزارش تغییر کند، خروجی Excel خودبه‌خود همان عدد را می‌دهد —
// چون از همان موتور می‌آید، نه از یک مسیر موازی.
// ═══════════════════════════════════════════════════════════════════════════

import { finenessOf } from './units.js';
import { openDatabase } from '../db/db.js';
import { getAll } from '../db/repo.js';
import { buildWorkbook } from '../utils/xlsx.js';
import { formatJalaliDateLong } from '../utils/date.js';
import { ACCOUNT_TYPE_LABELS, GOLD_ACCOUNT_TYPE_LABELS } from './accounts.js';
import { CASH_CATEGORY_LABELS } from './cashFlow.js';

/** واژگان نمایش مخصوص خروجی Excel (لایه‌ی services به pages وابسته نمی‌شود). */
const STATUS_LABELS = {
  confirmed: 'ثبت‌شده',
  voided: 'باطل‌شده',
  open: 'باز',
  settled: 'تسویه‌شده',
  active: 'فعال',
  pending: 'در انتظار',
  partial: 'تسویه جزئی',
  paid: 'تسویه‌شده',
};

const METHOD_LABELS = { cash: 'نقد / حساب', gold: 'طلا', discount: 'تخفیف تسویه' };
const MODE_LABELS = { cash: 'نقدی', credit: 'رسیدی', mixed: 'ترکیبی' };
const DIRECTION_LABELS = { IN: 'ورود', OUT: 'خروج' };
const PARTY_LABELS = { customer: 'مشتری', supplier: 'تأمین‌کننده', other: 'سایر' };
const DOC_TYPE_LABELS = {
  sale: 'فاکتور فروش',
  purchase: 'سند خرید',
  receipt: 'دریافت',
  payment: 'پرداخت',
  sale_return: 'برگشت از فروش',
};

const label = (map, key, fallback = '') => map[key] || (key ? String(key) : fallback);

// ─────────────────────────── زمینه‌ی تبدیل شناسه به نام ───────────────────────────

/**
 * همه‌ی Storeهای لازم را **یک بار** می‌خواند و توابع تبدیل شناسه→نام می‌سازد.
 * بدون این، هر ردیف یک کوئری جدا می‌زد و خروجی یک انبار بزرگ کند می‌شد.
 */
async function buildContext() {
  await openDatabase();
  const [products, customers, suppliers, accounts] = await Promise.all([
    getAll('products'),
    getAll('customers'),
    getAll('suppliers'),
    getAll('accounts'),
  ]);
  const map = (rows) => new Map(rows.map((r) => [r.id, r]));
  const products_ = map(products);
  const customers_ = map(customers);
  const suppliers_ = map(suppliers);
  const accounts_ = map(accounts);

  const productName = (id) => {
    const p = products_.get(id);
    return p ? `${p.name}${p.code ? ` (${p.code})` : ''}` : id ? '—' : '';
  };
  const partyName = (type, id, snapshot = '') => {
    const store = type === 'customer' ? customers_ : type === 'supplier' ? suppliers_ : null;
    const found = store?.get(id);
    if (found) return `${found.name}${found.code ? ` (${found.code})` : ''}`;
    return snapshot || (id ? '—' : '');
  };
  const accountName = (id) => accounts_.get(id)?.name || (id ? '—' : '');

  /** ارجاع دفتر → نام خوانا. سطل انبار شناسه‌ی ترکیبی دارد (ledger.js §inventoryRefId). */
  const refName = (ref) => {
    if (!ref || !ref.kind) return '';
    switch (ref.kind) {
      case 'account':
        return accountName(ref.id);
      case 'customer':
      case 'supplier':
        return partyName(ref.kind, ref.id);
      case 'inventory': {
        const id = String(ref.id || '');
        if (id.startsWith('product:')) return `انبار — ${productName(id.slice(8))}`;
        const [goldType, karat] = id.split(':');
        return `انبار — ${label(GOLD_ACCOUNT_TYPE_LABELS, goldType)} عیار ${karat}`;
      }
      case 'other':
        return label(CASH_CATEGORY_LABELS, ref.id, 'سایر');
      default:
        return `${ref.kind}:${ref.id}`;
    }
  };

  return { products: products_, customers: customers_, suppliers: suppliers_, accounts: accounts_, productName, partyName, accountName, refName };
}

// ─────────────────────────── تعریف Sheet هر Entity ───────────────────────────

const c = (key, header, kind = 'text') => ({ key, header, kind });
const yesNo = (v) => (v ? 'بله' : 'خیر');
// Phase 22: ستون «عیار» همیشه هزاری؛ سند پیش از v10 (عیار ۲۴تایی) فقط در خروجی ترجمه می‌شود.
const kf = (doc, karat) => (karat === null || karat === undefined || karat === '' ? karat : finenessOf(doc, karat));

const activeText = (r) => (r.deletedAt ? 'حذف‌شده' : r.active === false ? 'غیرفعال' : 'فعال');

/** شمارش اقلام یک سند به‌صورت ردیف‌های مستقل — «اقلام» برای تحلیل در Excel لازم است. */
function lineRows(docs, ctx, { partyType, partyKey, extra = () => ({}) }) {
  const rows = [];
  for (const doc of docs) {
    for (const line of doc.lines || []) {
      rows.push({
        number: doc.number,
        date: doc.date,
        party: ctx.partyName(partyType, doc[partyKey], doc.supplierNameSnapshot || doc.customerNameSnapshot),
        status: label(STATUS_LABELS, doc.status),
        product: line.productId ? ctx.productName(line.productId) : '—',
        goldType: label(GOLD_ACCOUNT_TYPE_LABELS, line.goldType),
        karat: kf(doc, line.karat),
        weightGrams: line.weightGrams,
        ratePerGram: line.ratePerGram,
        goldPriceIRR: line.goldPriceIRR,
        wageIRR: line.wageIRR,
        lineTotalIRR: line.lineTotalIRR,
        ...extra(line, doc),
      });
    }
  }
  return rows;
}

export const ENTITY_SHEETS = [
  {
    key: 'products',
    name: 'کالاها',
    store: 'products',
    build: (rows) => ({
      columns: [
        c('code', 'کد'), c('name', 'نام'), c('type', 'نوع طلا'), c('karat', 'عیار', 'karat'),
        c('weightGrams', 'وزن (گرم)', 'grams'), c('wageType', 'نوع اجرت'), c('wageValue', 'مقدار اجرت', 'count'),
        c('profitPercent', 'سود (٪)', 'percent'), c('taxPercent', 'مالیات (٪)', 'percent'),
        c('status', 'وضعیت'), c('description', 'توضیحات'), c('createdAt', 'تاریخ ثبت', 'date'),
      ],
      rows: rows.map((r) => ({
        code: r.code, name: r.name,
        type: label(GOLD_ACCOUNT_TYPE_LABELS, r.type === 'manufactured' ? 'manufactured' : r.type),
        karat: r.karat, weightGrams: r.weightGrams,
        wageType: r.wageType === 'percent' ? 'درصدی' : r.wageType === 'perGram' ? 'مبلغ هر گرم' : '—',
        wageValue: r.wageValue, profitPercent: r.profitPercent, taxPercent: r.taxPercent,
        status: activeText(r), description: r.description, createdAt: r.createdAt,
      })),
    }),
  },
  {
    key: 'customers',
    name: 'مشتریان',
    store: 'customers',
    build: (rows) => ({
      columns: [c('code', 'کد'), c('name', 'نام'), c('phone', 'موبایل'), c('status', 'وضعیت'), c('notes', 'توضیحات'), c('createdAt', 'تاریخ ثبت', 'date')],
      rows: rows.map((r) => ({ code: r.code, name: r.name, phone: r.phone, status: activeText(r), notes: r.notes, createdAt: r.createdAt })),
    }),
  },
  {
    key: 'suppliers',
    name: 'تأمین‌کنندگان',
    store: 'suppliers',
    build: (rows) => ({
      columns: [c('code', 'کد'), c('name', 'نام'), c('phone', 'موبایل'), c('status', 'وضعیت'), c('notes', 'توضیحات'), c('createdAt', 'تاریخ ثبت', 'date')],
      rows: rows.map((r) => ({ code: r.code, name: r.name, phone: r.phone, status: activeText(r), notes: r.notes, createdAt: r.createdAt })),
    }),
  },
  {
    key: 'accounts',
    name: 'حساب‌ها',
    store: 'accounts',
    build: (rows) => ({
      columns: [c('name', 'نام حساب'), c('type', 'نوع'), c('status', 'وضعیت'), c('notes', 'توضیحات'), c('createdAt', 'تاریخ ثبت', 'date')],
      rows: rows.map((r) => ({ name: r.name, type: label(ACCOUNT_TYPE_LABELS, r.type), status: activeText(r), notes: r.notes, createdAt: r.createdAt })),
    }),
  },
];

ENTITY_SHEETS.push(
  {
    key: 'purchases',
    name: 'خریدها',
    store: 'purchases',
    build: (rows, ctx) => ({
      columns: [
        c('number', 'شماره'), c('date', 'تاریخ', 'date'), c('supplier', 'تأمین‌کننده'), c('mode', 'نوع تسویه'),
        c('totalWeightGrams', 'وزن کل (گرم)', 'grams'), c('totalGoldPriceIRR', 'بهای طلا', 'irr'),
        c('totalWageIRR', 'اجرت', 'irr'), c('grandTotalIRR', 'مبلغ کل', 'irr'),
        c('paidCashIRR', 'پرداخت نقدی', 'irr'), c('paidGoldGrams', 'طلای پرداختی (گرم)', 'grams'),
        c('paidGoldValueIRR', 'ارزش طلای پرداختی', 'irr'), c('remainingIRR', 'مانده هنگام ثبت', 'irr'),
        c('dueDate', 'سررسید', 'date'), c('status', 'وضعیت'), c('description', 'توضیحات'),
      ],
      rows: rows.map((r) => ({
        number: r.number, date: r.date,
        supplier: ctx.partyName('supplier', r.supplierId, r.supplierNameSnapshot),
        mode: label(MODE_LABELS, r.paymentMode),
        totalWeightGrams: r.totalWeightGrams, totalGoldPriceIRR: r.totalGoldPriceIRR,
        totalWageIRR: r.totalWageIRR, grandTotalIRR: r.grandTotalIRR,
        paidCashIRR: r.paidCashIRR, paidGoldGrams: r.paidGoldGrams, paidGoldValueIRR: r.paidGoldValueIRR,
        remainingIRR: r.remainingIRR, dueDate: r.dueDate,
        status: r.voidedAt ? 'باطل‌شده' : label(STATUS_LABELS, r.status),
        description: r.description,
      })),
    }),
  },
  {
    key: 'purchaseLines',
    name: 'اقلام خرید',
    store: 'purchases',
    build: (rows, ctx) => ({
      columns: [
        c('number', 'شماره سند'), c('date', 'تاریخ', 'date'), c('party', 'تأمین‌کننده'), c('product', 'کالا'),
        c('goldType', 'نوع طلا'), c('karat', 'عیار', 'karat'), c('weightGrams', 'وزن (گرم)', 'grams'),
        c('labName', 'آزمایشگاه'),
        c('ratePerGram', 'نرخ هر گرم', 'rate'), c('goldPriceIRR', 'بهای طلا', 'irr'),
        c('wageIRR', 'اجرت', 'irr'), c('lineTotalIRR', 'مبلغ قلم', 'irr'), c('status', 'وضعیت سند'),
      ],
      // Phase 23: نام آزمایشگاه (Snapshot روی قلم آبشده/متفرقه).
      rows: lineRows(rows, ctx, {
        partyType: 'supplier',
        partyKey: 'supplierId',
        extra: (line) => ({ labName: line.labName || '' }),
      }),
    }),
  },
  {
    key: 'sales',
    name: 'فروش‌ها',
    store: 'sales',
    build: (rows, ctx) => ({
      columns: [
        c('number', 'شماره'), c('date', 'تاریخ', 'date'), c('customer', 'مشتری'), c('mode', 'نوع تسویه'),
        c('totalWeightGrams', 'وزن کل (گرم)', 'grams'), c('totalGoldPriceIRR', 'بهای طلا', 'irr'),
        c('totalWageIRR', 'اجرت', 'irr'), c('totalProfitIRR', 'سود', 'irr'), c('totalTaxIRR', 'مالیات', 'irr'),
        c('discountIRR', 'تخفیف', 'irr'), c('grandTotalIRR', 'مبلغ نهایی', 'irr'),
        c('receivedCashIRR', 'دریافت نقدی', 'irr'), c('receivedGoldGrams', 'طلای دریافتی (گرم)', 'grams'),
        c('remainingIRR', 'مانده هنگام ثبت', 'irr'), c('returnedAmountIRR', 'برگشت از فروش', 'irr'),
        c('dueDate', 'سررسید', 'date'), c('status', 'وضعیت'), c('description', 'توضیحات'),
      ],
      rows: rows.map((r) => ({
        number: r.number, date: r.date,
        customer: ctx.partyName('customer', r.customerId, r.customerNameSnapshot),
        mode: label(MODE_LABELS, r.paymentMode),
        totalWeightGrams: r.totalWeightGrams, totalGoldPriceIRR: r.totalGoldPriceIRR,
        totalWageIRR: r.totalWageIRR, totalProfitIRR: r.totalProfitIRR, totalTaxIRR: r.totalTaxIRR,
        discountIRR: r.discountIRR, grandTotalIRR: r.grandTotalIRR,
        receivedCashIRR: r.receivedCashIRR, receivedGoldGrams: r.receivedGoldGrams,
        remainingIRR: r.remainingIRR, returnedAmountIRR: r.returnedAmountIRR,
        dueDate: r.dueDate,
        status: r.voidedAt ? 'باطل‌شده' : label(STATUS_LABELS, r.status),
        description: r.description,
      })),
    }),
  },
  {
    key: 'saleLines',
    name: 'اقلام فروش',
    store: 'sales',
    build: (rows, ctx) => ({
      columns: [
        c('number', 'شماره فاکتور'), c('date', 'تاریخ', 'date'), c('party', 'مشتری'), c('product', 'کالا'),
        c('goldType', 'نوع طلا'), c('karat', 'عیار', 'karat'), c('weightGrams', 'وزن (گرم)', 'grams'),
        c('ratePerGram', 'نرخ هر گرم', 'rate'), c('goldPriceIRR', 'بهای طلا', 'irr'), c('wageIRR', 'اجرت', 'irr'),
        c('profitIRR', 'سود', 'irr'), c('discountShareIRR', 'سهم تخفیف', 'irr'), c('taxIRR', 'مالیات', 'irr'),
        c('lineTotalIRR', 'مبلغ قلم', 'irr'), c('status', 'وضعیت فاکتور'),
      ],
      rows: lineRows(rows, ctx, {
        partyType: 'customer',
        partyKey: 'customerId',
        extra: (line) => ({ profitIRR: line.profitIRR, discountShareIRR: line.discountShareIRR, taxIRR: line.taxIRR }),
      }),
    }),
  }
);

const settlementSheet = (key, name, store, partyDefault) => ({
  key,
  name,
  store,
  build: (rows, ctx) => ({
    columns: [
      c('number', 'شماره'), c('date', 'تاریخ', 'date'), c('partyType', 'نوع طرف'), c('party', 'طرف حساب'),
      c('method', 'روش'), c('account', 'حساب'), c('amountIRR', 'مبلغ نقدی', 'irr'),
      c('weightGrams', 'وزن طلا (گرم)', 'grams'), c('karat', 'عیار', 'karat'), c('labName', 'آزمایشگاه'),
      c('valueGrams', 'معادل ۷۵۰ (گرم)', 'grams'), c('ratePerGram', 'نرخ توافقی', 'rate'),
      c('valueIRR', 'ارزش کل', 'irr'), c('status', 'وضعیت'), c('description', 'توضیحات'),
    ],
    rows: rows.map((r) => ({
      number: r.number, date: r.date,
      partyType: label(PARTY_LABELS, r.partyType || partyDefault),
      party: r.partyType === 'other' ? label(CASH_CATEGORY_LABELS, r.category, 'سایر') : ctx.partyName(r.partyType || partyDefault, r.partyId),
      method: label(METHOD_LABELS, r.method), account: ctx.accountName(r.accountId),
      amountIRR: r.amountIRR, weightGrams: r.weightGrams, karat: kf(r, r.karat), labName: r.labName || '',
      valueGrams: r.partyType === 'other' ? null : r.valueGrams ?? null, ratePerGram: r.ratePerGram,
      valueIRR: r.valueIRR, status: label(STATUS_LABELS, r.status), description: r.description,
    })),
  }),
});

ENTITY_SHEETS.push(
  {
    key: 'saleReturns',
    name: 'برگشت از فروش',
    store: 'saleReturns',
    build: (rows, ctx) => ({
      columns: [
        c('number', 'شماره'), c('date', 'تاریخ', 'date'), c('sale', 'فاکتور'), c('customer', 'مشتری'),
        c('totalWeightGrams', 'وزن (گرم)', 'grams'), c('totalAmountIRR', 'مبلغ', 'irr'),
        c('status', 'وضعیت'), c('description', 'توضیحات'),
      ],
      rows: rows.map((r) => ({
        number: r.number, date: r.date, sale: r.saleNumberSnapshot,
        customer: ctx.partyName('customer', r.customerId),
        totalWeightGrams: r.totalWeightGrams, totalAmountIRR: r.totalAmountIRR,
        status: label(STATUS_LABELS, r.status), description: r.description,
      })),
    }),
  },
  settlementSheet('receipts', 'دریافت‌ها', 'receipts', 'customer'),
  settlementSheet('payments', 'پرداخت‌ها', 'payments', 'supplier'),
  {
    key: 'allocations',
    name: 'تخصیص‌ها',
    store: 'allocations',
    build: (rows, ctx) => ({
      columns: [
        c('date', 'تاریخ', 'date'), c('docType', 'نوع سند'), c('doc', 'شماره سند'), c('party', 'طرف حساب'),
        c('targetType', 'نوع فاکتور'), c('target', 'شماره فاکتور'), c('amountIRR', 'مبلغ تخصیص', 'irr'),
        c('auto', 'خودکار'), c('status', 'وضعیت'),
      ],
      rows: rows.map((r) => ({
        date: r.date, docType: label(DOC_TYPE_LABELS, r.docType), doc: r.docNumberSnapshot,
        party: ctx.partyName(r.partyType, r.partyId),
        targetType: label(DOC_TYPE_LABELS, r.targetType), target: r.targetNumberSnapshot,
        amountIRR: r.amountIRR, auto: yesNo(r.auto), status: label(STATUS_LABELS, r.status),
      })),
    }),
  },
  {
    key: 'transfers',
    name: 'انتقال‌ها',
    store: 'transfers',
    build: (rows) => ({
      columns: [
        c('number', 'شماره'), c('date', 'تاریخ', 'date'), c('kind', 'نوع'), c('from', 'از'), c('to', 'به'),
        c('amountIRR', 'مبلغ', 'irr'), c('weightGrams', 'وزن (گرم)', 'grams'), c('karat', 'عیار', 'karat'),
        c('movedValueIRR', 'ارزش دفتری منتقل‌شده', 'irr'), c('status', 'وضعیت'), c('description', 'توضیحات'),
      ],
      rows: rows.map((r) => ({
        number: r.number, date: r.date, kind: r.kind === 'gold' ? 'طلا' : 'وجه',
        from: r.fromName, to: r.toName, amountIRR: r.amountIRR, weightGrams: r.weightGrams,
        karat: kf(r, r.karat), movedValueIRR: r.movedValueIRR, status: label(STATUS_LABELS, r.status),
        description: r.description,
      })),
    }),
  },
  {
    key: 'inventoryDocs',
    name: 'اسناد انبار',
    store: 'inventoryDocs',
    build: (rows, ctx) => ({
      columns: [
        c('number', 'شماره'), c('date', 'تاریخ', 'date'), c('kind', 'نوع سند'), c('category', 'دسته'),
        c('bucket', 'سطل انبار'), c('direction', 'جهت'), c('weightGrams', 'وزن (گرم)', 'grams'),
        c('outputWeightGrams', 'وزن خروجی (گرم)', 'grams'), c('lossGrams', 'افت (گرم)', 'grams'),
        c('ratePerGram', 'نرخ', 'rate'), c('valueIRR', 'ارزش', 'irr'), c('status', 'وضعیت'), c('description', 'توضیحات'),
      ],
      rows: rows.map((r) => ({
        number: r.number, date: r.date, kind: r.kind === 'melt' ? 'ذوب / تبدیل' : 'اصلاح موجودی',
        category: r.categoryLabel, bucket: ctx.refName({ kind: 'inventory', id: r.refId }),
        direction: label(DIRECTION_LABELS, r.direction), weightGrams: r.weightGrams,
        outputWeightGrams: r.outputWeightGrams, lossGrams: r.lossGrams, ratePerGram: r.ratePerGram,
        valueIRR: r.valueIRR, status: label(STATUS_LABELS, r.status), description: r.description,
      })),
    }),
  }
);

ENTITY_SHEETS.push(
  {
    key: 'dueDates',
    name: 'سررسیدها',
    store: 'dueDates',
    build: (rows, ctx) => ({
      columns: [
        c('dueDate', 'تاریخ سررسید', 'date'), c('sourceType', 'نوع سند'), c('partyType', 'نوع طرف'),
        c('party', 'طرف حساب'), c('amountIRR', 'مبلغ', 'irr'), c('status', 'وضعیت'),
      ],
      rows: rows.map((r) => ({
        dueDate: r.dueDate,
        sourceType: label(DOC_TYPE_LABELS, r.sourceType),
        partyType: label(PARTY_LABELS, r.partyType),
        party: ctx.partyName(r.partyType, r.partyId),
        amountIRR: r.amountIRR,
        // «سررسید گذشته» یک وضعیت **ذخیره‌شده** نیست (تصمیم Phase 12): اینجا هم
        // فقط وضعیت تسویه نوشته می‌شود، نه یک برچسب زمانیِ لحظه‌ی خروجی‌گیری.
        status: label(STATUS_LABELS, r.status),
      })),
    }),
  },
  {
    key: 'goldLedger',
    name: 'دفتر طلا',
    store: 'goldLedger',
    build: (rows, ctx) => ({
      columns: [
        c('date', 'تاریخ', 'date'), c('reason', 'دلیل'), c('ref', 'مرجع'), c('direction', 'جهت'),
        c('goldType', 'نوع طلا'), c('karat', 'عیار', 'karat'), c('product', 'کالا'),
        c('inGrams', 'ورود (گرم)', 'grams'), c('outGrams', 'خروج (گرم)', 'grams'),
      ],
      rows: rows.map((r) => ({
        date: r.date, reason: r.reason, ref: ctx.refName(r.accountRef),
        direction: label(DIRECTION_LABELS, r.direction),
        goldType: label(GOLD_ACCOUNT_TYPE_LABELS, r.goldType), karat: kf(r, r.karat),
        product: r.productId ? ctx.productName(r.productId) : '',
        inGrams: r.direction === 'IN' ? r.weightGrams : 0,
        outGrams: r.direction === 'OUT' ? r.weightGrams : 0,
      })),
    }),
  },
  {
    key: 'moneyLedger',
    name: 'دفتر وجه',
    store: 'moneyLedger',
    build: (rows, ctx) => ({
      columns: [
        c('date', 'تاریخ', 'date'), c('reason', 'دلیل'), c('refKind', 'نوع مرجع'), c('ref', 'مرجع'),
        c('debit', 'بدهکار', 'irr'), c('credit', 'بستانکار', 'irr'),
      ],
      rows: rows.map((r) => ({
        date: r.date, reason: r.reason,
        refKind: label(PARTY_LABELS, r.accountRef?.kind, r.accountRef?.kind === 'inventory' ? 'انبار' : 'حساب'),
        ref: ctx.refName(r.accountRef), debit: r.debit, credit: r.credit,
      })),
    }),
  },
  {
    key: 'priceRates',
    name: 'نرخ روز',
    store: 'priceRates',
    build: (rows) => ({
      columns: [
        c('effectiveDate', 'تاریخ', 'date'), c('ratePerGram18k', 'نرخ هر گرم ۷۵۰', 'rate'),
        c('meltedFeePercent', 'کارمزد تبدیل (٪)', 'percent'), c('defaultWagePercent', 'اجرت پیش‌فرض (٪)', 'percent'),
        c('defaultProfitPercent', 'سود پیش‌فرض (٪)', 'percent'), c('defaultTaxPercent', 'مالیات پیش‌فرض (٪)', 'percent'),
      ],
      rows: rows.map((r) => ({
        effectiveDate: r.effectiveDate, ratePerGram18k: r.ratePerGram18k,
        meltedFeePercent: r.meltedFeePercent, defaultWagePercent: r.defaultWagePercent,
        defaultProfitPercent: r.defaultProfitPercent, defaultTaxPercent: r.defaultTaxPercent,
      })),
    }),
  }
);

const SHEET_BY_KEY = new Map(ENTITY_SHEETS.map((s) => [s.key, s]));
export function entitySheetKeys() {
  return ENTITY_SHEETS.map((s) => ({ key: s.key, name: s.name }));
}

// ─────────────────────────── ساخت فایل‌ها ───────────────────────────

function fileStamp(at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}`;
}

/**
 * خروجی Excel یک یا چند Entity.
 * @param {string[]|null} keys کلیدهای ENTITY_SHEETS؛ خالی/ناموجود ⇒ همه.
 */
export async function buildEntitiesWorkbook(keys = null, { at = new Date() } = {}) {
  const wanted = Array.isArray(keys) && keys.length ? keys.map((k) => SHEET_BY_KEY.get(k)).filter(Boolean) : ENTITY_SHEETS;
  if (!wanted.length) throw new Error('هیچ بخشی برای خروجی Excel انتخاب نشده است.');

  const ctx = await buildContext();
  const cache = new Map();
  const sheets = [];

  for (const def of wanted) {
    if (!cache.has(def.store)) cache.set(def.store, await getAll(def.store));
    const built = def.build(cache.get(def.store), ctx);
    sheets.push({
      name: def.name,
      title: def.name,
      meta: [['تاریخ خروجی', formatJalaliDateLong(at)], ['تعداد ردیف', String(built.rows.length)]],
      columns: built.columns,
      rows: built.rows,
      totals: null,
    });
  }

  const single = wanted.length === 1 ? `_${wanted[0].key}` : '';
  return {
    bytes: buildWorkbook(sheets, { createdAt: at }),
    fileName: `GoldShop_Export${single}_${fileStamp(at)}.xlsx`,
    sheetCount: sheets.length,
    rowCount: sheets.reduce((s, sh) => s + sh.rows.length, 0),
  };
}

/**
 * خروجی Excel یک گزارش Phase 14 — هر Section یک Sheet.
 * هیچ عددی بازمحاسبه نمی‌شود؛ `columns/rows/totals` مستقیماً از موتور گزارش می‌آید.
 */
export function buildReportWorkbook(report, { at = new Date(), formatSummary = null } = {}) {
  if (!report || !Array.isArray(report.sections) || !report.sections.length) {
    throw new Error('این گزارش داده‌ای برای خروجی Excel ندارد.');
  }
  const meta = [
    ['گزارش', report.title || ''],
    ['بازه', report.rangeLabel || ''],
    ['تاریخ خروجی', formatJalaliDateLong(at)],
  ];
  for (const item of report.summary || []) {
    // قالب نمایش خلاصه در لایه‌ی صفحه زندگی می‌کند (reportFormat.js) و services به
    // pages وابسته نمی‌شود؛ پس صفحه آن را تزریق می‌کند و خروجی همان متن نوار خلاصه
    // را می‌نویسد. بدون تزریق، مقدار خام نوشته می‌شود (هیچ‌وقت خالی نمی‌ماند).
    meta.push([item.label, formatSummary ? String(formatSummary(item)) : String(item.value ?? '')]);
  }

  const sheets = report.sections.map((section, i) => {
    // عنوان بخش وقتی با عنوان گزارش یکی است تکرار نمی‌شود («فروش روزانه — فروش روزانه»).
    const sectionTitle = section.title && section.title !== report.title ? ` — ${section.title}` : '';
    return {
    name: section.title || `بخش ${i + 1}`,
    title: `${report.title || ''}${sectionTitle}`,
    meta: i === 0 ? meta : [['بازه', report.rangeLabel || '']],
    columns: (section.columns || []).map((col) => ({ key: col.key, header: col.header, kind: col.kind })),
    rows: section.rows || [],
    totals: section.totals || null,
    };
  });

  return {
    bytes: buildWorkbook(sheets, { createdAt: at }),
    fileName: `GoldShop_Report_${(report.key || 'report').replace(/[^a-zA-Z0-9_.-]/g, '-')}_${fileStamp(at)}.xlsx`,
    sheetCount: sheets.length,
    rowCount: sheets.reduce((s, sh) => s + sh.rows.length, 0),
  };
}
