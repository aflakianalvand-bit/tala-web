// pricing.js — موتور قیمت طلا (Pricing Engine) — Phase 8
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل **مستقل و خالص** است: هیچ دسترسی‌ای به IndexedDB، UI یا دفاتر ندارد.
// ورودی می‌گیرد و عدد برمی‌گرداند. به همین دلیل با تست عددی مستقیم قابل اثبات
// است و هر سه مصرف‌کننده (خرید، فروش، UI) دقیقاً یک عدد می‌بینند.
//
// تمام محاسبات با utils/decimal.js (BigInt، بدون ممیز شناور) انجام می‌شود.
//
// ── فرمول استخراج‌شده از BUSINESS_RULES §1/§8 و PRICING_RULES §1 ──
//
//   وزن محاسباتی = گِردکردن وزن ترازو به مضرب گام وزن (پیش‌فرض ۰٫۰۵ گرم)
//   نرخ هر گرم   = نرخ روز ۱۸ عیار × (عیار ÷ ۱۸)      [یا نرخ دستی همان قلم]
//   قیمت پایه طلا = وزن محاسباتی × نرخ هر گرم
//   اجرت          = درصدی: قیمت پایه × درصد        | گرمی: مبلغ × وزن محاسباتی
//   کارمزد تبدیل  = فقط آبشده/متفرقه در **فروش**: قیمت پایه × درصد کارمزد
//   سود           = (قیمت پایه + اجرت) × درصد سود        [فقط ساخته‌شده، فقط فروش]
//   ─ جمع پیش از تخفیف = قیمت پایه + اجرت + کارمزد + سود
//   تخفیف         = مبلغ، سطح کل فاکتور، **پیش از مالیات**، سرشکن به نسبت اقلام
//   مالیات        = (جمع قلم − سهم تخفیف) × درصد مالیات
//   مبلغ نهایی قلم = گِردکردن(جمع پس از تخفیف + مالیات) به گام ریالی
//   مبلغ فاکتور   = Σ مبلغ نهایی اقلام
//
// ── تصمیمات قطعی‌شده در Phase 8 (پرسیده‌شده از کاربر) ──
//   ۱) نرخ عیار: یک نرخ پایه ۱۸ عیار + تبدیل تناسبی؛ Override دستی مجاز.
//   ۲) واحد نرخ روز: ریال به ازای هر گرم طلای ۱۸ عیار.
//   ۳) وزن: گِردکردن به نزدیک‌ترین مضرب ۰٫۰۵ گرم، و این وزن **هم مبنای قیمت
//      و هم مبنای موجودی** است (نه دو عدد متفاوت).
//   ۴) ریال: فقط **مبلغ نهایی هر قلم** گرد می‌شود؛ اجزای میانی با دقت کامل
//      محاسبه و فقط برای ذخیره به ریال صحیح تبدیل می‌شوند.
//   ۵) کارمزد تبدیل آبشده/متفرقه: درصد قابل تنظیم.
// ═══════════════════════════════════════════════════════════════════════════

import {
  BASE_FINENESS,
  DEFAULT_ROUNDING_MODE,
  UNITS_VERSION,
  normalizeRoundingMode,
  scaleWeight,
} from './units.js';
import {
  d,
  add,
  sub,
  mul,
  div,
  cmp,
  sum,
  percentOf,
  roundToStep,
  roundToUnit,
  toNumber,
} from '../utils/decimal.js';

export const WAGE_TYPES = ['percent', 'perGram'];

export const WAGE_TYPE_LABELS = {
  percent: 'درصدی',
  perGram: 'مبلغ به ازای هر گرم',
};

/**
 * عیار مبنای نرخ روز — Phase 22: ریال هر گرم **۷۵۰** (عیار هزاری).
 * نام فیلد `ratePerGram18k` برای سازگاری با Snapshot اسناد قدیمی حفظ شده؛ ۱۸ عیار
 * همان ۷۵۰ است، پس مقدار عددی نرخ عوض نمی‌شود.
 */
export const BASE_KARAT = BASE_FINENESS;

/** پیکربندی موتور — همان چیزی که در هر سند Snapshot می‌شود. */
export const DEFAULT_PRICING_CONFIG = {
  /** نرخ روز هر گرم طلای ۷۵۰ (ریال). */
  ratePerGram18k: 0,
  /** نرخ دستی بعضی عیارها (اختیاری، کلید هزاری): `{ '875': 1200000 }` — بر تبدیل تناسبی مقدم است. */
  karatRates: {},
  /** درصد کارمزد تبدیل برای آبشده/متفرقه (فقط در فروش). */
  meltedFeePercent: 0,
  /** درصدهای پیش‌فرض فرم‌ها (مقدار نهایی هر قلم در خود سند Snapshot می‌شود). */
  defaultWagePercent: 0,
  defaultProfitPercent: 0,
  defaultTaxPercent: 0,
  /** گام گِردکردن مبلغ نهایی هر قلم (ریال). ۰ یا ۱ = فقط ریال صحیح. */
  roundToRials: 100,
  /**
   * Phase 22: گام وزن حذف شد — وزن ترازو با سه رقم اعشار عیناً ثبت می‌شود.
   * این دو فیلد فقط برای خواندن Snapshot اسناد قدیمی باقی مانده‌اند و اثری ندارند.
   */
  roundWeightStep: 0,
  roundWeightMode: 'nearest',
  /** جهت گِرد کردن معادل ۷۵۰ (services/units.js). */
  gramsRoundingMode: DEFAULT_ROUNDING_MODE,
};

/** پیکربندی ورودی را با پیش‌فرض‌ها تکمیل می‌کند (و عدد خام را هم می‌پذیرد). */
export function normalizeConfig(config) {
  // سازگاری با امضای قدیمی: pricing(input, roundToRials)
  if (typeof config === 'number') {
    return { ...DEFAULT_PRICING_CONFIG, roundToRials: config };
  }
  // گام وزن هرگز از پیکربندی خوانده نمی‌شود (Phase 22) — حتی اگر تنظیمات قدیمی آن را داشته باشد.
  return { ...DEFAULT_PRICING_CONFIG, ...(config || {}), roundWeightStep: 0, roundWeightMode: 'nearest' };
}

// ───────────────────────────── نرخ و وزن ─────────────────────────────

/**
 * نرخ هر گرم برای یک عیار مشخص (PRICING_RULES §4).
 * ترتیب اولویت: نرخ دستی همان عیار ← تبدیل تناسبی: نرخ۷۵۰ × عیار ÷ ۷۵۰ (عیار هزاری).
 * @returns {number} ریال به ازای هر گرم (صفر یعنی نرخ روز هنوز ثبت نشده)
 */
export function ratePerGramForKarat(karat, config = {}) {
  const cfg = normalizeConfig(config);
  const k = d(karat);
  if (cmp(k, 0) <= 0) return 0;

  const override = cfg.karatRates?.[String(toNumber(k, 3))] ?? cfg.karatRates?.[String(Number(karat))];
  if (override !== undefined && override !== null && override !== '') {
    return toNumber(roundToUnit(d(override)), 0);
  }

  const base = d(cfg.ratePerGram18k);
  if (cmp(base, 0) <= 0) return 0;
  return toNumber(roundToUnit(div(mul(base, k), BASE_KARAT)), 0);
}

/**
 * وزن محاسباتی = **وزن ترازو عیناً** (Phase 22؛ گام ۰٫۰۵ حذف شد).
 * فقط نوفه‌ی ممیز شناور در سه رقم اعشار پاک می‌شود؛ رقم چهارم را اعتبارسنجی رد
 * می‌کند (units.isValidScaleWeight)، پس اینجا هیچ وزن واقعی‌ای گرد نمی‌شود.
 * نام تابع برای سازگاری با مصرف‌کننده‌های قبلی حفظ شده است.
 */
export function roundWeight(weightGrams) {
  return scaleWeight(weightGrams);
}

/** گِردکردن یک مبلغ ریالی به گام تنظیم‌شده (فقط برای مبلغ نهایی قلم). */
export function roundAmount(value, config = {}) {
  const cfg = normalizeConfig(config);
  const step = Number(cfg.roundToRials) || 0;
  return toNumber(step > 1 ? roundToStep(d(value), step) : roundToUnit(d(value)), 0);
}

// ─────────────────────────── محاسبه یک قلم ───────────────────────────

function wageAmount(line, goldPrice, weight) {
  if (line.goldType !== 'manufactured') return 0n;
  const value = d(line.wageValue);
  return line.wageType === 'perGram' ? mul(value, weight) : percentOf(goldPrice, value);
}

/**
 * اجزای مبلغ یک قلم — **بدون** گِردکردن ریالی (دقت کامل حفظ می‌شود).
 * @param {object} line قلم سند
 * @param {object} config پیکربندی موتور
 * @param {'purchase'|'sale'} mode خرید سود/مالیات/کارمزد/تخفیف ندارد (تصمیم Phase 6)
 * @returns {object} مقادیر داخلی (BigInt) + وزن و نرخ نهایی
 */
export function computeLineParts(line, config = {}, mode = 'sale') {
  const cfg = normalizeConfig(config);
  const isSale = mode === 'sale';
  const isManufactured = line.goldType === 'manufactured';

  const weight = d(roundWeight(line.weightGrams, cfg));
  const rateInput = Number(line.ratePerGram) || 0;
  const rate = d(rateInput > 0 ? rateInput : ratePerGramForKarat(line.karat, cfg));

  const goldPrice = mul(weight, rate);
  const wage = wageAmount({ ...line, goldType: line.goldType }, goldPrice, weight);

  // کارمزد تبدیل: فقط آبشده/متفرقه و فقط در فروش (PRICING_RULES §2)
  const meltFee =
    isSale && !isManufactured ? percentOf(goldPrice, d(line.meltFeePercent ?? cfg.meltedFeePercent)) : 0n;

  // سود فقط برای ساخته‌شده و فقط در فروش (BUSINESS_RULES §8، تصمیم Phase 6)
  const profit = isSale && isManufactured ? percentOf(add(goldPrice, wage), d(line.profitPercent)) : 0n;

  const subtotal = sum([goldPrice, wage, meltFee, profit]);

  return {
    weightGrams: toNumber(weight, 3),
    ratePerGram: toNumber(rate, 0),
    goldPrice,
    wage,
    meltFee,
    profit,
    subtotal,
    taxPercent: isSale ? d(line.taxPercent) : 0n,
  };
}

// ────────────────────── محاسبه کل سند (Document) ──────────────────────

/**
 * محاسبه‌ی کامل یک سند: سرشکن‌کردن تخفیف، مالیات پس از تخفیف و مبلغ نهایی.
 *
 * سرشکن‌کردن تخفیف لازم است چون درصد مالیات هر قلم می‌تواند متفاوت باشد؛
 * مانده‌ی گِردکردن عمداً به قلم آخر می‌رود تا Σ سهم اقلام **دقیقاً** برابر
 * تخفیف واردشده بماند.
 *
 * @returns {{lines: Array, totals: object}} همه‌ی مقادیر به‌صورت Number آماده‌ی ذخیره
 */
export function computeDocument({ lines = [], discountIRR = 0 } = {}, config = {}, mode = 'sale') {
  const cfg = normalizeConfig(config);
  const isSale = mode === 'sale';

  const parts = lines.map((line) => computeLineParts(line, cfg, mode));
  const subtotalTotal = sum(parts.map((p) => p.subtotal));

  const requestedDiscount = isSale ? roundToUnit(d(discountIRR)) : 0n;
  const effectiveDiscount = cmp(requestedDiscount, subtotalTotal) > 0 ? subtotalTotal : requestedDiscount;

  let allocated = 0n;
  const pricedLines = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const share = isLast
      ? sub(effectiveDiscount, allocated)
      : cmp(subtotalTotal, 0) > 0
        ? roundToUnit(div(mul(effectiveDiscount, p.subtotal), subtotalTotal))
        : 0n;
    allocated = add(allocated, share);

    const taxable = sub(p.subtotal, share);
    const tax = percentOf(taxable, p.taxPercent);
    // تنها نقطه‌ی گِردکردن ریالی سند (تصمیم Phase 8)
    const lineTotal = d(roundAmount(add(taxable, tax), cfg));

    const source = lines[i];
    return {
      ...source,
      weightGrams: p.weightGrams,
      weightGramsRaw: Number(source.weightGrams) || 0,
      ratePerGram: p.ratePerGram,
      goldPriceIRR: toNumber(roundToUnit(p.goldPrice), 0),
      wageIRR: toNumber(roundToUnit(p.wage), 0),
      meltFeeIRR: toNumber(roundToUnit(p.meltFee), 0),
      profitIRR: toNumber(roundToUnit(p.profit), 0),
      subtotalIRR: toNumber(roundToUnit(p.subtotal), 0),
      discountShareIRR: toNumber(roundToUnit(share), 0),
      taxableIRR: toNumber(roundToUnit(taxable), 0),
      taxIRR: toNumber(roundToUnit(tax), 0),
      lineTotalIRR: toNumber(lineTotal, 0),
    };
  });

  const totals = {
    totalGoldPriceIRR: pricedLines.reduce((s, l) => s + l.goldPriceIRR, 0),
    totalWageIRR: pricedLines.reduce((s, l) => s + l.wageIRR, 0),
    totalMeltFeeIRR: pricedLines.reduce((s, l) => s + l.meltFeeIRR, 0),
    totalProfitIRR: pricedLines.reduce((s, l) => s + l.profitIRR, 0),
    totalTaxIRR: pricedLines.reduce((s, l) => s + l.taxIRR, 0),
    subtotalIRR: toNumber(roundToUnit(subtotalTotal), 0),
    discountIRR: toNumber(effectiveDiscount, 0),
    requestedDiscountIRR: toNumber(requestedDiscount, 0),
    grandTotalIRR: pricedLines.reduce((s, l) => s + l.lineTotalIRR, 0),
    totalWeightGrams: toNumber(sum(pricedLines.map((l) => d(l.weightGrams))), 3),
  };

  return { lines: pricedLines, totals };
}

/**
 * Snapshot پارامترهای محاسباتی برای ذخیره در سند (دستور پروژه §11).
 * تغییر بعدی نرخ روز یا تنظیمات، این مقادیر را تغییر نمی‌دهد و بنابراین
 * فاکتورهای گذشته دست‌نخورده می‌مانند.
 */
export function pricingSnapshot(config = {}, mode = 'sale') {
  const cfg = normalizeConfig(config);
  return {
    engineVersion: 'phase22',
    mode,
    unitsVersion: UNITS_VERSION,
    gramsRoundingMode: normalizeRoundingMode(cfg.gramsRoundingMode),
    baseKarat: BASE_KARAT,
    ratePerGram18k: Number(cfg.ratePerGram18k) || 0,
    karatRates: { ...(cfg.karatRates || {}) },
    meltedFeePercent: Number(cfg.meltedFeePercent) || 0,
    roundToRials: Number(cfg.roundToRials) || 0,
    roundWeightStep: Number(cfg.roundWeightStep) || 0,
    roundWeightMode: cfg.roundWeightMode || 'nearest',
    rateSourceId: cfg.rateSourceId || null,
    formula:
      mode === 'sale'
        ? 'gold + wage + meltFee + profit − discount(before tax) + tax'
        : 'gold + wage',
    profitApplied: mode === 'sale',
    taxApplied: mode === 'sale',
  };
}

// ─────────────────── سازگاری با Phase 6/7 (API قبلی) ───────────────────

/** اجزای مبلغ یک قلم خرید — روکش نازک روی موتور جدید. */
export function computePurchaseLineAmounts(line, config = 0) {
  const { lines } = computeDocument({ lines: [line] }, config, 'purchase');
  const l = lines[0];
  return {
    weightGrams: l.weightGrams,
    ratePerGram: l.ratePerGram,
    goldPriceIRR: l.goldPriceIRR,
    wageIRR: l.wageIRR,
    profitIRR: 0,
    taxIRR: 0,
    lineTotalIRR: l.lineTotalIRR,
  };
}

/** اجزای پایه‌ی یک قلم فروش (پیش از تخفیف/مالیات). */
export function computeSaleLineBase(line, config = 0) {
  const p = computeLineParts(line, config, 'sale');
  return {
    goldPriceIRR: toNumber(roundToUnit(p.goldPrice), 0),
    wageIRR: toNumber(roundToUnit(p.wage), 0),
    meltFeeIRR: toNumber(roundToUnit(p.meltFee), 0),
    profitIRR: toNumber(roundToUnit(p.profit), 0),
    subtotalIRR: toNumber(roundToUnit(p.subtotal), 0),
  };
}

/** محاسبه‌ی کل فاکتور فروش (امضای Phase 7 حفظ شده است). */
export function computeSaleAmounts(lines, discountIRR = 0, config = 0) {
  return computeDocument({ lines, discountIRR }, config, 'sale');
}

/** ارزش ریالی یک تسویه‌ی طلایی: وزن (گِردشده) × نرخ توافقی همان لحظه. */
export function computeGoldPaymentValue({ weightGrams, ratePerGram }, config = 0) {
  const cfg = normalizeConfig(config);
  const weight = d(roundWeight(weightGrams, cfg));
  return roundAmount(mul(weight, d(ratePerGram)), cfg);
}
