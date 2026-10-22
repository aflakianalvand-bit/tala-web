// dateRange.js — بازه‌ی تاریخ گزارش‌ها (Phase 14)
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا مقایسه‌ی «روز تقویمی محلی» و نه مقایسه‌ی رشته‌ی ISO:
// تاریخ اسناد به‌صورت ISO با منطقه‌ی UTC ذخیره می‌شود. فرم‌ها ساعت ۱۲ ظهر محلی را
// ذخیره می‌کنند (بی‌خطر)، ولی رکوردهایی که با «همین لحظه» ساخته می‌شوند — مثلاً
// Reversal ابطال یک سند در ساعت ۱ بامداد تهران — در UTC هنوز «دیروز» هستند
// (‎21:30Z روز قبل). مقایسه‌ی رشته‌ی ISO با مرز روز، چنین رکوردی را در روز اشتباه
// می‌نشاند و گزارش «امروز» آن را نمی‌بیند. همان درسی که Phase 12 برای سررسید گرفت:
// هر مقایسه‌ی «روز» باید روی روز تقویمی محلی انجام شود.
//
// قرارداد: بازه با دو کلید `YYYY-MM-DD` (همان مقدار input[type=date]) تعریف می‌شود و
// **هر دو سر شامل‌اند**. `null` یعنی آن سر باز است.
// ═══════════════════════════════════════════════════════════════════════════

import {
  gregorianToJalali,
  jalaliToGregorian,
  formatJalaliDate,
  formatJalaliDateLong,
  JALALI_MONTHS,
} from './date.js';

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');

export class DateRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DateRangeError';
  }
}

function keyOfParts(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Date محلی (ظهر) از روی کلید روز — ظهر تا تغییر ساعت تابستانی روز را جابه‌جا نکند. */
export function dateOfKey(key) {
  const m = KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return keyOfParts(date.getFullYear(), date.getMonth() + 1, date.getDate()) === key ? date : null;
}

/** کلید روز تقویمی محلی (`YYYY-MM-DD`) از Date یا رشته‌ی ISO؛ ورودی نامعتبر ⇒ null. */
export function dayKeyOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return keyOfParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/**
 * بازه‌ی ورودی کاربر → بازه‌ی نرمال `{from, to}` (کلید روز یا null).
 * کلید نامعتبر یا «از» بعد از «تا» خطا می‌دهد — گزارش با بازه‌ی وارونه بی‌صدا خالی
 * برمی‌گشت و کاربر فکر می‌کرد در آن بازه هیچ فروشی نداشته است.
 */
export function normalizeRange({ from = null, to = null } = {}) {
  const norm = (value, label) => {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return dayKeyOf(value);
    if (!dateOfKey(value)) throw new DateRangeError(`تاریخ «${label}» نامعتبر است.`);
    return String(value);
  };
  const range = { from: norm(from, 'از'), to: norm(to, 'تا') };
  if (range.from && range.to && range.from > range.to) {
    throw new DateRangeError('تاریخ «از» نمی‌تواند بعد از تاریخ «تا» باشد.');
  }
  return range;
}

/**
 * جایگاه یک تاریخ نسبت به بازه: 'before' | 'in' | 'after'.
 * تاریخ نامعتبر فقط وقتی بازه کاملاً باز است 'in' حساب می‌شود؛ در غیر این صورت null
 * (نمی‌توان گفت متعلق به کدام دوره است — و موتورها null را جمع نمی‌زنند).
 */
export function phaseOf(value, range = {}) {
  const key = dayKeyOf(value);
  if (!key) return range.from || range.to ? null : 'in';
  if (range.from && key < range.from) return 'before';
  if (range.to && key > range.to) return 'after';
  return 'in';
}

export function inRange(value, range = {}) {
  return phaseOf(value, range) === 'in';
}

/** سازنده‌ی تابع phase برای رکوردهای دفتر (ورودی موتورهای ledger.js). */
export function entryPhase(range = {}) {
  return (entry) => phaseOf(entry?.date, range);
}

// ─────────────────────────── گروه‌بندی شمسی ───────────────────────────

/** کلید مرتب‌پذیر روز شمسی (`1405/06/26`). */
export function jalaliDayKey(value) {
  const key = dayKeyOf(value);
  return key ? formatJalaliDate(dateOfKey(key)) : null;
}

/** کلید مرتب‌پذیر ماه شمسی (`1405/06`). */
export function jalaliMonthKey(value) {
  const key = dayKeyOf(value);
  if (!key) return null;
  const d = dateOfKey(key);
  const [jy, jm] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${jy}/${pad(jm)}`;
}

/** `1405/06` → «شهریور ۱۴۰۵» */
export function jalaliMonthLabel(monthKey) {
  const [jy, jm] = String(monthKey || '').split('/').map(Number);
  if (!jy || !jm) return '—';
  return `${JALALI_MONTHS[jm - 1]} ${jy}`;
}

function keyFromJalali(jy, jm, jd) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return keyOfParts(gy, gm, gd);
}

function addDaysKey(key, n) {
  const d = dateOfKey(key);
  return dayKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12));
}

/** اولین روز ماه شمسی تاریخ داده‌شده (با جابه‌جایی ماه اختیاری). */
function jalaliMonthStartKey(date, offset = 0) {
  const [jy, jm] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const index = jy * 12 + (jm - 1) + offset;
  return keyFromJalali(Math.floor(index / 12), (index % 12) + 1, 1);
}

// ─────────────────────────── بازه‌های آماده ───────────────────────────

export const RANGE_PRESETS = [
  { key: 'today', label: 'امروز' },
  { key: 'yesterday', label: 'دیروز' },
  { key: 'last7', label: '۷ روز اخیر' },
  { key: 'thisMonth', label: 'ماه جاری (شمسی)' },
  { key: 'lastMonth', label: 'ماه قبل (شمسی)' },
  { key: 'thisYear', label: 'سال جاری (شمسی)' },
  { key: 'all', label: 'همه‌ی تاریخ‌ها' },
  { key: 'custom', label: 'بازه‌ی دلخواه' },
];

/** بازه‌ی یک گزینه‌ی آماده نسبت به «امروز». 'custom' ⇒ null (کاربر خودش وارد می‌کند). */
export function presetRange(presetKey, today = new Date()) {
  const t = dayKeyOf(today);
  const d = dateOfKey(t);
  switch (presetKey) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday': {
      const y = addDaysKey(t, -1);
      return { from: y, to: y };
    }
    case 'last7':
      return { from: addDaysKey(t, -6), to: t };
    case 'thisMonth':
      return { from: jalaliMonthStartKey(d, 0), to: t };
    case 'lastMonth':
      return { from: jalaliMonthStartKey(d, -1), to: addDaysKey(jalaliMonthStartKey(d, 0), -1) };
    case 'thisYear': {
      const [jy] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return { from: keyFromJalali(jy, 1, 1), to: t };
    }
    case 'all':
      return { from: null, to: null };
    default:
      return null;
  }
}

/** متن خوانای بازه برای سربرگ گزارش. */
export function describeRange(range = {}) {
  const long = (key) => formatJalaliDateLong(dateOfKey(key));
  if (range.from && range.to) {
    return range.from === range.to ? `روز ${long(range.from)}` : `از ${long(range.from)} تا ${long(range.to)}`;
  }
  if (range.from) return `از ${long(range.from)} به بعد`;
  if (range.to) return `از ابتدا تا ${long(range.to)}`;
  return 'همه‌ی تاریخ‌ها';
}
