// docSheet.js — مدل «برگه‌ی سند طلایی» (A5) — Phase 18
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل **فقط‌خواندنی** است و هیچ محاسبه‌ی مالی تازه‌ای ندارد: اعداد را از
// services/goldAccount.js می‌گیرد (که خودش روی services/goldEquivalent.js
// سوار است) و فقط آن‌ها را به شکل ردیف‌های برگه می‌چیند. دلیل این جداسازی
// همان قاعده‌ی همیشگی پروژه است: اگر برگه فرمول خودش را داشت، عددی که چاپ
// می‌شود می‌توانست با عددی که در برنامه دیده می‌شود فرق کند.
//
// خروجی این فایل یک شیء ساده (JSON-able) است، پس هم UI می‌تواند رندرش کند و
// هم تست می‌تواند مستقیماً عددهایش را بسنجد، بدون DOM.
// ═══════════════════════════════════════════════════════════════════════════

import { get, getAll } from '../db/repo.js';
import { formatJalaliDate, toDate } from '../utils/date.js';
import { sheetRateOf } from './goldEquivalent.js';
import { unitsOf, karatMilleOf } from './units.js';
import {
  docGoldRows,
  goldBalanceBefore,
  embeddedSettlementsOf,
  settlementBatchOf,
  sideOf,
  roundSheet2,
  KIND_LABELS,
} from './goldAccount.js';

const SETTINGS_ID = 'main';

/** یک مثقال = ۴٫۶۰۸ گرم (واحد رایج بازار طلای ایران). */
export const MESGHAL_GRAMS = 4.608;

/** پیش‌فرض‌های سربرگ برگه — قابل تغییر در تنظیمات، بدون تغییر Schema. */
export const SHEET_DEFAULTS = {
  sheetInvocation: 'هوالرزاق',
  sheetTitle: 'طلا و جواهرات',
  sheetIssuer: 'مدیر',
  sheetTerms:
    'کلیه طلاجات فوق الذکر را بصورت امانت اینجانب ………………………… تحویل گرفته ام و در تاریخ ………………………… ' +
    'شرعا و قانونا متعهد و ملزم می باشم که کلیه طلاجات امانی را عندالمطالبه به امانت دهنده ………………………… عودت ' +
    'نمایم و تسویه حساب و پرداخت طلاجات از طریق اخذ رسید از امانت دهنده مورد پذیرش است',
};

/** برچسب گوشه‌ی برگه — همان واژه‌ی نمونه («دریافتی»). */
export function sheetTypeLabel(kind, doc = {}) {
  if (kind === 'sale') return 'فروش';
  if (kind === 'purchase') return 'دریافتی';
  if (kind === 'saleReturn') return 'برگشتی';
  return doc.partyType === 'customer' ? 'دریافتی' : 'پرداختی';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** «۱۴۰۵/۰۶/۲۴ ۱۷:۴۴:۱۵» — مهر زمان پایین برگه. */
export function stampOf(value) {
  const dt = toDate(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${formatJalaliDate(dt)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

/** روز هفته‌ی شمسی به یک حرف — نمونه کنار تاریخ «س» دارد (سه‌شنبه). */
export function weekdayLetter(value) {
  const letters = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش']; // یکشنبه..شنبه
  return letters[toDate(value).getDay()];
}

async function loadDoc(kind, id) {
  if (kind === 'sale') return { doc: await get('sales', id), store: 'sales' };
  if (kind === 'purchase') return { doc: await get('purchases', id), store: 'purchases' };
  if (kind === 'saleReturn') return { doc: await get('saleReturns', id), store: 'saleReturns' };
  const receipt = await get('receipts', id);
  if (receipt) return { doc: receipt, store: 'receipts' };
  return { doc: await get('payments', id), store: 'payments' };
}

function partyOf(kind, doc) {
  if (kind === 'sale' || kind === 'saleReturn') return { type: 'customer', id: doc.customerId };
  if (kind === 'purchase') return { type: 'supplier', id: doc.supplierId };
  return { type: doc.partyType, id: doc.partyId };
}

/**
 * ساخت کامل مدل برگه.
 *
 * @param {object} args `{kind, id, rateOverride}`
 *   `rateOverride`: فیِ دستیِ همان برگه (ریال هر گرم عیار پایه). فقط برای
 *   اسنادی لازم است که هیچ نرخی در خودشان ندارند (مثلاً تسویه‌ی کاملاً نقدی
 *   که پیش از Phase 18 ثبت شده و فیلد «فی» نداشته است).
 * @returns {Promise<object>} مدل برگه
 */
export async function buildDocSheet({ kind, id, rateOverride = 0 } = {}) {
  const { doc } = await loadDoc(kind, id);
  if (!doc) throw new Error('سند مورد نظر برای چاپ یافت نشد.');

  const party = partyOf(kind, doc);
  const [settingsRow, products, accounts, partyRecord] = await Promise.all([
    get('settings', SETTINGS_ID),
    getAll('products'),
    getAll('accounts'),
    party.id ? get(party.type === 'customer' ? 'customers' : 'suppliers', party.id) : Promise.resolve(null),
  ]);

  const settings = { ...SHEET_DEFAULTS, ...(settingsRow || {}) };
  const productNames = new Map(products.map((p) => [p.id, p.name]));
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));

  // Phase 22: پروفایل واحد خودِ سند — برگه‌ی سند قدیمی بیت‌به‌بیت همان می‌ماند.
  const units = unitsOf(doc);
  const baseKarat = units.baseKarat;
  const rate = sheetRateOf(doc, { override: rateOverride, units });

  const embeddedSettlements =
    kind === 'sale' || kind === 'purchase' ? await embeddedSettlementsOf(doc, party.type) : [];
  const settlementDocs = kind === 'settlement' ? await settlementBatchOf(doc, party.type) : null;

  const { rows, summary, netGrams, needsRate } = docGoldRows(doc, kind, {
    rate,
    units,
    productNames,
    accountNames,
    embeddedSettlements,
    settlementDocs,
  });

  const before = party.id
    ? await goldBalanceBefore(party.type, party.id, doc)
    : { grams: 0, signed: 0, side: 'zero', incomplete: false, missingRateDocs: [] };

  const finalSigned = roundSheet2(before.signed + netGrams);

  // نرخ‌های مرجع پایین برگه — از همان فیِ سند مشتق می‌شوند، نه از نرخ امروز،
  // تا برگه‌ی یک سند قدیمی با گذشت زمان عوض نشود.
  const rate17 = rate > 0 ? Math.round((rate * 17) / 18) : 0;
  const footerRates = {
    oneGramNoWage: rate > 0 ? rate : null,
    mesghal17: rate17 > 0 ? Math.round(rate17 * MESGHAL_GRAMS) : null,
    // انس جهانی در این نسخه در سیستم ثبت نمی‌شود — عمداً حدس زده نمی‌شود.
    ounce: null,
  };

  return {
    kind,
    kindLabel: KIND_LABELS[kind] || kind,
    typeLabel: sheetTypeLabel(kind, doc),
    docId: doc.id,
    number: doc.number || '',
    date: doc.date,
    dateJalali: formatJalaliDate(toDate(doc.date)),
    weekday: weekdayLetter(doc.date),
    stamp: stampOf(doc.createdAt || doc.date),
    voided: doc.status === 'voided',
    party: {
      type: party.type,
      id: party.id,
      name: partyRecord?.name || doc.customerNameSnapshot || doc.supplierNameSnapshot || doc.partyNameSnapshot || '',
      code: partyRecord?.code || '',
    },
    baseKarat,
    baseMille: karatMilleOf(baseKarat, units),
    /** تعداد اعشار نمایش گرم روی این برگه (سند قدیمی ۲، سند جدید ۳). */
    decimals: units.decimals,
    ratePerGram: rate,
    rateFromOverride: num(rateOverride) > 0,
    needsRate,
    rows,
    summary,
    docBalance: { grams: Math.abs(netGrams), signed: netGrams, side: sideOf(netGrams) },
    previousBalance: {
      grams: before.grams,
      signed: before.signed,
      side: before.side,
      incomplete: Boolean(before.incomplete),
      missingRateDocs: before.missingRateDocs || [],
    },
    finalBalance: {
      grams: Math.abs(finalSigned),
      signed: finalSigned,
      side: sideOf(finalSigned),
      incomplete: Boolean(before.incomplete) || needsRate,
    },
    footerRates,
    header: {
      invocation: settings.sheetInvocation || SHEET_DEFAULTS.sheetInvocation,
      title: settings.sheetTitle || SHEET_DEFAULTS.sheetTitle,
      issuer: settings.sheetIssuer || SHEET_DEFAULTS.sheetIssuer,
      terms: settings.sheetTerms || SHEET_DEFAULTS.sheetTerms,
    },
  };
}
