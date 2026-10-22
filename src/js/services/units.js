// units.js — هسته‌ی واحدها: عیار هزاری، معادل ۷۵۰ و گِرد کردن — Phase 22
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل:
// تا Phase 21 سه چیز در چند جای برنامه پخش بود: مقیاس عیار (۱ تا ۲۴)، عیار پایه
// (۱۸) و دقت گِرد کردن گرم (۰٫۰۱ نصف به بالا). Phase 22 هر سه را عوض می‌کند و
// این فایل **تنها مرجع** هر سه است:
//
//   • عیار = عدد هزاری ۱ تا ۱۰۰۰ (پیش‌فرض ۷۵۰)
//   • معادل ۷۵۰ = وزن × عیار ÷ ۷۵۰         ← equivalent750()، یک تابع برای کل برنامه
//   • گِرد کردن گرم: سه رقم اعشار، رو به بالا (دور از صفر) — roundGrams750()
//
// ── «پروفایل واحد» هر سند ──
// Snapshot اسناد قدیمی نباید تغییر کند (دستور Phase 22). سندی که پیش از v10 ثبت
// شده عیارش را به مقیاس ۲۴ و مانده‌اش را با دقت ۰٫۰۱ دارد؛ اگر برگه یا گزارش آن را
// با قاعده‌ی جدید بازمحاسبه کند، عدد چاپ‌شده با عدد دفتر نمی‌خواند. پس هر سند
// «پروفایل واحد» خودش را دارد:
//   - سند جدید: `unitsVersion: 10` و `gramsRoundingMode` روی خودِ سند.
//   - سند قدیمی: این فیلدها را ندارد ⇒ LEGACY_UNITS (مقیاس ۲۴، پایه‌ی ۱۸، ۰٫۰۱).
// سند قدیمی هرگز دستکاری نمی‌شود؛ فقط خواننده‌ها با پروفایل خودش آن را می‌خوانند.
//
// این فایل **خالص** است: نه IndexedDB، نه UI.
// ═══════════════════════════════════════════════════════════════════════════

import { d, mul, div, roundToStep, toNumber, cmp } from '../utils/decimal.js';

/** نسخه‌ی واحدهای سند جدید (هم‌شماره با DB_VERSION مهاجرت). */
export const UNITS_VERSION = 10;

/** عیار پایه‌ی حساب اشخاص و نرخ روز: ۷۵۰ در هزار. */
export const BASE_FINENESS = 750;
export const DEFAULT_FINENESS = 750;
export const FINENESS_MIN = 1;
export const FINENESS_MAX = 1000;

/** دقت رسمی گرم ۷۵۰ (سه رقم اعشار = یک سوت). */
export const GRAM_DECIMALS = 3;
export const GRAM_STEP = '0.001';

/**
 * آستانه‌ی «عملاً صفر» برای گرم: نیمِ آخرین رقم معنادار. فقط نوفه‌ی ممیز شناور
 * را می‌بلعد، هیچ مقدار واقعی را نه.
 */
export const GRAM_EPS = 0.0005;

/** حالت‌های گِرد کردن معادل ۷۵۰ (قابل تغییر از تنظیمات؛ پیش‌فرض «رو به بالا»). */
export const ROUNDING_MODES = ['up', 'nearest', 'down'];
export const DEFAULT_ROUNDING_MODE = 'up';
export const ROUNDING_MODE_LABELS = {
  up: 'رو به بالا (پیش‌فرض)',
  nearest: 'نزدیک‌ترین',
  down: 'رو به پایین',
};

/** عیارهای رایج برای دکمه‌های میان‌بر فرم‌ها. */
export const COMMON_FINENESS = [750, 875, 916, 999, 705, 585];

// ───────────────────────────── پروفایل‌های واحد ─────────────────────────────

/** پروفایل اسناد پیش از v10: عیار ۱..۲۴، پایه‌ی ۱۸، دو رقم، نصف به بالا. */
export const LEGACY_UNITS = Object.freeze({
  version: 9,
  karatScale: 24,
  baseKarat: 18,
  decimals: 2,
  step: '0.01',
  mode: 'nearest',
});

/** پروفایل اسناد جدید با یک حالت گِرد کردن مشخص. */
export function currentUnits(mode = DEFAULT_ROUNDING_MODE) {
  return Object.freeze({
    version: UNITS_VERSION,
    karatScale: 1000,
    baseKarat: BASE_FINENESS,
    decimals: GRAM_DECIMALS,
    step: GRAM_STEP,
    mode: normalizeRoundingMode(mode),
  });
}

export const CURRENT_UNITS = currentUnits();

export function normalizeRoundingMode(mode) {
  return ROUNDING_MODES.includes(mode) ? mode : DEFAULT_ROUNDING_MODE;
}

/** آیا این سند با واحدهای v10 ثبت شده است. */
export function isCurrentUnitsDoc(doc) {
  return Number(doc?.unitsVersion) >= UNITS_VERSION;
}

/** پروفایل واحد یک سند ذخیره‌شده. سند بدون نشانه ⇒ پروفایل قدیمی. */
export function unitsOf(doc) {
  if (!isCurrentUnitsDoc(doc)) return LEGACY_UNITS;
  return currentUnits(doc.gramsRoundingMode ?? doc.pricingSnapshot?.gramsRoundingMode);
}

/** فیلدهایی که هر سند جدید برای ثبت پروفایل واحدش می‌گیرد. */
export function unitsStamp(mode = DEFAULT_ROUNDING_MODE) {
  return { unitsVersion: UNITS_VERSION, gramsRoundingMode: normalizeRoundingMode(mode) };
}

// ───────────────────────────── عیار ─────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** عیار هزاری معتبر: عدد صحیح ۱ تا ۱۰۰۰. */
export function isValidFineness(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= FINENESS_MIN && n <= FINENESS_MAX;
}

export const FINENESS_ERROR = 'عیار باید عدد صحیح بین ۱ تا ۱۰۰۰ باشد (مثلاً ۷۵۰).';

/**
 * نگاشت عیار ۲۴تایی قدیمی به هزاری (مهاجرت v10 و خواندن اسناد قدیمی).
 * عیارهای رایج با عدد مرسوم بازار (عیار ۲۴ = ۹۹۹، تصمیم Phase 22)؛ بقیه تناسبی.
 */
export const LEGACY_KARAT_MAP = Object.freeze({ 24: 999, 22: 916, 21: 875, 18: 750, 14: 585 });

export function legacyKaratToFineness(karat) {
  const k = num(karat);
  if (k <= 0) return 0;
  if (LEGACY_KARAT_MAP[k] !== undefined) return LEGACY_KARAT_MAP[k];
  return Math.round((k * 1000) / 24);
}

/**
 * عیار **هزاری** یک مقدار عیار که روی یک سند ذخیره شده است. سند جدید همان عدد را
 * دارد؛ سند قدیمی عیار ۲۴تایی دارد و ترجمه می‌شود. (برای سطل انبار، گزارش، نمایش.)
 */
export function finenessOf(doc, karat) {
  return isCurrentUnitsDoc(doc) ? num(karat) : legacyKaratToFineness(karat);
}

/** شناسه‌ی سطل انبار ذخیره‌شده روی یک سند قدیمی ⇒ شناسه‌ی v10. کالای کددار دست نمی‌خورد. */
export function migrateInventoryRefId(refId) {
  const s = String(refId || '');
  if (!s || s.startsWith('product:')) return s;
  const i = s.lastIndexOf(':');
  if (i < 0) return s;
  return `${s.slice(0, i)}:${legacyKaratToFineness(Number(s.slice(i + 1)))}`;
}

/** شناسه‌ی سطل ذخیره‌شده روی یک سند (با توجه به پروفایل همان سند). */
export function inventoryRefOfDoc(doc, refId) {
  return isCurrentUnitsDoc(doc) ? refId : migrateInventoryRefId(refId);
}

/** عیار «در هزار» برای نمایش (ستون عیار برگه). */
export function karatMilleOf(karat, units = CURRENT_UNITS) {
  const k = num(karat);
  if (k <= 0) return 0;
  if (units.karatScale === 1000) return k;
  return Math.round((k / 24) * 1000); // همان فرمول برگه‌ی Phase 18 برای سند قدیمی
}

// ───────────────────────────── وزن ─────────────────────────────

/** وزن ترازو معتبر است اگر مثبت و حداکثر سه رقم اعشار باشد (بدون گِرد کردن). */
export function isValidScaleWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return false;
  return Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
}

export const WEIGHT_DECIMALS_ERROR = 'وزن حداکثر سه رقم اعشار دارد (مثلاً ۱۲٫۶۸۳).';

/** وزن ترازو عیناً — فقط نوفه‌ی ممیز شناور پاک می‌شود (سه رقم). */
export function scaleWeight(value) {
  return toNumber(d(num(value)), GRAM_DECIMALS);
}

// ───────────────────────────── گرم ۷۵۰ ─────────────────────────────

/**
 * محافظ نوفه: پیش از گِرد کردن رو به بالا، مقدار به ۶ رقم اعشار (یک‌هزارم سوت) نزدیک
 * می‌شود. بدون آن، خطای ناچیزِ یک نرخ گِردشده (مثلاً ۱۴٫۰۰۰۰۴۴۵ به‌جای ۱۴) با قاعده‌ی
 * «رو به بالا» یک سوتِ کامل (۱۴٫۰۰۱) می‌ساخت. مقدار واقعی هیچ‌وقت تا این حد ریز نیست:
 * معادل ۷۵۰ یک وزن سه‌رقمی یا دقیق است یا کسرش پیش از رقم ششم پیدا می‌شود.
 */
export const NOISE_STEP = '0.000001';

/** گِرد کردن یک مقدار گرمیِ محاسبه‌شده (decimal داخلی) با پروفایل ⇒ decimal داخلی. */
export function roundGramsDecimal(value, units = CURRENT_UNITS) {
  return roundToStep(roundToStep(value, NOISE_STEP, 'nearest'), units.step, units.mode);
}

/** گِرد کردن یک مقدار گرمیِ محاسبه‌شده ⇒ Number. ۸٫۹۵۶۱ → ۸٫۹۵۷ و ۸٫۹۵۶۰ → ۸٫۹۵۶. */
export function roundGrams750(value, units = CURRENT_UNITS) {
  const n = toNumber(roundGramsDecimal(d(value), units), units.decimals);
  return n === 0 ? 0 : n;
}

/**
 * معادل ۷۵۰ خام (گِردنشده، decimal داخلی): وزن × عیار ÷ عیار پایه‌ی پروفایل.
 * برای سند قدیمی عیار ۲۴تایی و پایه‌ی ۱۸ است — همان فرمول Phase 18.
 */
export function equivalent750Raw(weightGrams, karat, units = CURRENT_UNITS) {
  if (cmp(d(units.baseKarat), 0) <= 0) return 0n;
  return div(mul(d(num(weightGrams)), d(num(karat))), d(units.baseKarat));
}

/**
 * **تنها تابع معادل ۷۵۰ برنامه**: وزن × عیار ÷ ۷۵۰، گِردشده با قاعده‌ی مرکزی.
 * مثال: ۱۰٫۰۰۳ گرم عیار ۷۴۰ ⇒ ۹٫۸۶۹۶۲۶… ⇒ ۹٫۸۷۰ ؛ عیار ۷۵۰ ⇒ خودِ وزن.
 */
export function equivalent750(weightGrams, karat, units = CURRENT_UNITS) {
  return roundGrams750(equivalent750Raw(weightGrams, karat, units), units);
}

/**
 * نرمال‌سازی جمع/تفاضل مقادیرِ از قبل گِردشده (نه قاعده‌ی کسب‌وکار): فقط نوفه‌ی
 * ممیز شناور را در سه رقم اعشار پاک می‌کند. مقادیر دو رقمی قدیمی هم دست نمی‌خورند.
 */
export function normalizeGrams(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = toNumber(roundToStep(d(n), GRAM_STEP, 'nearest'), GRAM_DECIMALS);
  return Math.abs(r) < GRAM_EPS ? 0 : r;
}

// ───────────────────────────── نرخ ─────────────────────────────

/** نرخ عیار f از نرخ ۷۵۰: نرخ۷۵۰ × f ÷ ۷۵۰ (ریال، گِرد به عدد صحیح). */
export function rateForFineness(rate750, fineness) {
  const r = num(rate750);
  const f = num(fineness);
  if (r <= 0 || f <= 0) return 0;
  return Math.round((r * f) / BASE_FINENESS);
}
