// docLabels.js — واژگان فارسی مشترک اسناد تجاری (خرید، فروش، برگشت)
// در Phase 7 از purchaseLabels.js استخراج شد تا فروش آن‌ها را کپی نکند.
import { finenessOf } from '../../services/units.js';
import { formatJalaliDate, formatJalaliDateLong, toDate } from '../../utils/date.js';
import { classifyDue } from '../../services/dueDates.js';

export const GOLD_TYPE_LABELS = {
  manufactured: 'ساخته‌شده',
  melted: 'آبشده',
  misc: 'متفرقه',
};

export const GOLD_TYPE_OPTIONS = Object.entries(GOLD_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export const GOLD_TYPE_BADGE_VARIANT = {
  manufactured: 'primary',
  melted: 'warning',
  misc: 'neutral',
};

export const PAYMENT_MODE_LABELS = {
  cash: 'نقدی',
  credit: 'رسیدی',
  mixed: 'ترکیبی',
};

export const PAYMENT_MODE_OPTIONS = Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label }));

export const WAGE_TYPE_OPTIONS = [
  { value: 'percent', label: 'درصدی' },
  { value: 'perGram', label: 'مبلغ به ازای هر گرم' },
];

export const PAY_METHOD_LABELS = {
  cash: 'وجه',
  gold: 'طلا',
};

/** برچسب رکوردهای دفتر در تب «دفاتر» صفحات جزئیات. */
export const GOLD_REASON_LABELS = {
  purchase: 'خرید',
  sale: 'فروش',
  sale_return: 'برگشت از فروش',
  gold_in: 'ورود طلا',
  gold_out: 'خروج طلا',
  melt: 'ذوب',
  adjustment: 'اصلاح موجودی',
  receipt_gold: 'دریافت طلا',
  payment_gold: 'پرداخت طلا',
  // (Phase 10) دو reason جدید موتور موجودی
  opening: 'مانده ابتدای دوره',
  transfer: 'انتقال بین سطل‌ها',
};

export const MONEY_REASON_LABELS = {
  receive: 'دریافت',
  pay: 'پرداخت',
  sale: 'فروش',
  purchase: 'خرید',
  transfer: 'انتقال',
  settlement: 'تسویه',
};

export const LEDGER_KIND_LABELS = {
  inventory: 'انبار طلا',
  supplier: 'تأمین‌کننده',
  customer: 'مشتری',
  account: 'حساب',
};

/** تاریخ کوتاه شمسی از رشته ISO. */
export function displayDate(iso) {
  if (!iso) return '—';
  return formatJalaliDate(toDate(iso));
}

/** تاریخ بلند شمسی از رشته ISO. */
export function displayDateLong(iso) {
  if (!iso) return '—';
  return formatJalaliDateLong(toDate(iso));
}

// ─────────────── سررسید (Phase 12) ───────────────
// وضعیت‌ها از services/dueDates.js → classifyDue می‌آیند؛ این بخش فقط واژگان نمایشی است.

export const DUE_STATE_LABELS = {
  overdue: 'سررسید گذشته',
  today: 'امروز',
  near: 'نزدیک',
  future: 'آینده',
  settled: 'تسویه‌شده',
  voided: 'باطل‌شده',
};

/** رنگ‌ها طبق UI_GUIDELINES §2: نزدیک = زرد/نارنجی، گذشته = قرمز پررنگ. */
export const DUE_STATE_VARIANT = {
  overdue: 'overdue',
  today: 'danger',
  near: 'warning',
  future: 'neutral',
  settled: 'success',
  voided: 'neutral',
};

export const DUE_DIRECTION_LABELS = {
  receivable: 'دریافتنی از مشتری',
  payable: 'پرداختنی به تأمین‌کننده',
};

export const DUE_SOURCE_LABELS = {
  sale: 'فاکتور فروش',
  purchase: 'سند خرید',
};

/** متن کوتاه فاصله تا سررسید: «۲ روز مانده»، «امروز»، «۵ روز گذشته». */
export function dueDaysText(item) {
  if (!item) return '';
  switch (item.state) {
    case 'settled':
      return 'تسویه‌شده';
    case 'voided':
      return 'باطل‌شده';
    case 'today':
      return 'سررسید امروز';
    case 'overdue':
      return item.invalidDate ? 'تاریخ سررسید نامعتبر' : `${Math.abs(item.days)} روز از سررسید گذشته`;
    default:
      return `${item.days} روز تا سررسید`;
  }
}

/**
 * توصیف وضعیت سررسید نسبت به امروز.
 * ورودی می‌تواند آیتم غنی‌شده‌ی موتور (دارای `state`) یا رکورد خام `dueDates` باشد؛
 * برای رکورد خام، وضعیت «تسویه‌شده/باطل» از نمای ذخیره‌شده خوانده می‌شود.
 */
export function describeDueDate(dueDateRecord, today = new Date(), nearDays = undefined) {
  if (!dueDateRecord) return null;
  const item = dueDateRecord.state
    ? dueDateRecord
    : classifyDue({
        dueDate: dueDateRecord.dueDate,
        remainingIRR: dueDateRecord.status === 'paid' ? 0 : 1,
        voided: dueDateRecord.status === 'voided',
        today,
        nearDays,
      });
  return { text: dueDaysText(item), variant: DUE_STATE_VARIANT[item.state] || 'neutral', state: item.state };
}

/**
 * خلاصه‌ی یک قلم سند برای نمایش. (Phase 22) با `doc`، عیار سند پیش از v10 (مقیاس ۲۴)
 * به عیار هزاری ترجمه می‌شود — خودِ سند دست نمی‌خورد.
 */
export function describeLine(line, doc = null) {
  const type = GOLD_TYPE_LABELS[line.goldType] || line.goldType;
  const base = `${type} • عیار ${doc ? finenessOf(doc, line.karat) : line.karat}`;
  // Phase 23: نام آزمایشگاه (Snapshot روی قلم/خط) — فقط اگر ثبت شده باشد.
  return line.labName ? `${base} • آزمایشگاه ${line.labName}` : base;
}

/**
 * Phase 23 — شرح یک خط طلای تسویه (دریافت/پرداخت): «۱۰٫۰۰۳ گرم آبشده عیار ۷۴۰ • آزمایشگاه …».
 * عیار از پروفایل خودِ سند خوانده می‌شود (سند قدیمی ۲۴تایی ⇒ هزاری).
 */
export function describeGoldEntry(entry) {
  const w = Number(entry.weightGrams) || 0;
  const type = GOLD_TYPE_LABELS[entry.goldType] || '';
  const base = `${w.toLocaleString('en-US', { maximumFractionDigits: 3 })} گرم ${type} عیار ${finenessOf(entry, entry.karat)}`;
  return entry.labName ? `${base} • آزمایشگاه ${entry.labName}` : base;
}
