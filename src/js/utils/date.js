// date.js — تبدیل تاریخ میلادی به شمسی (جلالی)، بدون وابستگی خارجی
// پیاده‌سازی مبتنی بر الگوریتم ریاضی عمومیِ شناخته‌شده‌ی تبدیل تقویم (Public Domain).
function div(a, b) { return Math.trunc(a / b); }
function mod(a, b) { return a - Math.trunc(a / b) * b; }

/** [gy, gm, gd] میلادی → [jy, jm, jd] شمسی */
export function gregorianToJalali(gy, gm, gd) {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  gy -= gy <= 1600 ? 621 : 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + gDaysInMonth[gm - 1];
  jy += 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? mod(days, 31) : mod(days - 186, 30));
  return [jy, jm, jd];
}

/**
 * [jy, jm, jd] شمسی → [gy, gm, gd] میلادی (Phase 14).
 * همتای معکوس gregorianToJalali — لازم برای بازه‌های «این ماه / ماه قبل / امسال» گزارش‌ها،
 * که مرزشان در تقویم شمسی تعریف می‌شود. درستی با رفت‌وبرگشت روی هزاران روز تست می‌شود.
 */
export function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days = -355668 + 365 * jy + div(jy, 33) * 8 + div(mod(jy, 33) + 3, 4) + jd
    + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days = mod(days, 146097);
  if (days > 36524) {
    days -= 1;
    gy += 100 * div(days, 36524);
    days = mod(days, 36524);
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days = mod(days, 1461);
  if (days > 365) {
    gy += div(days - 1, 365);
    days = mod(days - 1, 365);
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 12 && gd > monthDays[gm]) {
    gd -= monthDays[gm];
    gm += 1;
  }
  return [gy, gm + 1, gd];
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** تاریخ جاوااسکریپت → رشته‌ی «۱۴۰۵/۰۶/۱۱» */
export function formatJalaliDate(date = new Date()) {
  const [jy, jm, jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const pad = (n) => String(n).padStart(2, '0');
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/** تاریخ جاوااسکریپت → رشته‌ی خوانا «۱۱ شهریور ۱۴۰۵» */
export function formatJalaliDateLong(date = new Date()) {
  const [jy, jm, jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return `${jd} ${JALALI_MONTHS[jm - 1]} ${jy}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/** ورودی متنوع (Date | رشته ISO | undefined) → شیء Date معتبر. */
export function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** سال شمسی یک تاریخ — پایه‌ی شماره‌گذاری سالانه اسناد (services/docNumber.js). */
export function jalaliYearOf(value) {
  const d = toDate(value);
  return gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate())[0];
}

/** تاریخ ISO کامل → بخش تاریخ به‌فرم `YYYY-MM-DD` (مقدار مناسب input[type=date]). */
export function toDateInputValue(value) {
  const d = toDate(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `YYYY-MM-DD` (خروجی input[type=date]) → رشته ISO کامل با ساعت محلی ۱۲:۰۰ ظهر.
 * چرا ظهر و نه نیمه‌شب: تبدیل به UTC نباید تاریخ را یک روز به عقب/جلو ببرد.
 */
export function fromDateInputValue(value) {
  if (!value) return nowIso();
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return nowIso();
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}
