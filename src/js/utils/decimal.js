// decimal.js — محاسبات اعشاری دقیق (Decimal-safe) بدون کتابخانه خارجی — Phase 8
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل لازم است:
// اعداد ممیز شناور جاوااسکریپت برای پول و وزن طلا امن نیستند:
//     0.1 + 0.2            → 0.30000000000000004
//     7.76 * 100           → 775.9999999999999
//     1.005 را گرد کنی     → 1.00 به‌جای 1.01
// در یک نرم‌افزار مالی، همین خطاهای ریز روی هزاران فاکتور انباشته می‌شوند و
// تراز آزمایشی را می‌شکنند. بنابراین تمام محاسبات موتور قیمت روی **عدد صحیح
// بزرگ (BigInt)** با مقیاس ثابت انجام می‌شود، نه روی Number.
//
// نمایش داخلی: هر عدد یک BigInt است که ۹ رقم اعشار در خود دارد.
//     1        → 1_000_000_000n
//     7.76     → 7_760_000_000n
//     0.005    →     5_000_000n
// ۹ رقم اعشار برای وزن طلا (۳ رقم) و درصدها (۴ رقم) با حاشیه‌ی امن کافی است.
//
// قاعده‌ی گِردکردن در تمام عملیات: **نصف به بالا، دور از صفر** (Half-Away-From-Zero)
// — همان چیزی که کاربر انسانی انتظار دارد (۰٫۵ → ۱، ۱٫۰۰۵ → ۱٫۰۱).
// ═══════════════════════════════════════════════════════════════════════════

/** تعداد ارقام اعشار نگهداری‌شده در نمایش داخلی. */
export const DECIMALS = 9;
const ONE = 10n ** BigInt(DECIMALS);

/** تقسیم صحیح با گِردکردن «نصف به بالا، دور از صفر». */
function roundDiv(numerator, denominator) {
  if (denominator === 0n) throw new Error('تقسیم بر صفر در محاسبات دقیق.');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const dnm = denominator < 0n ? -denominator : denominator;
  const q = n / dnm;
  const r = n % dnm;
  const rounded = r * 2n >= dnm ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * رشته/عدد → نمایش داخلی. برای عدد از `String(n)` استفاده می‌شود که نمایش
 * کوتاه و دقیق جاوااسکریپت است (`String(7.76) === '7.76'`)، پس خطای ممیز
 * شناور وارد محاسبات نمی‌شود. نماد نمایی (`1e-7`) هم پشتیبانی می‌شود.
 */
export function d(value) {
  if (typeof value === 'bigint') return value; // از قبل تبدیل‌شده — Idempotent
  if (value === null || value === undefined || value === '') return 0n;

  let s = typeof value === 'number' ? String(value) : String(value).trim();
  if (s === '' || s === '-' || s === '+') return 0n;
  if (!Number.isFinite(Number(s))) return 0n; // NaN/Infinity → صفر (ورودی نامعتبر)

  let sign = 1n;
  if (s[0] === '-') {
    sign = -1n;
    s = s.slice(1);
  } else if (s[0] === '+') {
    s = s.slice(1);
  }

  // نماد نمایی: mantissa e exponent
  let exponent = 0;
  const eIndex = s.search(/[eE]/);
  if (eIndex >= 0) {
    exponent = Number(s.slice(eIndex + 1));
    s = s.slice(0, eIndex);
  }

  const [intPart = '0', fracPart = ''] = s.split('.');
  let digits = `${intPart}${fracPart}`;
  let scale = fracPart.length - exponent; // تعداد ارقام اعشار مؤثر

  if (scale > DECIMALS) {
    // ارقام اضافی با همان قاعده‌ی «نصف به بالا» حذف می‌شوند
    const extra = scale - DECIMALS;
    const keep = digits.slice(0, Math.max(0, digits.length - extra)) || '0';
    const dropped = digits.slice(Math.max(0, digits.length - extra)).padEnd(extra, '0');
    let result = BigInt(keep);
    if (dropped && BigInt(dropped[0]) >= 5n) result += 1n;
    return sign * result;
  }

  digits = digits + '0'.repeat(DECIMALS - scale);
  return sign * BigInt(digits || '0');
}

/** نمایش داخلی → رشته با تعداد اعشار مشخص (بدون خطای ممیز شناور). */
export function toFixed(x, decimals = 3) {
  const value = d(x);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const factor = 10n ** BigInt(DECIMALS - decimals);
  const scaled = decimals >= DECIMALS ? abs : roundDiv(abs, factor);
  const s = scaled.toString().padStart(decimals + 1, '0');
  const intPart = s.slice(0, s.length - decimals) || '0';
  const fracPart = decimals > 0 ? `.${s.slice(s.length - decimals)}` : '';
  return `${negative ? '-' : ''}${intPart}${fracPart}`;
}

/**
 * نمایش داخلی → Number معمولی، برای ذخیره در IndexedDB و نمایش در UI.
 * از مسیر رشته عبور می‌کند تا خطای تبدیل وارد نشود.
 */
export function toNumber(x, decimals = DECIMALS) {
  return Number(toFixed(x, decimals));
}

// ─────────────────────────────── عملیات پایه ───────────────────────────────

export function add(a, b) {
  return d(a) + d(b);
}

export function sub(a, b) {
  return d(a) - d(b);
}

export function mul(a, b) {
  return roundDiv(d(a) * d(b), ONE);
}

export function div(a, b) {
  return roundDiv(d(a) * ONE, d(b));
}

export function neg(a) {
  return -d(a);
}

export function abs(a) {
  const v = d(a);
  return v < 0n ? -v : v;
}

/** −۱ / ۰ / +۱ */
export function cmp(a, b) {
  const x = d(a);
  const y = d(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isZero(a) {
  return d(a) === 0n;
}

export function sum(values) {
  return values.reduce((acc, v) => acc + d(v), 0n);
}

export function max(a, b) {
  return cmp(a, b) >= 0 ? d(a) : d(b);
}

export function min(a, b) {
  return cmp(a, b) <= 0 ? d(a) : d(b);
}

/** درصد: `percentOf(11770000, 9)` = ۹٪ از مبلغ. */
export function percentOf(value, percent) {
  return roundDiv(d(value) * d(percent), 100n * ONE);
}

// ─────────────────────────────── گِردکردن ───────────────────────────────

/**
 * گِردکردن به مضربی از `step`.
 * @param {*} value مقدار
 * @param {*} step گام (مثلاً `0.05` برای وزن یا `100` برای ریال). صفر/منفی = بدون گِردکردن.
 * @param {'nearest'|'up'|'down'} mode پیش‌فرض «نزدیک‌ترین» با قاعده‌ی نصف به بالا.
 */
export function roundToStep(value, step, mode = 'nearest') {
  const x = d(value);
  const s = d(step);
  if (s <= 0n) return x;

  const negative = x < 0n;
  const ax = negative ? -x : x;
  const q = ax / s;
  const r = ax % s;

  let k;
  if (mode === 'up') k = r > 0n ? q + 1n : q;
  else if (mode === 'down') k = q;
  else k = r * 2n >= s ? q + 1n : q;

  const result = k * s;
  return negative ? -result : result;
}

/** گِردکردن به عدد صحیح (ریال) با قاعده‌ی نصف به بالا. */
export function roundToUnit(value) {
  return roundToStep(value, ONE, 'nearest');
}
