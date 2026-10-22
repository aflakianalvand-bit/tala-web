// inventoryReports.js — گزارش‌های موجودی طلا (Phase 14)
//
// ═══════════════════════════════════════════════════════════════════════════
// معنای فیلتر تاریخ در گزارش موجودی:
//   • «مانده ابتدا»  = موجودی پایان روزِ پیش از «از»
//   • «ورود/خروج»   = گردش داخل بازه
//   • «مانده پایان» = موجودی در پایان روز «تا» — یعنی «موجودی در تاریخ X»
// همه از `goldLedger` و با goldPeriodMap() در ledger.js — همان فرمول INVENTORY_RULES §۳،
// نه یک محاسبه‌ی موازی. تضمین آزموده‌شده: ابتدا + ورود − خروج = پایان، و بدون بازه،
// پایان = موجودی صفحه‌ی انبار (Phase 10).
//
// Phase 27 (مورد باز ۳۴): عیار هزاری است — دفتر طلا در مهاجرت v10 به عیار هزاری رفت و
// سطل‌ها/کالاها هم — و هر سطل یک ستون «معادل ۷۵۰» دارد (units.equivalent750، همان تابع سندها).
// انبار همچنان با وزن واقعی شمرده می‌شود (INVENTORY_RULES §۱۲.۲)؛ معادل ۷۵۰ فقط نمای مقایسه است.
//
// ارزش‌گذاری: «ارزش دفتری» مانده‌ی ریالی سطل **در همان تاریخ** است (moneyPeriodMap).
// «ارزش روز» با **نرخ جاری** محاسبه می‌شود نه نرخ آن تاریخ — عمداً و با برچسب صریح:
// پرسش کاربر از ارزش روز «الان این طلا چند است» است، و نرخ تاریخی فقط وقتی معنا دارد
// که برای آن روز نرخ ثبت شده باشد (Append-only Phase 8 چنین تضمینی نمی‌دهد).
// ═══════════════════════════════════════════════════════════════════════════

import { getAll } from '../../db/repo.js';
import { equivalent750 } from '../units.js';
import { roundBaseGrams } from '../goldTotals.js';
import { goldPeriodMap, moneyPeriodMap, roundGrams } from '../ledger.js';
import { bucketLabel, inventoryFlow, GOLD_ACCOUNT_TYPES, GOLD_ACCOUNT_TYPE_LABELS, GRAM_EPS } from '../inventory.js';
import { ratePerGramForKarat } from '../pricing.js';
import { getPricingConfig } from '../priceRates.js';
import { entryPhase, describeRange, phaseOf } from '../../utils/dateRange.js';
import { buildDocResolver } from './docRefs.js';
import { COL, col, num, section, summaryItem, share } from './model.js';

const VALUE_NOTE = 'ارزش روز با نرخ جاری ثبت‌شده در تنظیمات محاسبه شده است (نه نرخ تاریخ پایان بازه). ارزش دفتری، بهای ثبت‌شده‌ی همان سطل تا تاریخ پایان است.';
const KARAT_NOTE =
  'وزن‌ها وزن واقعی هستند و عیار هزاری است؛ جمع وزن عیارهای مختلف فقط نمای کلی است. ستون «معادل ۷۵۰» = وزن × عیار ÷ ۷۵۰ ' +
  '(گرد رو به بالا در رقم سوم، همان قاعده‌ی سندها) و جمع آن قابل مقایسه است.';

/** وضعیت همه‌ی سطل‌ها در بازه — ورودی مشترک همه‌ی گزارش‌های موجودی. */
export async function inventoryState(range, { goldType = 'all' } = {}) {
  const phase = entryPhase(range);
  const [gold, money, products, config] = await Promise.all([
    goldPeriodMap('inventory', phase),
    moneyPeriodMap('inventory', phase),
    getAll('products'),
    getPricingConfig(),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));

  const rows = [];
  for (const b of gold.rows.values()) {
    if (goldType !== 'all' && b.goldType !== goldType) continue;
    const touched = [b.opening, b.inGrams, b.outGrams, b.closing].some((v) => Math.abs(v) >= GRAM_EPS);
    if (!touched) continue;
    const product = b.productId ? productById.get(b.productId) || null : null;
    const karat = product ? num(product.karat) : num(b.karat);
    const ratePerGram = ratePerGramForKarat(karat, config);
    rows.push({
      key: b.id,
      label: bucketLabel(b, product),
      code: product?.code || '',
      goldType: b.goldType,
      goldTypeLabel: GOLD_ACCOUNT_TYPE_LABELS[b.goldType] || b.goldType || '—',
      karat,
      openingGrams: b.opening,
      inGrams: b.inGrams,
      outGrams: b.outGrams,
      closingGrams: b.closing,
      closing750: equivalent750(b.closing, karat),
      ratePerGram,
      marketValueIRR: Math.round(b.closing * ratePerGram),
      bookValueIRR: Math.round(money.rows.get(b.id)?.closing || 0),
    });
  }
  const order = (t) => (GOLD_ACCOUNT_TYPES.indexOf(t) + 99) % 99;
  rows.sort((a, b) => order(a.goldType) - order(b.goldType) || a.karat - b.karat || String(a.label).localeCompare(String(b.label), 'fa'));
  return { rows, skipped: gold.skipped + money.skipped };
}

const QTY_COLUMNS = [
  col('openingGrams', 'مانده ابتدا', COL.GRAMS),
  col('inGrams', 'ورود', COL.GRAMS),
  col('outGrams', 'خروج', COL.GRAMS),
  col('closingGrams', 'مانده پایان', COL.GRAMS),
  col('closing750', 'مانده پایان (معادل ۷۵۰)', COL.GRAMS),
];
const VALUE_COLUMNS = [
  col('marketValueIRR', 'ارزش روز', COL.IRR),
  col('bookValueIRR', 'ارزش دفتری', COL.IRR),
];

function stockSummary(rows) {
  const closing = roundGrams(rows.reduce((s, r) => s + r.closingGrams, 0));
  const inGrams = roundGrams(rows.reduce((s, r) => s + r.inGrams, 0));
  const outGrams = roundGrams(rows.reduce((s, r) => s + r.outGrams, 0));
  const closing750 = roundBaseGrams(rows.reduce((s, r) => s + r.closing750, 0));
  return [
    summaryItem('موجودی پایان', closing, COL.GRAMS, closing < -GRAM_EPS ? 'danger' : ''),
    summaryItem('موجودی پایان (معادل ۷۵۰)', closing750, COL.GRAMS),
    summaryItem('ورود دوره', inGrams, COL.GRAMS),
    summaryItem('خروج دوره', outGrams, COL.GRAMS),
    summaryItem('ارزش روز', rows.reduce((s, r) => s + r.marketValueIRR, 0), COL.IRR),
    summaryItem('ارزش دفتری', rows.reduce((s, r) => s + r.bookValueIRR, 0), COL.IRR),
  ];
}

function skippedNote(skipped) {
  return skipped ? [`${skipped} رکورد دفتر تاریخ نامعتبر دارد و در هیچ دوره‌ای شمرده نشد؛ فقط در «همه‌ی تاریخ‌ها» دیده می‌شود.`] : [];
}

function aggregate(rows, keyOf, describe) {
  const map = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    const acc = map.get(key) || { key, ...describe(r), buckets: 0, openingGrams: 0, inGrams: 0, outGrams: 0, closingGrams: 0, closing750: 0, marketValueIRR: 0, bookValueIRR: 0 };
    acc.buckets += 1;
    for (const k of ['openingGrams', 'inGrams', 'outGrams', 'closingGrams', 'closing750']) acc[k] = roundGrams(acc[k] + r[k]);
    acc.marketValueIRR += r.marketValueIRR;
    acc.bookValueIRR += r.bookValueIRR;
    map.set(key, acc);
  }
  return [...map.values()];
}

// ─────────────────────────── گزارش‌ها ───────────────────────────

export async function inventoryTotalReport(range) {
  const { rows, skipped } = await inventoryState(range);
  const columns = [col('label', 'سطل / کالا'), col('goldTypeLabel', 'نوع'), col('karat', 'عیار (هزاری)', COL.KARAT), ...QTY_COLUMNS, ...VALUE_COLUMNS];
  return {
    key: 'inventory.total',
    title: 'موجودی کل',
    rangeLabel: describeRange(range),
    summary: stockSummary(rows),
    sections: [section({ key: 'buckets', title: 'موجودی به تفکیک سطل', columns, rows, emptyTitle: 'در این بازه موجودی یا گردشی نیست' })],
    notes: [VALUE_NOTE, KARAT_NOTE, ...skippedNote(skipped)],
  };
}

export async function inventoryByTypeReport(range) {
  const { rows, skipped } = await inventoryState(range);
  const agg = aggregate(rows, (r) => r.goldType, (r) => ({ label: r.goldTypeLabel, goldType: r.goldType }));
  // هر سه نوع همیشه نمایش داده می‌شوند (داشبورد و انبار هم همین‌طورند) — «صفر» هم اطلاعات است.
  const typeRows = GOLD_ACCOUNT_TYPES.map(
    (t) => agg.find((a) => a.goldType === t) || { key: t, label: GOLD_ACCOUNT_TYPE_LABELS[t], goldType: t, buckets: 0, openingGrams: 0, inGrams: 0, outGrams: 0, closingGrams: 0, closing750: 0, marketValueIRR: 0, bookValueIRR: 0 }
  );
  const extra = agg.filter((a) => !GOLD_ACCOUNT_TYPES.includes(a.goldType));
  const all = [...typeRows, ...extra];
  const totalClosing = all.reduce((s, r) => s + r.closingGrams, 0);
  for (const r of all) r.share = share(r.closingGrams, totalClosing);
  const columns = [col('label', 'نوع طلا'), col('buckets', 'تعداد سطل', COL.COUNT), ...QTY_COLUMNS, col('share', 'سهم از موجودی', COL.PERCENT, { sum: false }), ...VALUE_COLUMNS];
  return {
    key: 'inventory.byType',
    title: 'موجودی به تفکیک نوع طلا',
    rangeLabel: describeRange(range),
    summary: stockSummary(rows),
    sections: [section({ key: 'byType', title: 'ساخته‌شده / آبشده / متفرقه', columns, rows: all })],
    notes: [VALUE_NOTE, ...skippedNote(skipped)],
  };
}

export async function inventoryByKaratReport(range) {
  const { rows, skipped } = await inventoryState(range);
  const agg = aggregate(rows, (r) => r.karat, (r) => ({ karat: r.karat, label: `عیار ${r.karat}` })).sort((a, b) => a.karat - b.karat);
  const columns = [col('label', 'عیار'), col('buckets', 'تعداد سطل', COL.COUNT), ...QTY_COLUMNS, ...VALUE_COLUMNS];

  // جزئیات: عیار × نوع
  const detail = aggregate(
    rows,
    (r) => `${r.karat}|${r.goldType}`,
    (r) => ({ karat: r.karat, goldType: r.goldType, label: `عیار ${r.karat}`, goldTypeLabel: r.goldTypeLabel })
  ).sort((a, b) => a.karat - b.karat || GOLD_ACCOUNT_TYPES.indexOf(a.goldType) - GOLD_ACCOUNT_TYPES.indexOf(b.goldType));

  return {
    key: 'inventory.byKarat',
    title: 'موجودی به تفکیک عیار',
    rangeLabel: describeRange(range),
    summary: stockSummary(rows),
    sections: [
      section({ key: 'byKarat', title: 'به تفکیک عیار', columns, rows: agg }),
      section({
        key: 'byKaratType',
        title: 'عیار × نوع طلا',
        columns: [col('label', 'عیار'), col('goldTypeLabel', 'نوع'), ...QTY_COLUMNS, ...VALUE_COLUMNS],
        rows: detail,
      }),
    ],
    notes: [KARAT_NOTE, VALUE_NOTE, ...skippedNote(skipped)],
  };
}

/**
 * گردش موجودی: فرمول Phase 10 در بازه + گردش هر نوع + فهرست کامل ورود و خروج.
 * پارامتر اختیاری `goldType`.
 */
export async function inventoryFlowReport(range, { goldType = 'all' } = {}) {
  const [flow, state, entries, resolve, products] = await Promise.all([
    inventoryFlow({ goldType, range }),
    inventoryState(range, { goldType }),
    getAll('goldLedger'),
    buildDocResolver(),
    getAll('products'),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));

  // ── ۱) فرمول ──
  const formulaRows = [{ label: 'مانده ابتدای بازه', inGrams: null, outGrams: null, netGrams: flow.openingCarried, strong: true }];
  for (const step of flow.steps) {
    if (!step.count && step.key !== 'purchase' && step.key !== 'sale') continue;
    formulaRows.push({ label: step.label, inGrams: step.inGrams, outGrams: step.outGrams, netGrams: step.netGrams, count: step.count });
  }
  formulaRows.push({ label: 'مانده پایان بازه', inGrams: null, outGrams: null, netGrams: flow.closing, strong: true });
  const formula = section({
    key: 'formula',
    title: 'فرمول موجودی در بازه',
    columns: [col('label', 'جزء'), col('count', 'تعداد رکورد', COL.COUNT, { sum: false }), col('inGrams', 'ورود', COL.GRAMS, { sum: false }), col('outGrams', 'خروج', COL.GRAMS, { sum: false }), col('netGrams', 'اثر خالص', COL.GRAMS, { sum: false })],
    rows: formulaRows,
    totals: false,
    note: 'مانده ابتدا + جمع اثر خالص اجزا = مانده پایان. ابطال یک سند در همان ردیفِ سند و در تاریخ ابطال دیده می‌شود.',
  });

  // ── ۲) به تفکیک نوع ──
  const byType = section({
    key: 'flowByType',
    title: 'گردش به تفکیک نوع طلا',
    columns: [col('label', 'نوع طلا'), ...QTY_COLUMNS],
    rows: aggregate(state.rows, (r) => r.goldType, (r) => ({ label: r.goldTypeLabel })),
  });

  // ── ۳) فهرست ورود و خروج ──
  const moveRows = entries
    .filter((e) => e?.accountRef?.kind === 'inventory')
    .filter((e) => goldType === 'all' || e.goldType === goldType)
    .filter((e) => phaseOf(e.date, range) === 'in')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id)))
    .map((e) => {
      const w = num(e.weightGrams);
      const product = e.productId ? productById.get(e.productId) : null;
      return {
        date: e.date,
        doc: resolve(e.transactionId).label,
        bucket: bucketLabel({ goldType: e.goldType, karat: e.karat }, product),
        karat: num(e.karat),
        inGrams: e.direction === 'IN' ? w : 0,
        outGrams: e.direction === 'OUT' ? w : 0,
        // معادل ۷۵۰ هر رکورد، علامت‌دار (ورود +، خروج −) تا جمع ستون خالص گردش باشد.
        net750: (e.direction === 'IN' ? 1 : -1) * equivalent750(w, num(e.karat)) || 0,
      };
    });
  const moves = section({
    key: 'moves',
    title: 'ریز ورود و خروج',
    columns: [col('date', 'تاریخ', COL.DATE), col('doc', 'سند'), col('bucket', 'سطل / کالا'), col('karat', 'عیار (هزاری)', COL.KARAT), col('inGrams', 'ورود', COL.GRAMS), col('outGrams', 'خروج', COL.GRAMS), col('net750', 'خالص (معادل ۷۵۰)', COL.GRAMS)],
    rows: moveRows,
  });

  const inTotal = roundGrams(moveRows.reduce((s, r) => s + r.inGrams, 0));
  const outTotal = roundGrams(moveRows.reduce((s, r) => s + r.outGrams, 0));
  return {
    key: 'inventory.flow',
    title: 'گردش موجودی',
    rangeLabel: describeRange(range),
    summary: [
      summaryItem('مانده ابتدا', flow.openingCarried, COL.GRAMS),
      summaryItem('ورود', inTotal, COL.GRAMS, 'success'),
      summaryItem('خروج', outTotal, COL.GRAMS, 'danger'),
      summaryItem('مانده پایان', flow.closing, COL.GRAMS),
      summaryItem('تعداد رکورد', moveRows.length, COL.COUNT),
    ],
    sections: [formula, byType, moves],
    notes: skippedNote(state.skipped),
  };
}
