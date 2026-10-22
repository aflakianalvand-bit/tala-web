// financialReports.js — گزارش‌های مالی (Phase 14)
//
// ═══════════════════════════════════════════════════════════════════════════
// دو نوع منبع، با معنای متفاوت (عمداً و با برچسب صریح در هر گزارش):
//
// ۱) **اسناد** (دریافت / پرداخت): «چه اسنادی با این تاریخ ثبت شده و الان معتبرند؟»
//    سند باطل‌شده کلاً کنار می‌رود — همان نمایی که کاربر در فهرست اسناد می‌بیند.
//
// ۲) **دفتر** (مطالبات / بدهی / صندوق / گردش طرف حساب): «در این دوره چه گذشت؟»
//    ابطال یک Reversal با **تاریخ ابطال** است (Phase 6)، پس سندی که فروردین ثبت و
//    خرداد باطل شده، در فروردین اثر مثبت و در خرداد اثر منفی دارد. این درستِ حسابداری
//    دوره‌ای است: مانده‌ی پایان فروردین واقعاً همان بوده که آن روز دیده می‌شد.
//
// Phase 27: واحد رسمی مانده‌ی اشخاص گرم ۷۵۰ است (Phase 19) — ستون اصلی گزارش‌های مطالبات،
// بدهی و گردش طرف حساب گرم ۷۵۰ است و ریال کنارش (قاعده‌ی «هر دو کنار هم»). گرم از همان
// موتور صفحه‌ی شخص و معین می‌آید (gramsPeriodMap / gramsStatement)، جهت بد/بس از balanceSideOf.
//
// هیچ مانده‌ای اینجا با فرمول جدید ساخته نمی‌شود؛ همه از ledger.js (moneyPeriodMap،
// goldPeriodMap، moneyStatement، sliceStatement) و allocations.js (invoiceOutstanding
// از مسیر partyInvoices) می‌آیند.
// ═══════════════════════════════════════════════════════════════════════════

import { finenessOf } from '../units.js';
import { getAll, get } from '../../db/repo.js';
import {
  moneyPeriodMap,
  goldPeriodMap,
  gramsPeriodMap,
  moneyStatement,
  goldStatement,
  gramsStatement,
  sliceStatement,
  roundGrams,
} from '../ledger.js';
import { roundBaseGrams, isZeroGrams } from '../goldTotals.js';
import { balanceSideOf, SIDE_WORDS } from '../ledgerSummary.js';
import { partyInvoices, invoiceGrossIRR } from '../allocations.js';
import { classifyDue, getAlertDays } from '../dueDates.js';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, GOLD_ACCOUNT_TYPE_LABELS, IRR_EPS, GRAM_EPS } from '../accounts.js';
import { CASH_CATEGORY_LABELS } from '../cashFlow.js';
import { entryPhase, inRange, describeRange } from '../../utils/dateRange.js';
import { buildDocResolver, DOC_KIND_LABELS } from './docRefs.js';
import { COL, col, num, section, summaryItem, needsParamReport } from './model.js';

const DUE_STATE_REPORT_LABELS = {
  overdue: 'سررسید گذشته',
  today: 'امروز',
  near: 'نزدیک',
  future: 'آینده',
  settled: 'تسویه‌شده',
  voided: 'باطل',
};

const PARTY = {
  customer: {
    store: 'customers',
    label: 'مشتری',
    statusOf: (b) => (b > IRR_EPS ? 'بدهکار' : b < -IRR_EPS ? 'بستانکار' : 'تسویه'),
    increaseHeader: 'افزایش طلب (بدهکار)',
    decreaseHeader: 'کاهش طلب (بستانکار)',
  },
  supplier: {
    store: 'suppliers',
    label: 'تأمین‌کننده',
    statusOf: (b) => (b > IRR_EPS ? 'طلبکار از ما' : b < -IRR_EPS ? 'پیش‌پرداخت' : 'تسویه'),
    increaseHeader: 'افزایش بدهی (بستانکار)',
    decreaseHeader: 'کاهش بدهی (بدهکار)',
  },
};

function byDateThenNumber(a, b) {
  return String(a.date || '').localeCompare(String(b.date || '')) || String(a.number || '').localeCompare(String(b.number || ''));
}

function accountLabel(account) {
  if (!account) return 'حساب نامشخص';
  const type = ACCOUNT_TYPE_LABELS[account.type] || '';
  return `${account.name}${type && type !== account.name ? ` (${type})` : ''}${account.deletedAt ? ' — حذف‌شده' : ''}`;
}

// ═════════════════════════ ۱) دریافت / پرداخت ═════════════════════════

const DOC_REPORTS = {
  receipts: { key: 'finance.receipts', title: 'گزارش دریافت', verb: 'دریافت', cashflow: 'واریز', invoiceStore: 'sales', invoiceField: 'relatedSaleId', invoiceLabel: 'فاکتور فروش' },
  payments: { key: 'finance.payments', title: 'گزارش پرداخت', verb: 'پرداخت', cashflow: 'برداشت', invoiceStore: 'purchases', invoiceField: 'relatedPurchaseId', invoiceLabel: 'سند خرید' },
};

async function settlementDocsReport(store, range) {
  const meta = DOC_REPORTS[store];
  const [docs, customers, suppliers, accounts, invoices] = await Promise.all([
    getAll(store),
    getAll('customers'),
    getAll('suppliers'),
    getAll('accounts'),
    getAll(meta.invoiceStore),
  ]);
  const partyMaps = { customer: new Map(customers.map((c) => [c.id, c])), supplier: new Map(suppliers.map((s) => [s.id, s])) };
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));

  const rows = docs
    .filter((d) => d.status !== 'voided' && inRange(d.date, range))
    .sort(byDateThenNumber)
    .map((d) => {
      let party;
      let source;
      if (d.partyType === 'other') {
        const cat = CASH_CATEGORY_LABELS[d.partyId] || d.partyId || '—';
        party = cat;
        source = { key: `cashflow:${d.partyId}`, label: `${meta.cashflow} بدون طرف حساب — ${cat}`, ref: meta.cashflow };
      } else {
        const p = partyMaps[d.partyType]?.get(d.partyId);
        party = p?.name || d.partyNameSnapshot || '—';
        if (d[meta.invoiceField]) {
          const inv = invoiceById.get(d[meta.invoiceField]);
          source = { key: 'invoice', label: `هم‌زمان با ${meta.invoiceLabel}`, ref: `${meta.invoiceLabel} ${inv?.number || ''}`.trim() };
        } else if (d.source === 'settlement') {
          source = { key: 'settlement', label: 'تسویه‌ی مستقل', ref: 'تسویه' };
        } else {
          source = { key: 'other', label: 'سایر', ref: '—' };
        }
      }

      let method;
      if (d.method === 'cash') {
        method = { key: `account:${d.accountId}`, label: accountLabel(accountById.get(d.accountId)) };
      } else if (d.method === 'gold') {
        // Phase 22: عیار هزاری (سند پیش از v10 ترجمه می‌شود، دست نمی‌خورد).
        method = { key: `gold:${d.goldType}:${finenessOf(d, d.karat)}`, label: `طلا — ${GOLD_ACCOUNT_TYPE_LABELS[d.goldType] || d.goldType || ''} عیار ${finenessOf(d, d.karat)}` };
      } else if (d.method === 'discount') {
        method = { key: 'discount', label: 'تخفیف تسویه (بدون جابه‌جایی وجه)' };
      } else {
        method = { key: `m:${d.method}`, label: String(d.method || '—') };
      }

      const isDiscount = d.method === 'discount';
      return {
        date: d.date,
        number: d.number,
        party,
        source: source.ref,
        sourceKey: source.key,
        sourceLabel: source.label,
        method: method.label,
        methodKey: method.key,
        amountIRR: isDiscount ? 0 : Math.round(num(d.valueIRR ?? d.amountIRR)),
        grams: d.method === 'gold' ? num(d.weightGrams) : 0,
        discountIRR: isDiscount ? Math.round(num(d.valueIRR ?? d.amountIRR)) : 0,
        description: d.description || '',
      };
    });

  const group = (keyField, labelField) => {
    const map = new Map();
    for (const r of rows) {
      const g = map.get(r[keyField]) || { key: r[keyField], label: r[labelField], count: 0, amountIRR: 0, grams: 0, discountIRR: 0 };
      g.count += 1;
      g.amountIRR += r.amountIRR;
      g.grams = roundGrams(g.grams + r.grams);
      g.discountIRR += r.discountIRR;
      map.set(r[keyField], g);
    }
    return [...map.values()].sort((a, b) => b.amountIRR - a.amountIRR || String(a.label).localeCompare(String(b.label), 'fa'));
  };

  const groupColumns = (header) => [
    col('label', header),
    col('count', 'تعداد سند', COL.COUNT),
    col('amountIRR', `مبلغ ${meta.verb}`, COL.IRR),
    col('grams', 'وزن طلا', COL.GRAMS),
    col('discountIRR', 'تخفیف', COL.IRR),
  ];

  const cash = rows.filter((r) => r.methodKey.startsWith('account:')).reduce((s, r) => s + r.amountIRR, 0);
  const goldValue = rows.filter((r) => r.methodKey.startsWith('gold:')).reduce((s, r) => s + r.amountIRR, 0);
  const grams = roundGrams(rows.reduce((s, r) => s + r.grams, 0));
  const discount = rows.reduce((s, r) => s + r.discountIRR, 0);

  return {
    key: meta.key,
    title: meta.title,
    rangeLabel: describeRange(range),
    summary: [
      summaryItem('تعداد سند', rows.length, COL.COUNT),
      summaryItem(`${meta.verb} وجه`, cash, COL.IRR),
      summaryItem(`${meta.verb} طلا (ارزش)`, goldValue, COL.IRR),
      summaryItem(`${meta.verb} طلا (وزن)`, grams, COL.GRAMS),
      summaryItem(`جمع ${meta.verb}`, cash + goldValue, COL.IRR, 'success'),
      ...(discount ? [summaryItem('تخفیف تسویه', discount, COL.IRR)] : []),
    ],
    sections: [
      section({ key: 'byMethod', title: 'به تفکیک روش / حساب', columns: groupColumns('روش / حساب'), rows: group('methodKey', 'method') }),
      section({ key: 'bySource', title: 'به تفکیک منشأ', columns: groupColumns('منشأ'), rows: group('sourceKey', 'sourceLabel') }),
      section({
        key: 'docs',
        title: `ریز اسناد ${meta.verb}`,
        columns: [
          col('date', 'تاریخ', COL.DATE),
          col('number', 'شماره'),
          col('party', 'طرف / دسته'),
          col('source', 'بابت'),
          col('method', 'روش'),
          col('amountIRR', 'مبلغ', COL.IRR),
          col('grams', 'وزن طلا', COL.GRAMS),
          col('discountIRR', 'تخفیف', COL.IRR),
          col('description', 'توضیحات'),
        ],
        rows,
      }),
    ],
    notes: [
      'اسناد باطل‌شده در این گزارش نیستند. «تخفیف تسویه» بدهی را می‌بندد ولی وجهی جابه‌جا نمی‌کند، پس در جمع نیامده است.',
      'انتقال بین حساب‌ها دریافت/پرداخت نیست؛ در «گزارش صندوق» آمده است.',
    ],
  };
}

export const receiptsReport = (range) => settlementDocsReport('receipts', range);
export const paymentsReport = (range) => settlementDocsReport('payments', range);

// ═════════════════════════ ۲) مطالبات / بدهی ═════════════════════════

async function partyBalancesReport(kind, range) {
  const cfg = PARTY[kind];
  const phase = entryPhase(range);
  const [money, grams, gold, parties, nearDays] = await Promise.all([
    moneyPeriodMap(kind, phase),
    gramsPeriodMap(kind, phase),
    goldPeriodMap(kind, phase),
    getAll(cfg.store),
    getAlertDays(),
  ]);
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const ids = new Set([...money.rows.keys(), ...grams.rows.keys(), ...gold.rows.keys()]);
  const zeroPeriod = { opening: 0, increase: 0, decrease: 0, closing: 0 };

  const rows = [];
  for (const id of ids) {
    const m = money.rows.get(id) || zeroPeriod;
    const b = grams.rows.get(id) || zeroPeriod;
    const g = gold.rows.get(id) || { closing: 0 };
    const nonZero =
      [m.opening, m.increase, m.decrease, m.closing].some((v) => Math.abs(v) >= IRR_EPS) ||
      [b.opening, b.increase, b.decrease, b.closing].some((v) => !isZeroGrams(v)) ||
      Math.abs(g.closing) >= GRAM_EPS;
    if (!nonZero) continue;
    const p = partyById.get(id);
    const side = balanceSideOf(kind, b.closing);
    rows.push({
      key: id,
      label: `${p?.name || '— نامشخص —'}${p?.deletedAt ? ' (حذف‌شده)' : ''}`,
      code: p?.code || '',
      // گرم ۷۵۰ — واحد رسمی (Phase 19/27)
      openingGrams: roundBaseGrams(b.opening),
      increaseGrams: roundBaseGrams(b.increase),
      decreaseGrams: roundBaseGrams(b.decrease),
      closingGrams: side === 'zero' ? 0 : roundBaseGrams(b.closing),
      side,
      sideLabel: SIDE_WORDS[side],
      // ریال دفتر — کنار گرم
      opening: Math.round(m.opening),
      increase: Math.round(m.increase),
      decrease: Math.round(m.decrease),
      closing: Math.round(m.closing),
      status: cfg.statusOf(m.closing),
      goldGrams: roundGrams(g.closing),
    });
  }
  rows.sort(
    (a, b) => b.closingGrams - a.closingGrams || b.closing - a.closing || String(a.label).localeCompare(String(b.label), 'fa')
  );

  // ── فاکتورهای باز (وضعیت امروز) ──
  const today = new Date();
  const openRows = [];
  for (const party of parties) {
    const invoices = await partyInvoices(kind, party.id, { onlyOpen: true });
    for (const r of invoices) {
      if (!inRange(r.date, range)) continue;
      const gross = invoiceGrossIRR(r.invoice);
      const due = r.dueDate ? classifyDue({ dueDate: r.dueDate, remainingIRR: r.outstandingIRR, today, nearDays }) : null;
      openRows.push({
        party: party.name || '—',
        number: r.number,
        date: r.date,
        totalGrams: roundBaseGrams(r.totalGrams),
        paidGrams: roundBaseGrams(r.totalGrams - r.outstandingGrams),
        outstandingGrams: roundBaseGrams(r.outstandingGrams),
        grossIRR: gross,
        paidIRR: Math.round(gross - r.outstandingIRR),
        outstandingIRR: Math.round(r.outstandingIRR),
        dueDate: r.dueDate || null,
        dueState: due ? DUE_STATE_REPORT_LABELS[due.state] : 'بدون سررسید',
      });
    }
  }
  openRows.sort(byDateThenNumber);

  const positive = rows.filter((r) => r.closing > 0).reduce((s, r) => s + r.closing, 0);
  const negative = rows.filter((r) => r.closing < 0).reduce((s, r) => s - r.closing, 0);
  // جمع گرمی به همان قاعده‌ی کارت داشبورد (sumGramBalances): مثبت‌ها و منفی‌ها جدا.
  const positiveGrams = roundBaseGrams(rows.filter((r) => r.closingGrams > 0).reduce((s, r) => s + r.closingGrams, 0));
  const negativeGrams = roundBaseGrams(rows.filter((r) => r.closingGrams < 0).reduce((s, r) => s - r.closingGrams, 0));
  const isCustomer = kind === 'customer';

  const notes = [
    'مانده‌ی اصلی گرم ۷۵۰ است (واحد رسمی حساب اشخاص) و ریال دفتر کنارش آمده؛ «بد» یعنی طرف به ما بدهکار است، «بس» یعنی ما به طرف بدهکاریم.',
    'مانده‌ها از دفتر وجه و «در پایان روز تا» هستند؛ ابطال سند در تاریخ ابطال اثر می‌گذارد.',
    'بخش «اسناد باز» وضعیت امروز است؛ فیلتر تاریخ روی تاریخ خودِ سند اعمال شده است.',
  ];
  if (money.skipped || gold.skipped) notes.push(`${money.skipped + gold.skipped} رکورد دفتر تاریخ نامعتبر دارد و در بازه شمرده نشد.`);

  return {
    key: isCustomer ? 'finance.receivables' : 'finance.payables',
    title: isCustomer ? 'گزارش مطالبات' : 'گزارش بدهی',
    rangeLabel: describeRange(range),
    summary: isCustomer
      ? [
          summaryItem('مطالبات از مشتریان (گرم ۷۵۰)', positiveGrams, COL.GRAMS, 'success'),
          summaryItem('بستانکاری مشتریان (گرم ۷۵۰)', negativeGrams, COL.GRAMS),
          summaryItem('مطالبات از مشتریان', positive, COL.IRR, 'danger'),
          summaryItem('بستانکاری مشتریان', negative, COL.IRR),
          summaryItem('خالص طلب', positive - negative, COL.IRR),
          summaryItem('مشتری بدهکار', rows.filter((r) => r.closing > IRR_EPS).length, COL.COUNT),
          summaryItem('فاکتور باز', openRows.length, COL.COUNT),
        ]
      : [
          summaryItem('بدهی به تأمین‌کنندگان (گرم ۷۵۰)', positiveGrams, COL.GRAMS, 'danger'),
          summaryItem('پیش‌پرداخت به تأمین‌کنندگان (گرم ۷۵۰)', negativeGrams, COL.GRAMS),
          summaryItem('بدهی به تأمین‌کنندگان', positive, COL.IRR, 'danger'),
          summaryItem('پیش‌پرداخت به تأمین‌کنندگان', negative, COL.IRR),
          summaryItem('خالص بدهی', positive - negative, COL.IRR),
          summaryItem('تأمین‌کننده طلبکار', rows.filter((r) => r.closing > IRR_EPS).length, COL.COUNT),
          summaryItem('سند باز', openRows.length, COL.COUNT),
        ],
    sections: [
      section({
        key: 'balances',
        title: `مانده‌ی ${cfg.label}‌ها`,
        columns: [
          col('label', cfg.label),
          col('code', 'کد'),
          col('openingGrams', 'مانده ابتدا (گرم ۷۵۰)', COL.GRAMS),
          col('increaseGrams', `${cfg.increaseHeader} (گرم ۷۵۰)`, COL.GRAMS),
          col('decreaseGrams', `${cfg.decreaseHeader} (گرم ۷۵۰)`, COL.GRAMS),
          col('closingGrams', 'مانده پایان (گرم ۷۵۰)', COL.GRAMS),
          col('sideLabel', 'بد / بس'),
          col('closing', 'مانده پایان (ریال)', COL.IRR),
          col('opening', 'مانده ابتدا (ریال)', COL.IRR),
          col('increase', `${cfg.increaseHeader} (ریال)`, COL.IRR),
          col('decrease', `${cfg.decreaseHeader} (ریال)`, COL.IRR),
          col('goldGrams', 'مانده طلا', COL.GRAMS),
        ],
        rows,
        emptyTitle: `${cfg.label} با مانده یا گردش در این بازه نیست`,
      }),
      section({
        key: 'openInvoices',
        title: isCustomer ? 'فاکتورهای باز (مانده امروز)' : 'اسناد خرید باز (مانده امروز)',
        columns: [
          col('party', cfg.label),
          col('number', 'شماره'),
          col('date', 'تاریخ', COL.DATE),
          col('totalGrams', isCustomer ? 'جمع فاکتور (گرم ۷۵۰)' : 'جمع سند (گرم ۷۵۰)', COL.GRAMS),
          col('paidGrams', 'تسویه‌شده (گرم ۷۵۰)', COL.GRAMS),
          col('outstandingGrams', 'مانده (گرم ۷۵۰)', COL.GRAMS),
          col('grossIRR', isCustomer ? 'مبلغ خالص فاکتور (ریال)' : 'مبلغ سند (ریال)', COL.IRR),
          col('paidIRR', 'تسویه‌شده (ریال)', COL.IRR),
          col('outstandingIRR', 'مانده (ریال)', COL.IRR),
          col('dueDate', 'سررسید', COL.DATE),
          col('dueState', 'وضعیت سررسید'),
        ],
        rows: openRows,
        emptyTitle: 'سند بازی در این بازه نیست',
      }),
    ],
    notes,
  };
}

export const receivablesReport = (range) => partyBalancesReport('customer', range);
export const payablesReport = (range) => partyBalancesReport('supplier', range);

// ═════════════════════════ ۳) صندوق ═════════════════════════

export async function cashReport(range, { accountId = null } = {}) {
  const phase = entryPhase(range);
  const [money, accounts, entries, resolve] = await Promise.all([
    moneyPeriodMap('account', phase),
    getAll('accounts'),
    getAll('moneyLedger'),
    buildDocResolver(),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const balanceRows = [];
  const ids = new Set([...accounts.filter((a) => !a.deletedAt).map((a) => a.id), ...money.rows.keys()]);
  for (const id of ids) {
    if (accountId && id !== accountId) continue;
    const m = money.rows.get(id) || { opening: 0, debit: 0, credit: 0, closing: 0 };
    const a = accountById.get(id);
    const touched = [m.opening, m.debit, m.credit, m.closing].some((v) => Math.abs(v) >= IRR_EPS);
    if (a?.deletedAt && !touched) continue;
    balanceRows.push({
      key: id,
      label: accountLabel(a),
      type: a?.type || '',
      createdAt: a?.createdAt || '',
      opening: Math.round(m.opening),
      inIRR: Math.round(m.debit),
      outIRR: Math.round(m.credit),
      closing: Math.round(m.closing),
    });
  }
  const typeOrder = (t) => (ACCOUNT_TYPES.indexOf(t) + 99) % 99;
  balanceRows.sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || String(a.createdAt).localeCompare(String(b.createdAt)));

  const total = (k) => balanceRows.reduce((s, r) => s + r[k], 0);
  const summary = [
    summaryItem('مانده ابتدا', total('opening'), COL.IRR),
    summaryItem('ورود', total('inIRR'), COL.IRR, 'success'),
    summaryItem('خروج', total('outIRR'), COL.IRR, 'danger'),
    summaryItem('مانده پایان', total('closing'), COL.IRR),
  ];

  const sections = [
    section({
      key: 'accounts',
      title: 'مانده‌ی حساب‌ها',
      columns: [col('label', 'حساب'), col('opening', 'مانده ابتدا', COL.IRR), col('inIRR', 'ورود', COL.IRR), col('outIRR', 'خروج', COL.IRR), col('closing', 'مانده پایان', COL.IRR)],
      rows: balanceRows,
    }),
  ];

  // ── به تفکیک نوع سند ──
  const periodEntries = entries
    .filter((e) => e?.accountRef?.kind === 'account' && (!accountId || e.accountRef.id === accountId))
    .filter((e) => phase(e) === 'in')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)));
  const kinds = new Map();
  for (const e of periodEntries) {
    const ref = resolve(e.transactionId);
    const k = kinds.get(ref.kind) || { key: ref.kind, label: DOC_KIND_LABELS[ref.kind] || ref.kind, inIRR: 0, outIRR: 0 };
    k.inIRR += num(e.debit);
    k.outIRR += num(e.credit);
    kinds.set(ref.kind, k);
  }
  const kindRows = [...kinds.values()]
    .map((k) => ({ ...k, netIRR: Math.round(k.inIRR - k.outIRR) }))
    .sort((a, b) => b.inIRR + b.outIRR - (a.inIRR + a.outIRR));
  sections.push(
    section({
      key: 'byKind',
      title: 'ورود و خروج به تفکیک نوع سند',
      columns: [col('label', 'نوع سند'), col('inIRR', 'ورود', COL.IRR), col('outIRR', 'خروج', COL.IRR), col('netIRR', 'خالص', COL.IRR)],
      rows: kindRows,
      note: accountId ? '' : 'انتقال بین دو حساب در یکی ورود و در دیگری خروج است؛ خالص آن در جمع همه‌ی حساب‌ها صفر است.',
    })
  );

  // ── گردش ──
  if (accountId) {
    const stmt = sliceStatement(await moneyStatement('account', accountId), phase);
    const rows = [
      { date: null, doc: 'مانده ابتدای بازه', inIRR: null, outIRR: null, balance: stmt.opening },
      ...stmt.rows.map((r) => ({ date: r.date, doc: resolve(r.transactionId).label, inIRR: r.debit, outIRR: r.credit, balance: r.balance })),
    ];
    const sec = section({
      key: 'statement',
      title: `گردش ${accountLabel(accountById.get(accountId))}`,
      columns: [col('date', 'تاریخ', COL.DATE), col('doc', 'سند'), col('inIRR', 'ورود', COL.IRR), col('outIRR', 'خروج', COL.IRR), col('balance', 'مانده', COL.IRR, { sum: false })],
      rows,
    });
    if (sec.totals) sec.totals.balance = stmt.closing;
    sections.push(sec);
  } else {
    sections.push(
      section({
        key: 'moves',
        title: 'ریز گردش همه‌ی حساب‌ها',
        columns: [col('date', 'تاریخ', COL.DATE), col('account', 'حساب'), col('doc', 'سند'), col('inIRR', 'ورود', COL.IRR), col('outIRR', 'خروج', COL.IRR)],
        rows: periodEntries.map((e) => ({
          date: e.date,
          account: accountLabel(accountById.get(e.accountRef.id)),
          doc: resolve(e.transactionId).label,
          inIRR: num(e.debit),
          outIRR: num(e.credit),
        })),
        note: 'برای گردش با مانده‌ی تجمعی، یک حساب را انتخاب کنید.',
      })
    );
  }

  const notes = ['حساب‌های طلایی (آبشده/متفرقه) در گزارش‌های موجودی آمده‌اند.'];
  if (money.skipped) notes.push(`${money.skipped} رکورد دفتر تاریخ نامعتبر دارد و در بازه شمرده نشد.`);
  return { key: 'finance.cash', title: 'گزارش صندوق و حساب‌ها', rangeLabel: describeRange(range), summary, sections, notes };
}

// ═════════════════════════ ۴) گردش طرف حساب ═════════════════════════

async function partyStatementReport(kind, range, { partyId = null } = {}) {
  const cfg = PARTY[kind];
  const key = kind === 'customer' ? 'finance.customerStatement' : 'finance.supplierStatement';
  const baseTitle = `گردش حساب ${cfg.label}`;
  if (!partyId) {
    return needsParamReport({ key, title: baseTitle, rangeLabel: describeRange(range), message: `برای دیدن گردش، یک ${cfg.label} انتخاب کنید.` });
  }
  const phase = entryPhase(range);
  const [party, moneyStmt, gramsStmt, goldStmt, resolve] = await Promise.all([
    get(cfg.store, partyId),
    moneyStatement(kind, partyId),
    gramsStatement(kind, partyId),
    goldStatement(kind, partyId),
    buildDocResolver(),
  ]);
  const money = sliceStatement(moneyStmt, phase);
  const grams = sliceStatement(gramsStmt, phase, roundBaseGrams);
  const gold = sliceStatement(goldStmt, phase, roundGrams);

  // گردش اصلی: گرم ۷۵۰ (همان رکوردهای دفتر وجه، ستون گرمی) با جهت بد/بس و ریال همان ردیف کنارش.
  const sideWord = (v) => SIDE_WORDS[balanceSideOf(kind, v)];
  const gramsSec = section({
    key: 'grams',
    title: 'گردش حساب (گرم ۷۵۰)',
    columns: [
      col('date', 'تاریخ', COL.DATE),
      col('doc', 'سند'),
      col('debitGrams', 'بدهکار (گرم ۷۵۰)', COL.GRAMS),
      col('creditGrams', 'بستانکار (گرم ۷۵۰)', COL.GRAMS),
      col('balanceGrams', 'مانده (گرم ۷۵۰)', COL.GRAMS, { sum: false }),
      col('sideLabel', 'بد / بس'),
      col('debit', 'بدهکار (ریال)', COL.IRR),
      col('credit', 'بستانکار (ریال)', COL.IRR),
    ],
    rows: [
      { date: null, doc: 'مانده ابتدای بازه', debitGrams: null, creditGrams: null, balanceGrams: Math.abs(grams.opening), sideLabel: sideWord(grams.opening), debit: null, credit: null },
      ...grams.rows.map((r) => ({
        date: r.date,
        doc: resolve(r.transactionId).label,
        debitGrams: r.debitGrams,
        creditGrams: r.creditGrams,
        balanceGrams: Math.abs(r.balance),
        sideLabel: sideWord(r.balance),
        debit: r.debit,
        credit: r.credit,
      })),
    ],
  });
  if (gramsSec.totals) {
    gramsSec.totals.balanceGrams = Math.abs(grams.closing);
    gramsSec.totals.sideLabel = sideWord(grams.closing);
  }

  const moneySec = section({
    key: 'money',
    title: 'گردش وجه (ریال)',
    columns: [col('date', 'تاریخ', COL.DATE), col('doc', 'سند'), col('debit', 'بدهکار', COL.IRR), col('credit', 'بستانکار', COL.IRR), col('balance', 'مانده', COL.IRR, { sum: false })],
    rows: [
      { date: null, doc: 'مانده ابتدای بازه', debit: null, credit: null, balance: money.opening },
      ...money.rows.map((r) => ({ date: r.date, doc: resolve(r.transactionId).label, debit: r.debit, credit: r.credit, balance: r.balance })),
    ],
  });
  if (moneySec.totals) moneySec.totals.balance = money.closing;

  const sections = [gramsSec, moneySec];
  const hasGold = gold.rows.length > 0 || Math.abs(gold.opening) >= GRAM_EPS || Math.abs(gold.closing) >= GRAM_EPS;
  if (hasGold) {
    const goldSec = section({
      key: 'gold',
      title: 'گردش طلا',
      columns: [
        col('date', 'تاریخ', COL.DATE),
        col('doc', 'سند'),
        col('karat', 'عیار', COL.KARAT),
        col('outGrams', 'تحویل به طرف حساب', COL.GRAMS),
        col('inGrams', 'دریافت از طرف حساب', COL.GRAMS),
        col('balance', 'مانده', COL.GRAMS, { sum: false }),
      ],
      rows: [
        { date: null, doc: 'مانده ابتدای بازه', karat: null, outGrams: null, inGrams: null, balance: gold.opening },
        ...gold.rows.map((r) => ({
          date: r.date,
          doc: resolve(r.transactionId).label,
          karat: r.karat,
          outGrams: r.direction === 'OUT' ? r.weightGrams : 0,
          inGrams: r.direction === 'IN' ? r.weightGrams : 0,
          balance: r.balance,
        })),
      ],
    });
    if (goldSec.totals) goldSec.totals.balance = gold.closing;
    sections.push(goldSec);
  }

  const debit = money.rows.reduce((s, r) => s + num(r.debit), 0);
  const credit = money.rows.reduce((s, r) => s + num(r.credit), 0);
  const notes = [
    'گردش اصلی گرم ۷۵۰ است؛ مانده با واژه‌ی «بد» (طرف به ما بدهکار) یا «بس» (ما به طرف بدهکاریم) آمده است.',
    kind === 'customer'
      ? 'در گردش ریالی، مانده‌ی مثبت یعنی مشتری به ما بدهکار است؛ منفی یعنی بستانکار (پیش‌دریافت).'
      : 'در گردش ریالی، مانده‌ی مثبت یعنی ما به تأمین‌کننده بدهکاریم؛ منفی یعنی پیش‌پرداخت داده‌ایم.',
  ];
  if (money.skipped || grams.skipped || gold.skipped) notes.push('برخی رکوردها تاریخ نامعتبر دارند و در بازه نمایش داده نشدند.');
  return {
    key,
    title: `${baseTitle} — ${party?.name || '—'}${party?.code ? ` (${party.code})` : ''}`,
    rangeLabel: describeRange(range),
    summary: [
      summaryItem(`مانده پایان (گرم ۷۵۰ — ${sideWord(grams.closing)})`, Math.abs(grams.closing), COL.GRAMS, balanceSideOf(kind, grams.closing) === 'credit' ? 'danger' : balanceSideOf(kind, grams.closing) === 'debit' ? 'success' : ''),
      summaryItem('مانده ابتدا (گرم ۷۵۰)', Math.abs(grams.opening), COL.GRAMS),
      summaryItem('مانده ابتدا', money.opening, COL.IRR),
      summaryItem('بدهکار', debit, COL.IRR),
      summaryItem('بستانکار', credit, COL.IRR),
      summaryItem(`مانده پایان (${cfg.statusOf(money.closing)})`, money.closing, COL.IRR, money.closing > IRR_EPS ? 'danger' : ''),
      ...(hasGold ? [summaryItem('مانده طلا', gold.closing, COL.GRAMS)] : []),
    ],
    sections,
    notes,
  };
}

export const customerStatementReport = (range, params) => partyStatementReport('customer', range, params);
export const supplierStatementReport = (range, params) => partyStatementReport('supplier', range, params);
