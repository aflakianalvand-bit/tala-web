// model.js — شکل مشترک خروجی همه‌ی گزارش‌ها (Phase 14)
//
// ═══════════════════════════════════════════════════════════════════════════
// هر گزارش یک **داده‌ی جدولی خالص** برمی‌گرداند، نه HTML:
//
//   { key, title, rangeLabel, summary:[{label, value, kind, variant}],
//     sections:[{ key, title, columns:[{key, header, kind}], rows, totals, note }],
//     notes:[string], needsParam }
//
// چرا: (۱) صفحه‌ی گزارش یک رندرکننده‌ی عمومی دارد، نه ۲۰ صفحه‌ی دست‌ساز؛
// (۲) تست‌ها اعداد را مستقیماً از همین ساختار بررسی می‌کنند، نه از متن DOM؛
// (۳) خروجی Excel در Phase 15 فقط همین `columns/rows/totals` را می‌نویسد — بدون
// محاسبه‌ی دوباره. `kind` ستون هم به فرمت نمایش می‌گوید و هم به نوع سلول Excel.
// ═══════════════════════════════════════════════════════════════════════════

import { roundGrams } from '../ledger.js';

/** نوع ستون‌ها — هم قالب نمایش و هم نوع سلول در خروجی Phase 15. */
export const COL = {
  TEXT: 'text',
  DATE: 'date', // مقدار: رشته‌ی ISO؛ نمایش: تاریخ شمسی
  IRR: 'irr',
  GRAMS: 'grams',
  COUNT: 'count',
  KARAT: 'karat',
  RATE: 'rate', // ریال به ازای گرم
  PERCENT: 'percent',
};

const SUMMABLE = new Set([COL.IRR, COL.GRAMS, COL.COUNT]);

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** صفر منفی ⇒ صفر (همان دلیل normalizeZero در ledger.js: «-۰» در نمایش و JSON). */
export function nz(n) {
  return n === 0 ? 0 : n;
}

export function col(key, header, kind = COL.TEXT, extra = {}) {
  return { key, header, kind, ...extra };
}

/**
 * ردیف جمع یک جدول: ستون‌های ریالی/وزنی/شمارشی جمع زده می‌شوند (وزن با دقت سوت)،
 * ستون `sum:false` جمع نمی‌خورد، و اولین ستون متنی برچسب «جمع» می‌گیرد.
 */
export function totalsRow(columns, rows, label = 'جمع') {
  const totals = {};
  let labelled = false;
  for (const c of columns) {
    if (SUMMABLE.has(c.kind) && c.sum !== false) {
      const total = rows.reduce((s, r) => s + num(r[c.key]), 0);
      totals[c.key] = nz(c.kind === COL.GRAMS ? roundGrams(total) : Math.round(total));
    } else if (!labelled && (c.kind === COL.TEXT || c.kind === COL.DATE)) {
      totals[c.key] = label;
      labelled = true;
    } else {
      totals[c.key] = null;
    }
  }
  return totals;
}

export function section({ key, title, columns, rows, totals = true, note = '', emptyTitle = 'موردی در این بازه نیست' }) {
  return {
    key,
    title,
    columns,
    rows,
    totals: totals === true ? (rows.length ? totalsRow(columns, rows) : null) : totals || null,
    note,
    emptyTitle,
  };
}

export function summaryItem(label, value, kind = COL.IRR, variant = '') {
  return { label, value, kind, variant };
}

/** ستون‌هایی که در کل گزارش صفر هستند و `optional` علامت خورده‌اند حذف می‌شوند (مثلاً کارمزد تبدیل). */
export function dropEmptyOptional(columns, rows) {
  return columns.filter((c) => !c.optional || rows.some((r) => Math.abs(num(r[c.key])) > 0));
}

/** نسبت امن (مثلاً نرخ میانگین هر گرم) — تقسیم بر صفر ⇒ null. */
export function ratio(a, b) {
  const den = num(b);
  if (Math.abs(den) < 0.0005) return null;
  return nz(Math.round(num(a) / den));
}

/** سهم درصدی با یک رقم اعشار. */
export function share(part, whole) {
  const w = num(whole);
  if (Math.abs(w) < 0.5) return null;
  return nz(Math.round((num(part) / w) * 1000) / 10);
}

/** گزارشی که پیش از اجرا یک انتخاب (مثلاً مشتری) لازم دارد. */
export function needsParamReport({ key, title, rangeLabel, message }) {
  return { key, title, rangeLabel, summary: [], sections: [], notes: [message], needsParam: true };
}
