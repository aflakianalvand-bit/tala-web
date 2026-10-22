// settlement.js — قواعد مشترک «خط تسویه» (پرداخت به تأمین‌کننده / دریافت از مشتری)
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل در Phase 7 استخراج شد:
// خط پرداخت در سند خرید (Phase 6) و خط دریافت در فاکتور فروش (Phase 7) دقیقاً یک
// ساختار دارند: یا وجه است (حساب + مبلغ) یا طلا (نوع/عیار/وزن/نرخ ارزش‌گذاری)، با
// همان اعتبارسنجی و همان فرمول ارزش. تنها تفاوت‌شان جهت جریان و واژگان فارسی است.
// نگهداشتن دو نسخه یعنی دو جای مستقل برای اصلاح یک قانون مالی — همان اشتباهی که در
// Phase 5 برای مشتری/تأمین‌کننده رفع شد (ARCHITECTURE §4.1: تفاوت‌ها داده باشند، نه کد).
// ═══════════════════════════════════════════════════════════════════════════

import { isValidFineness, isValidScaleWeight, FINENESS_ERROR, WEIGHT_DECIMALS_ERROR } from './units.js';
import { computeGoldPaymentValue, roundAmount } from './pricing.js';
import { labNameFor, labNameError } from './labs.js';

export const SETTLEMENT_METHODS = ['cash', 'gold'];
export const SETTLEMENT_GOLD_TYPES = ['manufactured', 'melted', 'misc'];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isPositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** ورودی خام فرم → شکل استاندارد خط تسویه. */
export function normalizeSettlement(raw = {}) {
  const method = SETTLEMENT_METHODS.includes(raw.method) ? raw.method : null;
  if (method === 'gold') {
    return {
      method,
      accountId: null,
      amountIRR: 0,
      goldType: SETTLEMENT_GOLD_TYPES.includes(raw.goldType) ? raw.goldType : null,
      karat: num(raw.karat),
      weightGrams: num(raw.weightGrams),
      ratePerGram: num(raw.ratePerGram),
      productId: raw.productId || null,
      // Phase 23: نام آزمایشگاه (فقط آبشده/متفرقه؛ اختیاری؛ Snapshot در سند).
      labName: labNameFor(raw.goldType, raw.labName),
      description: String(raw.description ?? '').trim(),
    };
  }
  return {
    method,
    accountId: raw.accountId || null,
    amountIRR: num(raw.amountIRR),
    goldType: null,
    karat: 0,
    weightGrams: 0,
    ratePerGram: 0,
    productId: null,
    labName: null,
    description: String(raw.description ?? '').trim(),
  };
}

/**
 * اعتبارسنجی ساختاری یک خط تسویه (بدون دسترسی به دیتابیس).
 * @param {object} entry خروجی normalizeSettlement
 * @param {string} label واژه‌ی دامنه برای پیام‌ها: «پرداخت» یا «دریافت»
 * @returns {object} نگاشت field → پیام (خالی یعنی معتبر)
 */
export function validateSettlement(entry, label = 'پرداخت') {
  const errors = {};
  if (!entry.method) {
    errors.method = `روش ${label} نامعتبر است.`;
    return errors;
  }
  if (entry.method === 'cash') {
    if (!entry.accountId) errors.accountId = `حساب ${label} را انتخاب کنید.`;
    if (!isPositive(entry.amountIRR)) errors.amountIRR = `مبلغ ${label} باید بزرگ‌تر از صفر باشد.`;
    return errors;
  }
  if (!entry.goldType) errors.goldType = 'نوع طلا نامعتبر است.';
  if (!isValidFineness(entry.karat)) errors.karat = FINENESS_ERROR;
  if (!isPositive(entry.weightGrams)) errors.weightGrams = 'وزن طلا باید بزرگ‌تر از صفر باشد.';
  else if (!isValidScaleWeight(entry.weightGrams)) errors.weightGrams = WEIGHT_DECIMALS_ERROR;
  const labError = labNameError(entry.labName);
  if (labError) errors.labName = labError;
  // (Phase 19) نرخ ارزش‌گذاری طلا دیگر الزامی نیست: طلا در برابر طلا از مسیر «فی»
  // عبور نمی‌کند — وزن معادل ۷۵۰ مستقیماً از بدهی کم می‌شود. نرخ فقط برای نمایش
  // معادل ریالی این خط به کار می‌رود، و نبودش هیچ عددی را نامعلوم نمی‌گذارد.
  return errors;
}

/** ارزش ریالی خط تسویه (برای طلا: وزن × نرخ توافقی — Snapshot همان لحظه). */
export function settlementValue(entry, roundTo = 0) {
  return entry.method === 'gold'
    ? computeGoldPaymentValue(entry, roundTo)
    : roundAmount(entry.amountIRR, roundTo);
}
