// goldEquivalent.js — موتور معادل طلایی (گرم عیار پایه) — Phase 18
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل:
// برگه‌ی سند در این کسب‌وکار (نمونه‌ی ارائه‌شده) هیچ عدد ریالی ندارد؛ همه‌چیز به
// «گرم معادل ۷۵۰» و بستانکار/بدهکار خوانده می‌شود:
//
//     وزن معادل  = وزن ترازو × عیار ÷ عیار پایه
//     اجرت درصدی = وزن معادل × درصد اجرت           ← **بدون نیاز به نرخ**
//     سود درصدی  = (وزن معادل + اجرت) × درصد سود   ← بدون نیاز به نرخ
//     مالیات     = (جمع قلم − سهم تخفیف) × درصد    ← بدون نیاز به نرخ
//     اجرت مبلغی / تخفیف ریالی / وجه نقد = مبلغ ÷ فیِ همان سند  ← **نیازمند نرخ**
//
// نکته‌ی طراحی که عمداً رعایت شده: هر چیزی که در اصل «درصدی روی طلا» است با
// خودِ طلا حساب می‌شود، نه با رفت‌وبرگشت از ریال. اگر همه‌چیز از مسیر ریال
// می‌رفت، یک قلم با نرخ دستیِ متفاوت (Override قلم) معادل طلایی غلط می‌گرفت و
// عددی که کاربر روی برگه می‌بیند با درصدی که خودش وارد کرده نمی‌خواند.
//
// قاعده‌ی گِردکردن (استخراج‌شده از خودِ نمونه):
//     ۱۲٫۶۸ × ۱۲٫۵٪ = ۱٫۵۸۵ → ۱٫۵۹
//      ۸٫۴۴ × ۱۲٫۵٪ = ۱٫۰۵۵ → ۱٫۰۶
//     مجموع درصد = ۲٫۶۵  (نه ۲٫۶۴ که از ۲۱٫۱۲ × ۱۲٫۵٪ می‌آمد)
// یعنی **هر ردیف جداگانه گرد می‌شود، بعد جمع** — نه برعکس. این تفاوت روی یک
// سند دو قلمی یک سوت است، ولی روی یک دفتر سالانه انباشته می‌شود و مانده‌ی
// برگه با مانده‌ی برنامه واگرا می‌شود.
//
// تمام محاسبات روی utils/decimal.js (BigInt) انجام می‌شود، نه ممیز شناور.
// این فایل **خالص** است: نه به IndexedDB دسترسی دارد، نه به UI.
// ═══════════════════════════════════════════════════════════════════════════

// ── Phase 22: پروفایل واحد ──
// عیار پایه، دقت و جهت گِرد کردن دیگر ثابت این فایل نیستند؛ از «پروفایل واحد» سند
// می‌آیند (services/units.js). سند جدید: عیار هزاری، پایه‌ی ۷۵۰، سه رقم، رو به بالا.
// سند قدیمی: عیار ۲۴تایی، پایه‌ی ۱۸، دو رقم، نصف به بالا — تا برگه و مانده‌ی
// اسناد قدیمی بیت‌به‌بیت همان بماند. هر تابع زیر `units` می‌گیرد؛ پیش‌فرض = سند جدید.

import { d, add, sub, mul, div, sum, percentOf, toNumber, cmp } from '../utils/decimal.js';
import {
  CURRENT_UNITS,
  BASE_FINENESS,
  GRAM_DECIMALS,
  roundGramsDecimal,
  equivalent750Raw,
  karatMilleOf,
  normalizeGrams,
} from './units.js';

/** عیار پایه‌ی برگه برای اسناد جدید: ۷۵۰ در هزار. */
export const SHEET_BASE_KARAT = BASE_FINENESS;

/** تعداد اعشار وزن روی برگه‌ی اسناد جدید (Phase 22: سه رقم). */
export const SHEET_DECIMALS = GRAM_DECIMALS;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function unitsFrom(opts = {}) {
  return opts.units || CURRENT_UNITS;
}

/** عیار ۱..۲۴ → عیار در هزار (فقط برای خواندن اسناد قدیمی؛ ۱۸ → ۷۵۰، ۲۴ → ۱۰۰۰). */
export function karatToMille(karat) {
  const k = num(karat);
  if (k <= 0) return 0;
  return Math.round((k / 24) * 1000);
}

/** عیار در هزار → عیار ۱..۲۴ (۷۵۰ → ۱۸). */
export function milleToKarat(mille) {
  return (num(mille) / 1000) * 24;
}

/** گِرد کردن یک وزن معادل با قاعده‌ی پروفایل (سند جدید: ۰٫۰۰۱ رو به بالا). */
export function roundSheetGrams(value, units = CURRENT_UNITS) {
  return roundGramsDecimal(value, units);
}

/** خروجی نهایی به Number با دقت پروفایل. */
export function gramsOut(value, units = CURRENT_UNITS) {
  return toNumber(roundSheetGrams(value, units), units.decimals);
}

/**
 * وزن ترازو → وزن معادل عیار پایه (decimal داخلی، گِردنشده).
 * آرگومان سوم می‌تواند پروفایل واحد باشد، یا (سازگاری) عدد عیار پایه.
 */
export function toBaseGrams(weightGrams, karat, unitsOrBase = CURRENT_UNITS) {
  if (typeof unitsOrBase === 'number') {
    const base = num(unitsOrBase);
    if (base <= 0) return 0n;
    return div(mul(d(num(weightGrams)), d(num(karat))), d(base));
  }
  return equivalent750Raw(weightGrams, karat, unitsOrBase || CURRENT_UNITS);
}

/** مبلغ ریالی → گرم معادل، با فیِ سند. نرخ صفر ⇒ `null` (نه صفر). */
export function irrToBaseGrams(amountIRR, ratePerBaseGram) {
  const rate = d(num(ratePerBaseGram));
  if (cmp(rate, 0) <= 0) return null;
  return div(d(num(amountIRR)), rate);
}

/** گرم معادل → مبلغ ریالی (ستون «مبلغ» وقتی فی معلوم است). */
export function baseGramsToIrr(grams, ratePerBaseGram) {
  return mul(d(num(grams)), d(num(ratePerBaseGram)));
}

/**
 * فیِ برگه (ریال هر گرم عیار پایه‌ی پروفایل) برای یک سند.
 * ترتیب اولویت: ۱) نرخ صریح برگه ۲) Snapshot سند ۳) نرخ یک قلم، نرمال‌شده.
 * هیچ‌کدام نبود ⇒ صفر = «نرخ نامعلوم» (نه صفر چاپ‌کردن معادل).
 */
export function sheetRateOf(doc = {}, { override = 0, units = null, baseKarat = null } = {}) {
  if (num(override) > 0) return num(override);
  const base = num(baseKarat) || (units || CURRENT_UNITS).baseKarat;

  const snap = doc.pricingSnapshot;
  if (snap && num(snap.ratePerGram18k) > 0 && num(snap.baseKarat) === base) {
    return num(snap.ratePerGram18k);
  }
  if (snap && num(snap.ratePerGram18k) > 0 && num(snap.baseKarat) > 0) {
    // Snapshot با عیار پایه‌ی دیگر — تناسبی تبدیل می‌شود، نه دور انداخته.
    return toNumber(div(mul(d(snap.ratePerGram18k), d(base)), d(snap.baseKarat)), 0);
  }

  for (const line of doc.lines || []) {
    if (num(line.ratePerGram) > 0 && num(line.karat) > 0) {
      return toNumber(div(mul(d(line.ratePerGram), d(base)), d(line.karat)), 0);
    }
  }
  if (num(doc.ratePerGram) > 0 && num(doc.karat) > 0) {
    return toNumber(div(mul(d(doc.ratePerGram), d(base)), d(doc.karat)), 0);
  }
  return 0;
}

// ─────────────────────── محاسبه‌ی یک قلم کالا ───────────────────────

/**
 * اجزای طلایی یک قلم سند خرید/فروش.
 *
 * @param {object} line قلم ذخیره‌شده (خروجی pricing.computeDocument)
 * @param {object} opts `{rate, baseKarat, mode}` — `mode`: 'sale' | 'purchase'
 * @returns {object} اجزا به‌صورت Number با دقت برگه + پرچم `needsRate`
 */
export function goldLineParts(line = {}, { rate = 0, units = CURRENT_UNITS, mode = 'sale' } = {}) {
  const u = units || CURRENT_UNITS;
  const R = (v) => roundSheetGrams(v, u);
  const N = (v) => toNumber(v, u.decimals);
  const isManufactured = line.goldType === 'manufactured';
  const isSale = mode === 'sale';

  const baseRaw = toBaseGrams(line.weightGrams, line.karat, u);
  const base = R(baseRaw);

  let needsRate = false;

  // ── اجرت ──
  let wage = 0n;
  let wagePercent = 0;
  if (isManufactured && num(line.wageValue) > 0) {
    if (line.wageType === 'perGram') {
      // اجرت مبلغی: ریال بر گرمِ ترازو ⇒ فقط از مسیر فی به طلا می‌رود.
      const wageIrr = mul(d(num(line.wageValue)), d(num(line.weightGrams)));
      const g = irrToBaseGrams(toNumber(wageIrr, 0), rate);
      if (g === null) needsRate = true;
      else wage = R(g);
    } else {
      wagePercent = num(line.wageValue);
      wage = R(percentOf(base, d(wagePercent)));
    }
  }

  // ── کارمزد تبدیل (آبشده/متفرقه، فقط فروش) — درصدی روی خودِ طلا ──
  const meltPercent = isSale && !isManufactured ? num(line.meltFeePercent) : 0;
  const melt = meltPercent > 0 ? R(percentOf(base, d(meltPercent))) : 0n;

  // ── سود (ساخته‌شده، فقط فروش) — درصدی روی طلا + اجرت ──
  const profitPercent = isSale && isManufactured ? num(line.profitPercent) : 0;
  const profit = profitPercent > 0 ? R(percentOf(add(base, wage), d(profitPercent))) : 0n;

  const subtotal = sum([base, wage, melt, profit]);

  // ── تخفیف: مبلغ ریالی است، پس فقط از مسیر فی ──
  let discountShare = 0n;
  if (isSale && num(line.discountShareIRR) > 0) {
    const g = irrToBaseGrams(line.discountShareIRR, rate);
    if (g === null) needsRate = true;
    else discountShare = R(g);
  }

  // ── مالیات: درصدی روی مبلغ پس از تخفیف ⇒ روی طلای پس از تخفیف ──
  const taxPercent = isSale ? num(line.taxPercent) : 0;
  const tax = taxPercent > 0 ? R(percentOf(sub(subtotal, discountShare), d(taxPercent))) : 0n;

  const total = add(sub(subtotal, discountShare), tax);

  return {
    baseGrams: N(base),
    wageGrams: N(wage),
    wagePercent,
    wageIsRial: isManufactured && line.wageType === 'perGram' && num(line.wageValue) > 0,
    meltFeeGrams: N(melt),
    meltFeePercent: meltPercent,
    profitGrams: N(profit),
    profitPercent,
    discountShareGrams: N(discountShare),
    taxGrams: N(tax),
    taxPercent,
    subtotalGrams: N(subtotal),
    totalGrams: N(total),
    karatMille: karatMilleOf(line.karat, u),
    needsRate,
  };
}

/**
 * اجزای طلایی یک خط تسویه (دریافت/پرداخت).
 * خط طلا مستقیم تبدیل می‌شود؛ خط نقدی و خط تخفیف فقط با فی.
 */
export function goldSettlementParts(entry = {}, { rate = 0, units = CURRENT_UNITS } = {}) {
  const u = units || CURRENT_UNITS;
  if (entry.method === 'gold') {
    const base = roundSheetGrams(toBaseGrams(entry.weightGrams, entry.karat, u), u);
    return {
      baseGrams: toNumber(base, u.decimals),
      totalGrams: toNumber(base, u.decimals),
      karatMille: karatMilleOf(entry.karat, u),
      needsRate: false,
      isCash: false,
    };
  }
  const amount = num(entry.valueIRR ?? entry.amountIRR);
  const g = irrToBaseGrams(amount, rate);
  const grams = g === null ? 0 : toNumber(roundSheetGrams(g, u), u.decimals);
  return {
    baseGrams: grams,
    totalGrams: grams,
    karatMille: karatMilleOf(u.baseKarat, u),
    amountIRR: amount,
    needsRate: g === null,
    isCash: true,
  };
}

/** جمع چند مقدار گرمی که هر کدام از قبل گرد شده‌اند (ردیف‌به‌ردیف). */
export function sumGrams(values) {
  return normalizeGrams(toNumber(sum(values.map((v) => d(num(v)))), GRAM_DECIMALS));
}
