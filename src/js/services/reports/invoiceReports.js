// invoiceReports.js — موتور مشترک گزارش‌های فروش و خرید (Phase 14)
//
// ═══════════════════════════════════════════════════════════════════════════
// همان الگوی Phase 5 («تفاوت‌ها داده باشند، نه کد»): گزارش فروش و خرید هفت نمای
// یکسان دارند (روز، ماه، طرف حساب، کالا، نوع طلا، وزن، مبلغ). تفاوت‌شان فقط در
// پیکربندی است: کدام Store، کدام طرف حساب، کدام اجزای مبلغ، و آیا برگشت دارد.
//
// ─── منبع اعداد ───
// • واحد جمع‌زنی **قلم** سند است (نه جمع‌های سربرگ). جمع اقلام دقیقاً برابر
//   grandTotal است (موتور قیمت Phase 8 این را تضمین می‌کند)، و فقط از روی قلم
//   می‌توان به تفکیک کالا/نوع/عیار رسید. پس همه‌ی نماها از یک مسیر عدد می‌گیرند
//   و جمع «به تفکیک روز» و «به تفکیک کالا» همیشه یکی است.
// • اعداد از **Snapshot سند** می‌آیند (دستور پروژه §۱۱) — تغییر نرخ روز یا نام کالا
//   گزارش گذشته را عوض نمی‌کند (نام فعلی کالا/طرف حساب فقط برچسب است).
// • اسناد باطل‌شده کنار گذاشته می‌شوند؛ اصلاح خرید (ابطال + سند جدید) پس فقط سند
//   جدید را می‌شمارد.
// • برگشت از فروش در **تاریخ خودِ برگشت** اثر می‌گذارد، نه تاریخ فاکتور (سند مستقل
//   با تاریخ خودش است — Phase 7). «خالص» = فروش − برگشت.
// ═══════════════════════════════════════════════════════════════════════════

import { finenessOf } from '../units.js';
import { getAll } from '../../db/repo.js';
import { roundGrams } from '../ledger.js';
import { bucketLabel } from '../inventory.js';
import { GOLD_ACCOUNT_TYPES, GOLD_ACCOUNT_TYPE_LABELS } from '../accounts.js';
import { inRange, jalaliDayKey, jalaliMonthKey, jalaliMonthLabel, describeRange } from '../../utils/dateRange.js';
import { COL, col, num, nz, section, summaryItem, dropEmptyOptional, ratio, share } from './model.js';

/** واژگان نوع تسویه‌ی سند (همان مقادیر `paymentMode`). */
export const PAYMENT_MODE_REPORT_LABELS = { cash: 'نقدی', credit: 'رسیدی', mixed: 'ترکیبی' };

/** اجزای مبلغ قلم که هر دو سند دارند یا ممکن است داشته باشند. */
const AMOUNT_PARTS = {
  goldPriceIRR: { header: 'بهای طلا', lineKey: 'goldPriceIRR' },
  wageIRR: { header: 'اجرت', lineKey: 'wageIRR' },
  meltFeeIRR: { header: 'کارمزد تبدیل', lineKey: 'meltFeeIRR', optional: true },
  profitIRR: { header: 'سود', lineKey: 'profitIRR' },
  discountIRR: { header: 'تخفیف', lineKey: 'discountShareIRR' },
  taxIRR: { header: 'مالیات', lineKey: 'taxIRR' },
};

export const SALES_CONFIG = {
  key: 'sales',
  docStore: 'sales',
  partyField: 'customerId',
  partyStore: 'customers',
  partySnapshot: 'customerNameSnapshot',
  partyLabel: 'مشتری',
  docLabel: 'فاکتور',
  titleNoun: 'فروش',
  parts: ['goldPriceIRR', 'wageIRR', 'meltFeeIRR', 'profitIRR', 'discountIRR', 'taxIRR'],
  hasReturns: true,
  settle: { cash: 'receivedCashIRR', goldValue: 'receivedGoldValueIRR', goldGrams: 'receivedGoldGrams' },
  settleLabels: { cash: 'دریافت نقدی/بانکی', gold: 'دریافت طلا', credit: 'رسیدی (مانده هنگام ثبت)' },
};

export const PURCHASES_CONFIG = {
  key: 'purchases',
  docStore: 'purchases',
  partyField: 'supplierId',
  partyStore: 'suppliers',
  partySnapshot: 'supplierNameSnapshot',
  partyLabel: 'تأمین‌کننده',
  docLabel: 'سند',
  titleNoun: 'خرید',
  // سود و مالیات خرید طبق تصمیم Phase 6 همیشه صفر است؛ ستونشان ساخته نمی‌شود.
  parts: ['goldPriceIRR', 'wageIRR', 'meltFeeIRR'],
  hasReturns: false,
  settle: { cash: 'paidCashIRR', goldValue: 'paidGoldValueIRR', goldGrams: 'paidGoldGrams' },
  settleLabels: { cash: 'پرداخت نقدی/بانکی', gold: 'پرداخت طلا', credit: 'رسیدی (مانده هنگام ثبت)' },
};

// ─────────────────────────── بارگذاری ───────────────────────────

async function loadData(cfg, range) {
  const [docs, parties, products, returns] = await Promise.all([
    getAll(cfg.docStore),
    getAll(cfg.partyStore),
    getAll('products'),
    cfg.hasReturns ? getAll('saleReturns') : Promise.resolve([]),
  ]);
  const docById = new Map(docs.map((d) => [d.id, d]));
  const activeDocs = docs.filter((d) => !d.deletedAt && d.status !== 'voided' && inRange(d.date, range));
  // برگشتِ فاکتورِ باطل‌شده وجود ندارد (Phase 7 ابطال را بلاک می‌کند)؛ شرط دوم فقط احتیاط است.
  const activeReturns = returns.filter((r) => {
    if (r.status === 'voided' || !inRange(r.date, range)) return false;
    const sale = docById.get(r.saleId);
    return sale && sale.status !== 'voided';
  });
  return {
    docs: activeDocs,
    returns: activeReturns,
    docById,
    partyById: new Map(parties.map((p) => [p.id, p])),
    productById: new Map(products.map((p) => [p.id, p])),
  };
}

// ─────────────────────────── انباشتگر ───────────────────────────

function emptyAcc(cfg) {
  const acc = { docIds: new Set(), returnIds: new Set(), weightGrams: 0, totalIRR: 0, returnWeightGrams: 0, returnIRR: 0 };
  for (const p of cfg.parts) acc[p] = 0;
  return acc;
}

function addLine(cfg, acc, doc, line) {
  acc.docIds.add(doc.id);
  acc.weightGrams += num(line.weightGrams);
  acc.totalIRR += num(line.lineTotalIRR);
  for (const p of cfg.parts) acc[p] += num(line[AMOUNT_PARTS[p].lineKey]);
}

function addReturnLine(acc, ret, line) {
  acc.returnIds.add(ret.id);
  acc.returnWeightGrams += num(line.weightGrams);
  acc.returnIRR += num(line.amountIRR);
}

function finalize(cfg, acc, extra = {}) {
  const row = {
    ...extra,
    count: acc.docIds.size,
    weightGrams: roundGrams(acc.weightGrams),
    totalIRR: Math.round(acc.totalIRR),
  };
  for (const p of cfg.parts) row[p] = Math.round(acc[p]);
  if (cfg.hasReturns) {
    row.returnCount = acc.returnIds.size;
    row.returnWeightGrams = roundGrams(acc.returnWeightGrams);
    row.returnIRR = Math.round(acc.returnIRR);
    row.netWeightGrams = roundGrams(acc.weightGrams - acc.returnWeightGrams);
    row.netIRR = Math.round(acc.totalIRR - acc.returnIRR);
  } else {
    row.netWeightGrams = row.weightGrams;
    row.netIRR = row.totalIRR;
  }
  return row;
}

/**
 * گروه‌بندی عمومی: `keyOf(doc, line)` برای اقلام سند و `keyOfReturn(ret, line, sale)`
 * برای اقلام برگشت. `describe(key, sample)` برچسب/ستون‌های توصیفی گروه را می‌سازد.
 */
function groupBy(cfg, data, { keyOf, keyOfReturn = keyOf, describe }) {
  const groups = new Map();
  const touch = (key, sample) => {
    if (!groups.has(key)) groups.set(key, { acc: emptyAcc(cfg), sample });
    return groups.get(key).acc;
  };
  for (const doc of data.docs) {
    for (const line of doc.lines || []) addLine(cfg, touch(keyOf(doc, line), { doc, line }), doc, line);
  }
  for (const ret of data.returns) {
    const sale = data.docById.get(ret.saleId);
    for (const line of ret.lines || []) {
      addReturnLine(touch(keyOfReturn(ret, line, sale), { doc: sale, line, ret }), ret, line);
    }
  }
  return [...groups.entries()].map(([key, g]) => finalize(cfg, g.acc, { key, ...describe(key, g.sample) }));
}

// ─────────────────────────── ستون‌ها و جمع ───────────────────────────

function metricColumns(cfg) {
  const cols = [col('count', `تعداد ${cfg.docLabel}`, COL.COUNT), col('weightGrams', 'وزن', COL.GRAMS)];
  for (const p of cfg.parts) {
    cols.push(col(p, AMOUNT_PARTS[p].header, COL.IRR, AMOUNT_PARTS[p].optional ? { optional: true } : {}));
  }
  cols.push(col('totalIRR', `مبلغ ${cfg.titleNoun}`, COL.IRR));
  if (cfg.hasReturns) {
    cols.push(col('returnWeightGrams', 'وزن برگشتی', COL.GRAMS), col('returnIRR', 'مبلغ برگشت', COL.IRR));
    cols.push(col('netWeightGrams', 'وزن خالص', COL.GRAMS), col('netIRR', `${cfg.titleNoun} خالص`, COL.IRR));
  }
  return cols;
}

/** «تعداد سند» در ردیف جمع جمعِ ستون نیست — یک سند چندقلمی در چند گروه کالا شمرده می‌شود. */
function fixDocCount(sec, data) {
  if (sec.totals) sec.totals.count = data.docs.length;
  return sec;
}

function summaryOf(cfg, data, rows) {
  const total = rows.reduce((s, r) => s + r.totalIRR, 0);
  const weight = roundGrams(rows.reduce((s, r) => s + r.weightGrams, 0));
  const items = [summaryItem(`تعداد ${cfg.docLabel}`, data.docs.length, COL.COUNT), summaryItem('وزن', weight, COL.GRAMS)];
  items.push(summaryItem(`مبلغ ${cfg.titleNoun}`, total, COL.IRR));
  if (cfg.hasReturns) {
    const ret = rows.reduce((s, r) => s + r.returnIRR, 0);
    items.push(summaryItem('برگشت', ret, COL.IRR, ret ? 'danger' : ''));
    items.push(summaryItem(`${cfg.titleNoun} خالص`, total - ret, COL.IRR, 'success'));
  }
  return items;
}

function baseReport(cfg, key, title, range, data, sections, notes = []) {
  const allRows = sections[0]?.rows || [];
  return {
    key,
    title,
    rangeLabel: describeRange(range),
    summary: summaryOf(cfg, data, allRows),
    sections,
    notes,
  };
}

function groupedReport(cfg, key, title, range, data, { firstColumns, rows, sort, note = '' }) {
  const sorted = rows.sort(sort);
  const columns = dropEmptyOptional([...firstColumns, ...metricColumns(cfg)], sorted);
  const sec = fixDocCount(section({ key, title, columns, rows: sorted }), data);
  return baseReport(cfg, `${cfg.key}.${key}`, title, range, data, [sec], note ? [note] : []);
}

const byNetDesc = (a, b) => b.netIRR - a.netIRR || String(a.label).localeCompare(String(b.label), 'fa');
const byKey = (a, b) => String(a.key).localeCompare(String(b.key));
const RETURN_DATE_NOTE = 'برگشت از فروش در تاریخ خودِ سند برگشت شمرده می‌شود، نه تاریخ فاکتور.';

// ─────────────────────────── نماها ───────────────────────────

function partyName(cfg, data, doc) {
  const party = data.partyById.get(doc?.[cfg.partyField]);
  return party?.name || doc?.[cfg.partySnapshot] || '—';
}

// Phase 22: قلمِ سند پیش از v10 عیار ۲۴تایی دارد. سند دست نمی‌خورد؛ گروه‌بندی و ستون
// «عیار» با عیار هزاری انجام می‌شود تا فروش قدیمی ۱۸ و جدید ۷۵۰ یک ردیف شوند.
function lineFineness(doc, line) {
  return finenessOf(doc, line?.karat);
}

function productKey(doc, line) {
  return line.productId ? `product:${line.productId}` : `${line.goldType}:${lineFineness(doc, line)}`;
}

export function createInvoiceReports(cfg) {
  const noun = cfg.titleNoun;

  async function byDay(range) {
    const data = await loadData(cfg, range);
    const rows = groupBy(cfg, data, {
      keyOf: (doc) => jalaliDayKey(doc.date),
      keyOfReturn: (ret) => jalaliDayKey(ret.date),
      describe: (key) => ({ label: key }),
    });
    return groupedReport(cfg, 'byDay', `${noun} روزانه`, range, data, {
      firstColumns: [col('label', 'روز')],
      rows,
      sort: byKey,
      note: cfg.hasReturns ? RETURN_DATE_NOTE : '',
    });
  }

  async function byMonth(range) {
    const data = await loadData(cfg, range);
    const rows = groupBy(cfg, data, {
      keyOf: (doc) => jalaliMonthKey(doc.date),
      keyOfReturn: (ret) => jalaliMonthKey(ret.date),
      describe: (key) => ({ label: jalaliMonthLabel(key) }),
    });
    return groupedReport(cfg, 'byMonth', `${noun} ماهانه`, range, data, {
      firstColumns: [col('label', 'ماه')],
      rows,
      sort: byKey,
      note: cfg.hasReturns ? RETURN_DATE_NOTE : '',
    });
  }

  async function byParty(range) {
    const data = await loadData(cfg, range);
    const rows = groupBy(cfg, data, {
      keyOf: (doc) => doc[cfg.partyField],
      keyOfReturn: (ret, line, sale) => sale?.[cfg.partyField] || ret.customerId,
      describe: (key, { doc }) => ({
        label: partyName(cfg, data, doc),
        code: data.partyById.get(key)?.code || '',
      }),
    });
    return groupedReport(cfg, 'byParty', `${noun} به تفکیک ${cfg.partyLabel}`, range, data, {
      firstColumns: [col('label', cfg.partyLabel), col('code', 'کد')],
      rows,
      sort: byNetDesc,
    });
  }

  async function byProduct(range) {
    const data = await loadData(cfg, range);
    const rows = groupBy(cfg, data, {
      keyOf: (doc, line) => productKey(doc, line),
      describe: (key, { doc, line, ret }) => {
        const product = line.productId ? data.productById.get(line.productId) : null;
        return {
          label: line.productId
            ? product ? product.name : 'کالای نامشخص'
            : bucketLabel({ goldType: line.goldType, karat: lineFineness(ret || doc, line) }),
          code: product?.code || '',
          goldTypeLabel: GOLD_ACCOUNT_TYPE_LABELS[line.goldType] || line.goldType || '—',
          karat: lineFineness(ret || doc, line),
        };
      },
    });
    return groupedReport(cfg, 'byProduct', `${noun} به تفکیک کالا`, range, data, {
      firstColumns: [col('label', 'کالا'), col('code', 'کد'), col('goldTypeLabel', 'نوع طلا'), col('karat', 'عیار', COL.KARAT)],
      rows,
      sort: byNetDesc,
      note: 'اقلام بدون کد کالا (آبشده/متفرقه) با «نوع — عیار» گروه‌بندی می‌شوند. «تعداد» در هر ردیف یعنی تعداد اسناد شامل آن کالا.',
    });
  }

  async function byGoldType(range) {
    const data = await loadData(cfg, range);
    const rows = groupBy(cfg, data, {
      keyOf: (doc, line) => line.goldType,
      describe: (key) => ({ label: GOLD_ACCOUNT_TYPE_LABELS[key] || key || '—' }),
    });
    const order = (k) => (GOLD_ACCOUNT_TYPES.indexOf(k) + 99) % 99;
    return groupedReport(cfg, 'byGoldType', `${noun} به تفکیک نوع طلا`, range, data, {
      firstColumns: [col('label', 'نوع طلا')],
      rows,
      sort: (a, b) => order(a.key) - order(b.key),
    });
  }

  async function byWeight(range) {
    const data = await loadData(cfg, range);
    const rows = groupBy(cfg, data, {
      keyOf: (doc, line) => `${line.goldType}:${lineFineness(doc, line)}`,
      describe: (key, { doc, line, ret }) => ({
        label: GOLD_ACCOUNT_TYPE_LABELS[line.goldType] || line.goldType || '—',
        goldType: line.goldType,
        karat: lineFineness(ret || doc, line),
      }),
    }).map((r) => ({ ...r, avgRateIRR: ratio(r.netIRR, r.netWeightGrams), shareOfWeight: 0 }));
    const totalNet = rows.reduce((s, r) => s + r.netWeightGrams, 0);
    for (const r of rows) r.shareOfWeight = share(r.netWeightGrams, totalNet);

    const columns = [
      col('label', 'نوع طلا'),
      col('karat', 'عیار', COL.KARAT),
      col('count', `تعداد ${cfg.docLabel}`, COL.COUNT),
      col('weightGrams', `وزن ${noun}`, COL.GRAMS),
      ...(cfg.hasReturns ? [col('returnWeightGrams', 'وزن برگشتی', COL.GRAMS), col('netWeightGrams', 'وزن خالص', COL.GRAMS)] : []),
      col('shareOfWeight', 'سهم از وزن', COL.PERCENT),
      col('netIRR', cfg.hasReturns ? 'مبلغ خالص' : 'مبلغ', COL.IRR),
      col('avgRateIRR', 'میانگین هر گرم', COL.RATE),
    ];
    const order = (r) => (GOLD_ACCOUNT_TYPES.indexOf(r.goldType) + 99) % 99;
    rows.sort((a, b) => order(a) - order(b) || a.karat - b.karat);
    const sec = fixDocCount(section({ key: 'byWeight', title: `وزن ${noun} به تفکیک نوع و عیار`, columns, rows }), data);
    if (sec.totals) {
      sec.totals.avgRateIRR = ratio(sec.totals.netIRR, sec.totals.netWeightGrams);
      sec.totals.shareOfWeight = rows.length ? 100 : null;
    }
    const notes = ['وزن‌ها وزن واقعی ترازو (گِردشده) هستند و به عیار مبنا تبدیل نشده‌اند؛ جمع وزن عیارهای مختلف فقط نمای کلی است.'];
    if (cfg.hasReturns) notes.push(RETURN_DATE_NOTE);
    return baseReport(cfg, `${cfg.key}.byWeight`, `${noun} به تفکیک وزن`, range, data, [sec], notes);
  }

  async function byAmount(range) {
    const data = await loadData(cfg, range);
    // جمع کل از همان مسیر گروه‌بندی — تک‌گروه «all» — تا با نماهای دیگر یکی بماند.
    const [all] = groupBy(cfg, data, { keyOf: () => 'all', describe: () => ({}) });
    const t = all || finalize(cfg, emptyAcc(cfg));

    // ── ترکیب مبلغ ──
    const compRows = [];
    const subtotal = cfg.parts.filter((p) => p !== 'discountIRR' && p !== 'taxIRR').reduce((s, p) => s + t[p], 0);
    for (const p of cfg.parts) {
      if (p === 'discountIRR' || p === 'taxIRR') continue;
      if (AMOUNT_PARTS[p].optional && !t[p]) continue;
      compRows.push({ label: AMOUNT_PARTS[p].header, amountIRR: t[p] });
    }
    if (cfg.parts.includes('discountIRR')) {
      compRows.push({ label: 'جمع پیش از تخفیف', amountIRR: subtotal, subtotal: true });
      compRows.push({ label: 'تخفیف', amountIRR: nz(-t.discountIRR) });
    }
    if (cfg.parts.includes('taxIRR')) compRows.push({ label: 'مالیات', amountIRR: t.taxIRR });
    // موتور قیمت مبلغ نهایی هر قلم را به واحد تنظیم‌شده گِرد می‌کند (Phase 8)؛ بدون این
    // ردیف، اجزای بالا با جمع نمی‌خواند و کاربر فکر می‌کند گزارش غلط است.
    const rounding = t.totalIRR - (subtotal - num(t.discountIRR) + num(t.taxIRR));
    if (rounding) compRows.push({ label: 'گِردکردن مبلغ', amountIRR: rounding });
    compRows.push({ label: `جمع ${noun}`, amountIRR: t.totalIRR, subtotal: true });
    if (cfg.hasReturns) {
      compRows.push({ label: 'برگشت از فروش', amountIRR: nz(-t.returnIRR) });
      compRows.push({ label: `${noun} خالص`, amountIRR: t.netIRR, subtotal: true });
    }
    for (const r of compRows) r.share = share(r.amountIRR, t.totalIRR);
    const composition = section({
      key: 'composition',
      title: 'ترکیب مبلغ',
      columns: [col('label', 'شرح'), col('amountIRR', 'مبلغ', COL.IRR, { sum: false }), col('share', `سهم از جمع ${noun}`, COL.PERCENT)],
      rows: compRows,
      totals: false,
    });

    // ── ترکیب تسویه هنگام ثبت ──
    const s = cfg.settle;
    const cash = data.docs.reduce((a, d) => a + num(d[s.cash]), 0);
    const goldValue = data.docs.reduce((a, d) => a + num(d[s.goldValue]), 0);
    const goldGrams = roundGrams(data.docs.reduce((a, d) => a + num(d[s.goldGrams]), 0));
    const docTotal = data.docs.reduce((a, d) => a + num(d.grandTotalIRR), 0);
    const credit = docTotal - cash - goldValue;
    const settleRows = [
      { label: cfg.settleLabels.cash, amountIRR: cash, grams: null },
      { label: cfg.settleLabels.gold, amountIRR: goldValue, grams: goldGrams },
      { label: cfg.settleLabels.credit, amountIRR: credit, grams: null },
    ].map((r) => ({ ...r, share: share(r.amountIRR, docTotal) }));
    const settlement = section({
      key: 'settlement',
      title: 'نحوه‌ی تسویه هنگام ثبت',
      columns: [col('label', 'روش'), col('amountIRR', 'مبلغ', COL.IRR), col('grams', 'وزن طلا', COL.GRAMS), col('share', 'سهم', COL.PERCENT, { sum: false })],
      rows: settleRows,
      note: 'تسویه‌های بعدی (دریافت/پرداخت مستقل) در گزارش‌های مالی آمده‌اند؛ مانده‌ی امروز هر طرف حساب در گزارش مطالبات/بدهی است.',
    });

    // ── نوع تسویه ──
    const modes = new Map();
    for (const d of data.docs) {
      const m = modes.get(d.paymentMode) || { key: d.paymentMode, label: PAYMENT_MODE_REPORT_LABELS[d.paymentMode] || d.paymentMode || '—', count: 0, amountIRR: 0 };
      m.count += 1;
      m.amountIRR += num(d.grandTotalIRR);
      modes.set(d.paymentMode, m);
    }
    const modeOrder = ['cash', 'credit', 'mixed'];
    const modeRows = [...modes.values()].sort((a, b) => modeOrder.indexOf(a.key) - modeOrder.indexOf(b.key));
    const byMode = section({
      key: 'byMode',
      title: 'به تفکیک نوع تسویه',
      columns: [col('label', 'نوع تسویه'), col('count', `تعداد ${cfg.docLabel}`, COL.COUNT), col('amountIRR', 'مبلغ', COL.IRR)],
      rows: modeRows,
    });

    const report = {
      key: `${cfg.key}.byAmount`,
      title: `${noun} به تفکیک مبلغ`,
      rangeLabel: describeRange(range),
      summary: summaryOf(cfg, data, all ? [all] : []),
      sections: [composition, settlement, byMode],
      notes: cfg.hasReturns ? [RETURN_DATE_NOTE] : [],
    };
    return report;
  }

  /** دفترچه‌ی داده‌ی خام برای تست‌ها و Phase 15 — همان ورودی همه‌ی نماها. */
  async function rawData(range) {
    return loadData(cfg, range);
  }

  return { byDay, byMonth, byParty, byProduct, byGoldType, byWeight, byAmount, rawData };
}

export const salesReports = createInvoiceReports(SALES_CONFIG);
export const purchaseReports = createInvoiceReports(PURCHASES_CONFIG);
