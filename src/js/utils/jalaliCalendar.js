// jalaliCalendar.js — محاسبات تقویم شمسی برای کامپوننت انتخاب تاریخ (Phase 24)
//
// بدون کتابخانه: همه‌چیز روی دو تابع موجود و آزموده‌ی utils/date.js سوار است
// (gregorianToJalali / jalaliToGregorian — رفت‌وبرگشت روی ۲۰٬۰۰۰ روز در Phase 14).
// هیچ جدول دستی کبیسه ساخته نمی‌شود؛ طول اسفند از خودِ تبدیل به دست می‌آید، پس
// سال کبیسه‌ی ۱۴۰۳ (اسفند ۳۰ روزه) و ۱۴۰۴ (۲۹ روزه) خودبه‌خود درست‌اند.
//
// قرارداد مقدار: همان رشته‌ی `YYYY-MM-DD` میلادیِ input[type=date] قدیمی.
// به همین دلیل فرم‌ها و سرویس‌ها (fromDateInputValue) هیچ تغییری لازم ندارند.

import { gregorianToJalali, jalaliToGregorian, JALALI_MONTHS } from './date.js';

export { JALALI_MONTHS };

/** نام روزهای هفته از شنبه (هفته‌ی ایرانی از شنبه شروع می‌شود). */
export const JALALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 86400000;

/** روز میلادی به‌صورت عدد روز از مبدأ (بدون اثر ساعت تابستانی). */
function dayNumber(gy, gm, gd) {
  return Math.round(Date.UTC(gy, gm - 1, gd) / DAY_MS);
}

/** تعداد روزهای ماه شمسی — ۶ ماه اول ۳۱، بعدی ۳۰، اسفند ۲۹ یا ۳۰. */
export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const a = jalaliToGregorian(jy, 12, 1);
  const b = jalaliToGregorian(jy + 1, 1, 1);
  return dayNumber(...b) - dayNumber(...a);
}

export function isJalaliLeapYear(jy) {
  return jalaliMonthLength(jy, 12) === 30;
}

/** اندیس روز هفته (۰ = شنبه … ۶ = جمعه) برای یک تاریخ شمسی. */
export function jalaliWeekday(jy, jm, jd) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const sundayBased = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay();
  return (sundayBased + 1) % 7;
}

/** `YYYY-MM-DD` میلادی → { jy, jm, jd } یا null برای مقدار خالی/نامعتبر. */
export function isoKeyToJalali(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const gy = Number(m[1]);
  const gm = Number(m[2]);
  const gd = Number(m[3]);
  if (gm < 1 || gm > 12 || gd < 1 || gd > 31) return null;
  // تاریخ ناموجود (۳۱ فوریه) نباید بی‌صدا به ماه بعد برود.
  const probe = new Date(Date.UTC(gy, gm - 1, gd));
  if (probe.getUTCMonth() !== gm - 1) return null;
  const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
  return { jy, jm, jd };
}

/** { jy, jm, jd } → `YYYY-MM-DD` میلادی (مقدار ذخیره‌ای فرم). */
export function jalaliToIsoKey(jy, jm, jd) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

/** امروزِ محلی به شمسی. */
export function todayJalali(now = new Date()) {
  const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return { jy, jm, jd };
}

/** افزودن ماه با حفظ روز (روز ۳۱ در ماه ۳۰ روزه ⇒ ۳۰). */
export function addJalaliMonths({ jy, jm, jd }, delta) {
  const index = jy * 12 + (jm - 1) + delta;
  const ny = Math.floor(index / 12);
  const nm = (index % 12 + 12) % 12 + 1;
  return { jy: ny, jm: nm, jd: Math.min(jd, jalaliMonthLength(ny, nm)) };
}

/** افزودن روز از مسیر میلادی (مرز ماه و سال کبیسه خودبه‌خود درست است). */
export function addJalaliDays({ jy, jm, jd }, delta) {
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const d = new Date(Date.UTC(gy, gm - 1, gd) + delta * DAY_MS);
  const [ny, nm, nd] = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return { jy: ny, jm: nm, jd: nd };
}

/**
 * شبکه‌ی ماه: آرایه‌ی ۴۲ خانه (۶ هفته × ۷ روز، از شنبه). خانه‌های خارج از ماه
 * `null` هستند — روزِ ماه قبل/بعد نمایش داده نمی‌شود تا با روز همین ماه اشتباه نشود.
 */
export function jalaliMonthGrid(jy, jm) {
  const first = jalaliWeekday(jy, jm, 1);
  const len = jalaliMonthLength(jy, jm);
  const cells = new Array(42).fill(null);
  for (let d = 1; d <= len; d++) cells[first + d - 1] = d;
  // هفته‌ی ششمِ کاملاً خالی حذف می‌شود (ارتفاع ثابت‌تر و بدون ردیف بی‌معنا).
  return cells.slice(35).every((c) => c === null) ? cells.slice(0, 35) : cells;
}

export function sameJalali(a, b) {
  return !!a && !!b && a.jy === b.jy && a.jm === b.jm && a.jd === b.jd;
}
