// priceRates.js — نرخ روز طلا و پیکربندی موتور قیمت (Phase 8)
//
// ═══════════════════════════════════════════════════════════════════════════
// دو منبع پیکربندی، عمداً جدا از هم (DATABASE_SCHEMA §3.12 و §3.13):
//
//   priceRates → **Append-only**: هر تغییر نرخ یک رکورد جدید می‌سازد و رکورد
//                قبلی هرگز ویرایش/حذف نمی‌شود. تاریخچه نرخ لازم است تا بتوان
//                فاکتور هر روز را با نرخ همان روز بازسازی و بازبینی کرد
//                (PRICING_RULES §6).
//   settings   → پیکربندی پایدار (گام گِردکردن ریال و وزن) که ویرایش‌پذیر است.
//
// نکته‌ی کلیدی: هیچ سندی به این دو وابسته نمی‌ماند. مقادیر مؤثر در لحظه‌ی ثبت،
// داخل خود سند Snapshot می‌شوند؛ پس تغییر نرخ روز هرگز فاکتور قبلی را عوض
// نمی‌کند (دستور پروژه §11 — با تست خودکار تثبیت شده است).
// ═══════════════════════════════════════════════════════════════════════════

import { get, getAll } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { DEFAULT_PRICING_CONFIG, normalizeConfig } from './pricing.js';
import {
  isValidFineness,
  normalizeRoundingMode,
  DEFAULT_ROUNDING_MODE,
  UNITS_VERSION,
  isCurrentUnitsDoc,
  legacyKaratToFineness,
} from './units.js';

const SETTINGS_ID = 'main';

/** پیش‌فرض بخش «گِردکردن» در settings. */
export const ROUNDING_DEFAULTS = {
  roundToRials: 100,
  /** Phase 22: جهت گِرد کردن معادل ۷۵۰ (سه رقم اعشار). گام وزن دیگر وجود ندارد. */
  gramsRoundingMode: DEFAULT_ROUNDING_MODE,
};

export class PriceRateValidationError extends Error {
  constructor(fieldErrors) {
    super('نرخ روز واردشده نامعتبر است.');
    this.name = 'PriceRateValidationError';
    this.fieldErrors = fieldErrors;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function validate(input) {
  const errors = {};
  if (!(num(input.ratePerGram18k) > 0)) {
    errors.ratePerGram18k = 'نرخ هر گرم طلای ۷۵۰ باید بزرگ‌تر از صفر باشد.';
  }
  for (const [field, label] of [
    ['defaultWagePercent', 'اجرت پیش‌فرض'],
    ['defaultProfitPercent', 'سود پیش‌فرض'],
    ['defaultTaxPercent', 'مالیات پیش‌فرض'],
    ['meltedFeePercent', 'کارمزد آبشده'],
  ]) {
    const v = num(input[field]);
    if (v < 0) errors[field] = `${label} نمی‌تواند منفی باشد.`;
    if (v > 100) errors[field] = `${label} نمی‌تواند بیش از ۱۰۰ درصد باشد.`;
  }
  for (const [karat, rate] of Object.entries(input.karatRates || {})) {
    if (!isValidFineness(karat)) errors.karatRates = `عیار «${karat}» نامعتبر است (عدد صحیح ۱ تا ۱۰۰۰).`;
    else if (num(rate) < 0) errors.karatRates = `نرخ عیار ${karat} نمی‌تواند منفی باشد.`;
  }
  if (Object.keys(errors).length) throw new PriceRateValidationError(errors);
}

/**
 * ترتیب قطعی نرخ‌ها: تاریخ اثر ← زمان ثبت ← شماره‌ی ترتیبی.
 *
 * چرا `seq` لازم شد (کشف‌شده در Phase 10 توسط تست، نه بازبینی چشمی): اگر کاربر نرخی را
 * ثبت کند و بلافاصله اصلاحش کند، هر دو رکورد می‌توانند **همان میلی‌ثانیه** را در
 * `effectiveDate` و `createdAt` داشته باشند. آن‌وقت مرتب‌سازی به ترتیبِ خواندن از
 * IndexedDB تکیه می‌کرد که بر اساس `id` تصادفی است — یعنی «نرخ روز» می‌توانست بین دو
 * بارگذاری برنامه عوض شود. `seq` یک شمارنده‌ی صعودی است و این ابهام را برای همیشه می‌بندد:
 * **آخرین نرخی که وارد شده برنده است.**
 * (فیلد جدید Index نمی‌شود ⇒ `DB_VERSION` تغییر نکرد. رکوردهای قدیمی `seq` ندارند و صفر
 * در نظر گرفته می‌شوند؛ ترتیب‌شان همچنان از تاریخ می‌آید که برای داده‌ی واقعی کافی است.)
 */
function compareRates(a, b) {
  return (
    String(a.effectiveDate || '').localeCompare(String(b.effectiveDate || '')) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
    (num(a.seq) - num(b.seq))
  );
}

/** آخرین نرخ ثبت‌شده (تازه‌ترین `effectiveDate`) یا null اگر هنوز نرخی ثبت نشده. */
export async function getCurrentRate() {
  const all = await getAll('priceRates');
  if (!all.length) return null;
  return all.slice().sort(compareRates).pop();
}

/**
 * نرخ‌های دستی عیار با کلید **هزاری**. رکورد نرخ پیش از v10 (Append-only، دست‌نخورده)
 * کلید ۲۴تایی دارد (`'21'`) و فقط هنگام خواندن ترجمه می‌شود (`'875'`).
 */
export function karatRatesOf(rate) {
  const raw = rate?.karatRates ?? {};
  if (isCurrentUnitsDoc(rate)) return { ...raw };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(legacyKaratToFineness(Number(k))), v]));
}

/** تاریخچه نرخ‌ها، تازه‌ترین اول. */
export async function listRateHistory({ limit = 50 } = {}) {
  const all = await getAll('priceRates');
  return all
    .slice()
    .sort((a, b) => compareRates(b, a))
    .slice(0, limit);
}

/**
 * ثبت نرخ روز جدید — **همیشه رکورد جدید**، هرگز ویرایش رکورد قبلی.
 * رکورد `auditLog` در همان IndexedDB Transaction نوشته می‌شود (اتمیک).
 */
export async function setDailyRate(input = {}) {
  validate(input);

  const now = nowIso();
  const existing = await getAll('priceRates');
  const nextSeq = existing.reduce((max, r) => Math.max(max, num(r.seq)), 0) + 1;
  const record = {
    id: generateId(),
    // Phase 22: کلیدهای karatRates هزاری‌اند.
    unitsVersion: UNITS_VERSION,
    seq: nextSeq,
    effectiveDate: input.effectiveDate ? new Date(input.effectiveDate).toISOString() : now,
    ratePerGram18k: num(input.ratePerGram18k),
    karatRates: Object.fromEntries(
      Object.entries(input.karatRates || {})
        .filter(([, v]) => num(v) > 0)
        .map(([k, v]) => [String(Number(k)), num(v)])
    ),
    defaultWagePercent: num(input.defaultWagePercent),
    defaultProfitPercent: num(input.defaultProfitPercent),
    defaultTaxPercent: num(input.defaultTaxPercent),
    meltedFeePercent: num(input.meltedFeePercent),
    note: String(input.note ?? '').trim(),
    createdAt: now,
  };

  await runTransaction(['priceRates', 'auditLog'], 'readwrite', (tx) => {
    tx.objectStore('priceRates').add(record);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'priceRates',
      entityId: record.id,
      action: 'create',
      before: null,
      after: record,
      timestamp: now,
    });
  });

  return record;
}

/** بخش گِردکردن از `settings` (با پیش‌فرض‌های امن). */
export async function getRoundingSettings() {
  const settings = await get('settings', SETTINGS_ID);
  return {
    roundToRials: settings?.roundToRials ?? ROUNDING_DEFAULTS.roundToRials,
    gramsRoundingMode: normalizeRoundingMode(settings?.gramsRoundingMode ?? ROUNDING_DEFAULTS.gramsRoundingMode),
  };
}

/**
 * پیکربندی مؤثر موتور قیمت = آخرین نرخ روز + تنظیمات گِردکردن.
 * **تنها راه ساختن پیکربندی موتور در کل برنامه** — هیچ سرویس یا صفحه‌ای نباید
 * خودش نرخ و گام گِردکردن را از دیتابیس بخواند و کنار هم بگذارد.
 */
export async function getPricingConfig() {
  const [rate, rounding] = await Promise.all([getCurrentRate(), getRoundingSettings()]);
  return normalizeConfig({
    ...DEFAULT_PRICING_CONFIG,
    ratePerGram18k: rate?.ratePerGram18k ?? 0,
    karatRates: karatRatesOf(rate),
    meltedFeePercent: rate?.meltedFeePercent ?? 0,
    defaultWagePercent: rate?.defaultWagePercent ?? 0,
    defaultProfitPercent: rate?.defaultProfitPercent ?? 0,
    defaultTaxPercent: rate?.defaultTaxPercent ?? 0,
    rateSourceId: rate?.id ?? null,
    ...rounding,
  });
}
