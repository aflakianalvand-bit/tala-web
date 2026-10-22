// partyLabels.js — برچسب‌های فارسی و کمک‌توابع نمایش، مشترک بین مشتری و تأمین‌کننده
// (جایگزین customerLabels.js از Phase 4 — همان محتوا، اما نوع‌آگاه)
import { balanceSideOf, SIDE_WORDS } from '../../services/ledgerSummary.js';
import { formatRial, formatGrams, formatBaseGrams } from '../../utils/format.js';
import { formatJalaliDate } from '../../utils/date.js';

export const FIELD_LABELS = {
  code: 'کد',
  name: 'نام',
  phone: 'موبایل',
  notes: 'توضیحات',
  active: 'وضعیت',
  deletedAt: 'حذف نرم',
};

/** دلایل رکوردهای Money Ledger به فارسی (DATABASE_SCHEMA §3.10). */
export const MONEY_REASON_LABELS = {
  receive: 'دریافت',
  pay: 'پرداخت',
  sale: 'فروش',
  purchase: 'خرید',
  transfer: 'انتقال',
  settlement: 'تسویه',
};

/** دلایل رکوردهای Gold Ledger به فارسی (DATABASE_SCHEMA §3.9). */
export const GOLD_REASON_LABELS = {
  purchase: 'خرید',
  sale: 'فروش',
  sale_return: 'برگشت از فروش',
  gold_in: 'ورود طلا',
  gold_out: 'خروج طلا',
  melt: 'ذوب',
  adjustment: 'اصلاح',
  receipt_gold: 'دریافت طلا',
  payment_gold: 'پرداخت طلا',
};

export const DOC_STATUS_LABELS = {
  open: 'باز',
  settled: 'تسویه‌شده',
  voided: 'باطل‌شده',
};

export const DOC_STATUS_VARIANT = {
  open: 'warning',
  settled: 'success',
  voided: 'danger',
};

/**
 * نمای ذخیره‌شده‌ی `dueDates.status` (pending/partial/paid/voided).
 * (Phase 12) برای نمایش وضعیت زمانی از DUE_STATE_LABELS در pages/docs/docLabels.js استفاده کنید؛
 * این نگاشت فقط برای نمایش خامِ فیلد ذخیره‌شده (مثلاً در تاریخچه) نگهداری می‌شود.
 */
export const DUE_STATUS_LABELS = {
  pending: 'در انتظار',
  partial: 'تسویه جزئی',
  paid: 'تسویه‌شده',
  overdue: 'سررسید گذشته',
};

export const PAY_METHOD_LABELS = {
  cash: 'وجه نقد',
  gold: 'طلا',
  // (Phase 11) خط «تخفیف تسویه»: بدهی را می‌بندد بدون آنکه پولی جابه‌جا شود.
  discount: 'تخفیف تسویه',
};

/** (Phase 11) وضعیت سررسید — `overdue` در Phase 12 محاسبه می‌شود، ذخیره نمی‌شود. */
export const DUE_STATUS_VARIANT = {
  pending: 'warning',
  partial: 'warning',
  paid: 'success',
  overdue: 'danger',
  voided: 'neutral',
};

export function partyStatusBadge(party) {
  if (party.deletedAt) return { label: 'حذف‌شده', variant: 'danger' };
  if (!party.active) return { label: 'غیرفعال', variant: 'warning' };
  return { label: 'فعال', variant: 'success' };
}

// ══════════════════════════════════════════════════════════════════════════
// تفسیر مانده — «بد» / «بس» (Phase 26؛ UI_GUIDELINES §6.10، ACCOUNTING_RULES §12.5)
//
// جهت از سرویس می‌آید (`balanceSideOf` روی BALANCE_SIGN و قرارداد علامت §10.1):
//   debit  ⇒ طرف به ما بدهکار است  ⇒ «بد» سبز  (طلب ما)
//   credit ⇒ ما به طرف بدهکاریم    ⇒ «بس» قرمز (بدهی ما)
//   zero   ⇒ «تسویه» خاکستری
// واژه‌ها برای مشتری و تأمین‌کننده یکی‌اند (همان واژه‌های برگه‌ی A5). نسبت به Phase 5
// رنگ مشتری وارونه شد (تصمیم Phase 21، بند «هـ»)؛ تأمین‌کننده مثل قبل است.
// رنگ هرگز تنها نمی‌آید: `text` همیشه کنار عدد نوشته می‌شود.
// قاعده: عدد منفی خام هرگز به کاربر نشان داده نمی‌شود (UI_GUIDELINES §6.1).
// ══════════════════════════════════════════════════════════════════════════

export const BALANCE_WORDS = Object.freeze({
  debit: Object.freeze({ text: SIDE_WORDS.debit, variant: 'success', sign: 1 }),
  credit: Object.freeze({ text: SIDE_WORDS.credit, variant: 'danger', sign: -1 }),
  zero: Object.freeze({ text: SIDE_WORDS.zero, variant: 'neutral', sign: 0 }),
});

/** برچسب نوع شخص در فهرست مشترک معین. */
export const PARTY_KIND_LABELS = { customer: 'مشتری', supplier: 'تأمین‌کننده' };

/** برچسب وضعیت شخص در ردیف معین (فقط غیرفعال/حذف‌شده؛ فعال برچسب ندارد). */
export const PARTY_STATE_BADGES = {
  inactive: { label: 'غیرفعال', variant: 'warning' },
  deleted: { label: 'حذف‌شده', variant: 'danger' },
};

function describeSide(side, amountText, suffix = '') {
  const w = BALANCE_WORDS[side];
  return { text: suffix && side !== 'zero' ? `${w.text} ${suffix}` : w.text, amount: amountText, variant: w.variant, sign: w.sign, side };
}

/** مانده ریالی را به «واژه + مبلغ مثبت + رنگ معنایی» تبدیل می‌کند. */
export function describeBalance(balance, kind = 'customer') {
  const value = Number(balance) || 0;
  const side = balanceSideOf(kind, value, 0.5);
  return describeSide(side, formatRial(side === 'zero' ? 0 : Math.abs(value)));
}

/**
 * (Phase 19) مانده‌ی رسمی طرف حساب: گرم ۷۵۰ — عدد اصلی صفحه، سه رقم اعشار ثابت («۱۹٫۵۶۰»).
 * آستانه‌ی «تسویه» نیم سوت است (GRAM_EPS).
 */
export function describeBaseBalance(grams, kind = 'customer') {
  const value = Number(grams) || 0;
  const side = balanceSideOf(kind, value);
  return describeSide(side, formatBaseGrams(side === 'zero' ? 0 : Math.abs(value), BASE_GRAM_DIGITS));
}

/** مانده طلا (گرم) با همان قاعده. */
export function describeGoldBalance(grams, kind = 'customer') {
  const value = Number(grams) || 0;
  const side = balanceSideOf(kind, value, 0.001);
  return describeSide(side, formatGrams(side === 'zero' ? 0 : Math.abs(value)), 'طلا');
}

/** نمایش سه‌رقمی ثابت گرم ۷۵۰ (دقت رسمی ۰٫۰۰۱، ACCOUNTING_RULES §12.2). */
export const BASE_GRAM_DIGITS = { minimumFractionDigits: 3, maximumFractionDigits: 3 };

/**
 * «۱۹٫۵۶۰ گرم ۷۵۰ بد» — عدد و واژه کنار هم، رنگ از variant (رنگ هرگز تنها نیست).
 * برای سلول جدول، ردیف معین و هر جایی که مانده در یک خط می‌آید.
 */
export function BalanceText(described) {
  const el = document.createElement('span');
  el.className = `bal bal--${described.variant}`;
  const amount = document.createElement('span');
  amount.className = 'bal__amount';
  amount.textContent = described.amount;
  const word = document.createElement('b');
  word.className = 'bal__word';
  word.textContent = described.text;
  el.append(amount, ' ', word);
  return el;
}

/** تاریخ ISO یا شمسی ذخیره‌شده را برای نمایش فرمت می‌کند (در برابر مقدار نامعتبر مقاوم است). */
export function displayDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return formatJalaliDate(d);
}

export function formatFieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  switch (key) {
    case 'active':
      return value ? 'فعال' : 'غیرفعال';
    case 'deletedAt':
      return value ? 'بله' : 'خیر';
    default:
      return String(value);
  }
}
