// goldTotals.js — جمع‌های «گرم معادل ۷۵۰» یک سند (Phase 19)
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل:
// از Phase 19 واحد رسمی مانده‌ی طرف حساب **گرم عیار ۷۵۰** است، نه ریال. موتور
// معادل طلایی (services/goldEquivalent.js) از Phase 18 اجزای هر قلم را می‌ساخت
// ولی فقط برای «نمای برگه». این فایل همان موتور را به سطح سند می‌برد تا هر سه
// مصرف‌کننده — فرم (نوار جمع زنده)، سرویس ثبت (دفتر) و برگه — دقیقاً یک عدد
// ببینند. هیچ فرمول دومی جایی نوشته نمی‌شود.
//
// ── قاعده‌ی «فی فقط وقتی لازم است که ریال در کار باشد» ──
// هر چیزی که در اصل درصدی روی طلاست (اجرت درصدی، سود، کارمزد تبدیل، مالیات)
// بدون هیچ نرخی به گرم حساب می‌شود. فقط سه چیز از مسیر «فی» عبور می‌کنند:
//   ۱) اجرت مبلغی (ریال بر گرم)
//   ۲) تخفیف ریالی
//   ۳) خط تسویه‌ی نقدی (وجه نقد/بانک/کارتخوان)
// به همین دلیل یک سند **رسیدی** که اجرتش درصدی است اصلاً فی نمی‌خواهد — دقیقاً
// همان چیزی که کاربر در کار واقعی‌اش انجام می‌دهد: «۱۰ گرم با ۱۲٫۵ درصد اجرت».
//
// این فایل **خالص** است: نه IndexedDB، نه UI.
// ═══════════════════════════════════════════════════════════════════════════

import {
  goldLineParts,
  goldSettlementParts,
  sumGrams,
  irrToBaseGrams,
  baseGramsToIrr,
} from './goldEquivalent.js';
import { toNumber } from '../utils/decimal.js';
import {
  BASE_FINENESS,
  GRAM_DECIMALS as UNITS_GRAM_DECIMALS,
  GRAM_EPS as UNITS_GRAM_EPS,
  CURRENT_UNITS,
  currentUnits,
  equivalent750,
  roundGrams750,
  normalizeGrams,
} from './units.js';

/** واحد رسمی مانده: گرم عیار ۷۵۰ با سه رقم اعشار (Phase 22). */
export const BASE_KARAT_750 = BASE_FINENESS;
export const GRAM_DECIMALS = UNITS_GRAM_DECIMALS;

/** تلورانس مقایسه‌ی وزن معادل: نیمِ آخرین رقم معنادار (۰٫۰۰۰۵ گرم). */
export const GRAM_EPS = UNITS_GRAM_EPS;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** پروفایل واحد اسناد جدید با حالت گِرد کردنِ پیکربندی (settings.gramsRoundingMode). */
export function unitsForConfig(config = {}) {
  return currentUnits(typeof config === 'object' && config ? config.gramsRoundingMode : undefined);
}

/**
 * نرمال‌سازی جمع/تفاضل گرم‌هایی که از قبل گرد شده‌اند (سه رقم، پاک‌کردن صفر منفی).
 * این **قاعده‌ی کسب‌وکار نیست** — گِرد کردن رو به بالا فقط یک بار، روی هر مقدار
 * محاسبه‌شده انجام می‌شود (roundGrams750)؛ اینجا فقط نوفه‌ی ممیز شناور پاک می‌شود.
 */
export function roundBaseGrams(value) {
  return normalizeGrams(value);
}

/** آیا این وزن معادل عملاً صفر است. */
export function isZeroGrams(value) {
  return Math.abs(num(value)) < GRAM_EPS;
}

/** جمع چند وزن معادلِ از قبل گِردشده (ردیف‌به‌ردیف). */
export function addGrams(values) {
  const n = sumGrams(values);
  return n === 0 ? 0 : n;
}

/** وزن ترازو × عیار ÷ ۷۵۰ → گرم ۷۵۰ (گِردشده با قاعده‌ی مرکزی). */
export function baseGramsOf(weightGrams, karat, units = CURRENT_UNITS) {
  return equivalent750(weightGrams, karat, units);
}

/** ریال → گرم ۷۵۰ با فیِ سند (گِردشده با قاعده‌ی مرکزی). فی صفر ⇒ `null`. */
export function gramsOfIrr(amountIRR, rate, units = CURRENT_UNITS) {
  const g = irrToBaseGrams(amountIRR, rate);
  return g === null ? null : roundGrams750(g, units);
}

/** گرم ۷۵۰ → ریال با یک فی (برای نمایش معادل ریالی؛ هرگز منبع حقیقت نیست). */
export function irrOfGrams(grams, rate) {
  if (num(rate) <= 0) return 0;
  return Math.round(toNumber(baseGramsToIrr(num(grams), num(rate)), 0));
}

/**
 * فیِ مؤثر یک سند: فیِ دستیِ خودِ سند، وگرنه نرخ روز (ریال هر گرم ۷۵۰) پیکربندی.
 * صفر یعنی «هیچ نرخی در دست نیست» — و این **خطا نیست**، تا وقتی که سند هیچ
 * جزء ریالی نداشته باشد.
 */
export function effectiveRate(input = {}, config = {}) {
  const own = num(input.ratePerBaseGram);
  if (own > 0) return own;

  // ترتیب عمدی: نرخ **خودِ اقلام سند** بر نرخ روز مقدم است.
  // دلیل: اگر کاربر برای قلمی نرخ دستی گذاشته باشد، مبلغ ریالی سند با همان نرخ
  // ساخته شده؛ تبدیل بخش نقدیِ همان سند با نرخ روزِ متفاوت، جمع گرمی و جمع
  // ریالی را واگرا می‌کرد و یک سند کاملاً تسویه‌شده «ترکیبی» دیده می‌شد.
  // وقتی کاربر نرخ قلم را وارد نکرده باشد، لایه‌ی بالاتر پیشاپیش نرخ روز را در
  // همان قلم نشانده است، پس این دو مسیر در حالت عادی یک عدد می‌دهند.
  for (const line of input.lines || []) {
    const r = num(line.ratePerGram);
    const k = num(line.karat);
    if (r > 0 && k > 0) return Math.round((r * BASE_KARAT_750) / k);
  }
  const cfg = num(config?.ratePerGram18k);
  if (cfg > 0) return cfg;
  for (const entry of input.receipts || input.payments || []) {
    const r = num(entry.ratePerGram);
    const k = num(entry.karat);
    if (r > 0 && k > 0) return Math.round((r * BASE_KARAT_750) / k);
  }
  return 0;
}

/**
 * جمع‌های گرمی یک سند خرید/فروش.
 *
 * @param {object} doc `{ lines, settlements }` — `lines` خروجی pricing.computeDocument
 *   (چون `discountShareIRR` و درصدها را دارد) و `settlements` خطوط دریافت/پرداخت.
 * @param {object} opts `{ rate, mode }` — mode: 'sale' | 'purchase'
 * @returns {object} اجزای هر قلم/خط + جمع‌ها + پرچم `needsRate` با دلیل دقیقش
 */
export function documentGoldTotals({ lines = [], settlements = [] } = {}, { rate = 0, mode = 'sale', units = CURRENT_UNITS } = {}) {
  const opts = { rate: num(rate), units: units || CURRENT_UNITS, mode };
  const reasons = new Set();

  const lineParts = lines.map((line) => {
    const parts = goldLineParts(line, opts);
    if (parts.needsRate) {
      if (line.wageType === 'perGram' && num(line.wageValue) > 0) reasons.add('wagePerGram');
      if (num(line.discountShareIRR) > 0) reasons.add('discount');
    }
    return parts;
  });

  const settlementParts = settlements.map((entry) => {
    const parts = goldSettlementParts(entry, opts);
    if (parts.needsRate) reasons.add('cashSettlement');
    return parts;
  });

  const totalBaseGrams = addGrams(lineParts.map((p) => p.baseGrams));
  const totalWageGrams = addGrams(lineParts.map((p) => p.wageGrams));
  const totalMeltFeeGrams = addGrams(lineParts.map((p) => p.meltFeeGrams));
  const totalProfitGrams = addGrams(lineParts.map((p) => p.profitGrams));
  const totalDiscountGrams = addGrams(lineParts.map((p) => p.discountShareGrams));
  const totalTaxGrams = addGrams(lineParts.map((p) => p.taxGrams));
  const grandTotalGrams = addGrams(lineParts.map((p) => p.totalGrams));

  // ── قاعده‌ی «پرداخت کامل» (Phase 22) ──
  // اگر جمع ریالیِ تسویه‌ها دقیقاً برابر مبلغ ریالی سند باشد و اختلاف گرمی فقط از
  // گِرد کردن باشد (حداکثر دو سوت)، اختلاف روی آخرین خط نقدی می‌نشیند تا سند نقدی
  // دقیقاً صفر شود — همان قاعده‌ی «برگشت کامل» Phase 7. بدون آن، فاکتوری که با
  // همان مبلغ ریالی‌اش پرداخت شده، به‌خاطر نرخِ گِردشده‌ی سند یک سوت «بیش‌پرداخت» یا
  // «بدهکار» دیده می‌شد. طلا در برابر طلا هرگز تنظیم نمی‌شود (وزنش دقیق است).
  const linesIRR = lines.reduce((s, l) => s + num(l.lineTotalIRR), 0);
  const settledIRR = settlements.reduce((s, e) => s + num(e.valueIRR ?? e.amountIRR), 0);
  if (linesIRR > 0 && Math.abs(linesIRR - settledIRR) < 1 && !reasons.size) {
    const provisional = roundBaseGrams(
      addGrams(lineParts.map((p) => p.totalGrams)) - addGrams(settlementParts.map((p) => p.totalGrams))
    );
    const lastCash = [...settlementParts].reverse().find((p) => p.isCash);
    if (lastCash && provisional !== 0 && Math.abs(provisional) <= 0.002 + GRAM_EPS) {
      lastCash.totalGrams = roundBaseGrams(lastCash.totalGrams + provisional);
      lastCash.baseGrams = lastCash.totalGrams;
      lastCash.closingAdjustmentGrams = provisional;
    }
  }

  const settledGrams = addGrams(settlementParts.map((p) => p.totalGrams));
  const settledGoldGrams = addGrams(settlementParts.filter((p) => !p.isCash).map((p) => p.totalGrams));
  const settledCashGrams = addGrams(settlementParts.filter((p) => p.isCash).map((p) => p.totalGrams));

  return {
    rate: num(rate),
    lineParts,
    settlementParts,
    totalBaseGrams,
    totalWageGrams,
    totalMeltFeeGrams,
    totalProfitGrams,
    totalDiscountGrams,
    totalTaxGrams,
    grandTotalGrams,
    settledGrams,
    settledGoldGrams,
    settledCashGrams,
    remainingGrams: roundBaseGrams(grandTotalGrams - settledGrams),
    needsRate: reasons.size > 0,
    rateReasons: [...reasons],
  };
}

/**
 * پیکربندی مؤثر قیمت برای یک سند: اگر کاربر «فیِ سند» را وارد کرده باشد، همان
 * فی نرخ پایه‌ی محاسبات ریالی سند هم هست.
 *
 * چرا لازم است (اشکالی که در بازبینی فرم دیده شد): بدون این کار یک سند دو نرخ
 * داشت — فی برای تبدیل گرمی و نرخ روز برای مبلغ ریالی — و پرداختی که مانده‌ی
 * گرمی را دقیقاً صفر می‌کرد، در ستون ریالی هنوز بدهی نشان می‌داد.
 */
export function documentPricingConfig(input = {}, config = {}) {
  const own = num(input.ratePerBaseGram);
  if (own <= 0) return config;
  const base = typeof config === 'number' ? {} : config || {};
  return { ...base, ratePerGram18k: own };
}

/**
 * اجزای گرمی یک خط تسویه‌ی مستقل (دریافت/پرداخت خارج از فاکتور).
 * خط طلا هیچ نرخی نمی‌خواهد؛ خط نقدی فقط با فیِ سند به گرم تبدیل می‌شود.
 */
export function goldSettlementPartsOf(entry, rate, units = CURRENT_UNITS) {
  return goldSettlementParts(entry, { rate: num(rate), units });
}

/** پیام فارسی «چرا این سند فی می‌خواهد» — همان‌جا که خطا نشان داده می‌شود. */
export function rateRequirementMessage(reasons = []) {
  const parts = [];
  if (reasons.includes('wagePerGram')) parts.push('اجرت مبلغی');
  if (reasons.includes('discount')) parts.push('تخفیف ریالی');
  if (reasons.includes('cashSettlement')) parts.push('تسویه‌ی نقدی');
  if (!parts.length) return 'برای این سند «فی» لازم است.';
  return `این سند ${parts.join(' و ')} دارد؛ برای تبدیل آن به گرم، «فیِ سند» را وارد کنید.`;
}
