// purchases.js — موتور خرید طلا (Phase 6)
//
// ═══════════════════════════════════════════════════════════════════════════
// اصول حاکم بر این فایل (دستور پروژه §20 و ARCHITECTURE §8):
//
// ۱) هیچ عددی مستقیم تغییر نمی‌کند. ثبت خرید یعنی ساختن Transaction + رکوردهای
//    Gold/Money Ledger؛ موجودی طلا و بدهی تأمین‌کننده **نتیجه‌ی** این رکوردهایند،
//    نه فیلدی که ما بنویسیم.
// ۲) هر عملیات (ثبت، لغو، اصلاح) در **یک** IndexedDB Transaction انجام می‌شود.
//    الگو: ابتدا تمام خواندن‌ها و محاسبات (prepare*)، سپس یک runTransaction که
//    فقط می‌نویسد. اگر هر نوشتنی شکست بخورد، هیچ‌چیز نوشته نمی‌شود.
// ۳) سند ثبت‌شده هرگز ویرایش نمی‌شود (BUSINESS_RULES §9). «اصلاح خرید» یعنی
//    لغو سند قدیمی (Reversal کامل) + ثبت سند جدید — هر دو در یک تراکنش.
// ۴) نرخ، اجرت و تنظیمات گرد کردن به‌صورت Snapshot در خود سند ذخیره می‌شوند؛
//    تغییر بعدی نرخ روز، فاکتورهای گذشته را تغییر نمی‌دهد (دستور پروژه §11).
//
// نگاشت خواسته‌های Phase 6 به رکوردهای دفتر:
//   خرید طلا            → Gold Ledger: IN روی سطل انبار
//   بدهی پرداخت‌نشده     → Money Ledger: Credit روی تأمین‌کننده (بدهی ما)
//   پرداخت وجه          → Money Ledger: Debit تأمین‌کننده / Credit حساب (کاهش بدهی)
//   پرداخت طلا          → Gold Ledger: OUT از انبار + Money: Debit تأمین‌کننده
// ═══════════════════════════════════════════════════════════════════════════

import { isValidFineness, isValidScaleWeight, FINENESS_ERROR, WEIGHT_DECIMALS_ERROR, unitsStamp } from './units.js';
import { get, getAll, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso, toDate } from '../utils/date.js';
import { nextDocumentNumber, nextDocumentNumbers } from './docNumber.js';
import { inventoryRefId, inventoryBalances } from './ledger.js';
import { computeDocument, roundWeight, pricingSnapshot, ratePerGramForKarat, WAGE_TYPES } from './pricing.js';
import { getPricingConfig } from './priceRates.js';
import { normalizeSettlement, validateSettlement, settlementValue } from './settlement.js';
import { labNameFor, labNameError, registerLabsInTx, labNamesOf, LAB_WRITE_STORES } from './labs.js';
// (Phase 11) هر پرداختِ داخل سند خرید هم یک رکورد «تخصیص» می‌سازد. چرا: از Phase 11
// به بعد مانده‌ی هر فاکتور از فرمول یکتای «مبلغ − Σ تخصیص‌ها» می‌آید. اگر پرداخت‌های
// داخل سند از این فرمول مستثنا می‌شدند، دو مسیر موازی برای یک عدد داشتیم — دقیقاً
// همان چیزی که معماری Ledger این پروژه از آن پرهیز می‌کند.
import { buildAllocationRecords, prepareTargetVoid } from './allocations.js';
import { getDueItem } from './dueDates.js';
import {
  newPlan,
  addTransaction,
  addGoldEntry,
  addMoneyEntry,
  addReversal,
  assertBalanced,
  writePlan,
} from './postings.js';
import { assertPlanInventory } from './inventory.js';
// (Phase 19) واحد رسمی مانده‌ی طرف حساب: گرم ۷۵۰.
import {
  documentGoldTotals,
  effectiveRate,
  roundBaseGrams,
  isZeroGrams,
  baseGramsOf,
  GRAM_EPS as BASE_GRAM_EPS,
  rateRequirementMessage,
  documentPricingConfig,
  unitsForConfig,
} from './goldTotals.js';

export const GOLD_TYPES = ['manufactured', 'melted', 'misc'];
export const PAYMENT_MODES = ['cash', 'credit', 'mixed'];
export const PAYMENT_METHODS = ['cash', 'gold'];
export const PURCHASE_STATUSES = ['open', 'settled', 'voided'];

/** Storeهایی که یک عملیات کامل خرید به آن‌ها می‌نویسد — همه در یک تراکنش. */
const WRITE_STORES = [
  'purchases',
  'payments',
  'allocations',
  'dueDates',
  'transactions',
  'goldLedger',
  'moneyLedger',
  'auditLog',
  // Phase 23: فهرست آزمایشگاه‌ها (داخل رکورد تنظیمات) در همان تراکنش سند.
  ...LAB_WRITE_STORES.filter((n) => n !== 'auditLog'),
];

/** تلورانس مقایسه‌ی مبالغ ریالی (نیم ریال) و وزن (یک هزارم گرم). */
const IRR_EPS = 0.5;
const GRAM_EPS = 0.0005;

// ────────────────────────────────── خطاها ──────────────────────────────────

/** خطای اعتبارسنجی با تفکیک فیلدهای سند، خطوط کالا و پرداخت‌ها (UI_GUIDELINES §3). */
export class PurchaseValidationError extends Error {
  constructor({ fields = {}, lines = {}, payments = {} } = {}) {
    super('اطلاعات سند خرید نامعتبر است.');
    this.name = 'PurchaseValidationError';
    this.fieldErrors = fields;
    this.lineErrors = lines;
    this.paymentErrors = payments;
  }
  get isEmpty() {
    return (
      Object.keys(this.fieldErrors).length === 0 &&
      Object.keys(this.lineErrors).length === 0 &&
      Object.keys(this.paymentErrors).length === 0
    );
  }
}

/**
 * کمبود موجودی طلا هنگام «پرداخت با طلا».
 * تصمیم Phase 6 (INVENTORY_RULES §5): **بلاک نمی‌کنیم**، هشدار می‌دهیم و تأیید
 * صریح کاربر می‌گیریم. سرویس این خطا را پرتاب می‌کند و UI پس از تأیید کاربر
 * دوباره با `allowNegativeGold: true` صدا می‌زند.
 */
export class GoldShortageError extends Error {
  constructor(shortages) {
    super('موجودی طلا برای این پرداخت کافی نیست.');
    this.name = 'GoldShortageError';
    this.shortages = shortages;
  }
}

/** عملیات روی سندی که وضعیتش اجازه نمی‌دهد (مثلاً لغو سند لغوشده). */
export class PurchaseStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PurchaseStateError';
  }
}

// ─────────────────────────── نرمال‌سازی و اعتبارسنجی ───────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isPositive(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function normalizeLine(raw) {
  const goldType = GOLD_TYPES.includes(raw.goldType) ? raw.goldType : null;
  const isManufactured = goldType === 'manufactured';
  return {
    productId: raw.productId || null,
    goldType,
    karat: num(raw.karat),
    weightGrams: num(raw.weightGrams),
    ratePerGram: num(raw.ratePerGram),
    // اجرت فقط برای ساخته‌شده (BUSINESS_RULES §8) — سرویس این را اجبار می‌کند، نه فقط UI.
    wageType: isManufactured ? (WAGE_TYPES.includes(raw.wageType) ? raw.wageType : 'percent') : null,
    wageValue: isManufactured ? num(raw.wageValue) : 0,
    // Phase 23: نام آزمایشگاه (فقط آبشده/متفرقه؛ اختیاری؛ Snapshot روی قلم).
    labName: labNameFor(goldType, raw.labName),
    description: String(raw.description ?? '').trim(),
  };
}

function normalizeInput(raw = {}) {
  return {
    supplierId: raw.supplierId || null,
    date: raw.date ? new Date(raw.date).toISOString() : nowIso(),
    paymentMode: PAYMENT_MODES.includes(raw.paymentMode) ? raw.paymentMode : null,
    // (Phase 19) «فیِ سند»: ریال هر گرم طلای ۷۵۰ (همان ۱۸ عیار). صفر = وارد نشده، و این
    // فقط وقتی خطاست که سند جزء ریالی داشته باشد (goldTotals.needsRate).
    ratePerBaseGram: num(raw.ratePerBaseGram),
    dueDate: raw.dueDate ? new Date(raw.dueDate).toISOString() : null,
    description: String(raw.description ?? '').trim(),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map(normalizeLine),
    // خط پرداخت با همان قواعد مشترک خط دریافت فروش نرمال می‌شود (services/settlement.js)
    payments: (Array.isArray(raw.payments) ? raw.payments : []).map(normalizeSettlement),
  };
}

/** قلم بدون نرخ، نرخ روزِ عیار خودش را می‌گیرد (PRICING_RULES §4). */
function resolveLineRates(input, config) {
  return {
    ...input,
    lines: input.lines.map((line) => ({
      ...line,
      ratePerGram: line.ratePerGram > 0 ? line.ratePerGram : ratePerGramForKarat(line.karat, config),
    })),
  };
}

function validateStructure(input) {
  const fields = {};
  const lines = {};
  const payments = {};

  if (!input.supplierId) fields.supplierId = 'انتخاب تأمین‌کننده الزامی است.';
  if (!input.date || Number.isNaN(new Date(input.date).getTime())) fields.date = 'تاریخ خرید نامعتبر است.';
  if (!input.paymentMode) fields.paymentMode = 'نوع تسویه را انتخاب کنید.';
  if (input.description.length > 500) fields.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
  if (!input.lines.length) fields.lines = 'حداقل یک قلم کالا برای خرید لازم است.';

  input.lines.forEach((line, i) => {
    const e = {};
    if (!line.goldType) e.goldType = 'نوع طلا نامعتبر است.';
    if (!isValidFineness(line.karat)) e.karat = FINENESS_ERROR;
    if (!isPositive(line.weightGrams)) e.weightGrams = 'وزن باید بزرگ‌تر از صفر باشد.';
    else if (!isValidScaleWeight(line.weightGrams)) e.weightGrams = WEIGHT_DECIMALS_ERROR;
    // (Phase 19) نرخ هر گرم دیگر الزامی نیست — سند رسیدی به گرم ۷۵۰ حساب می‌شود.
    if (line.wageValue < 0) e.wageValue = 'اجرت نمی‌تواند منفی باشد.';
    const labError = labNameError(line.labName);
    if (labError) e.labName = labError;
    if (Object.keys(e).length) lines[i] = e;
  });

  input.payments.forEach((pay, i) => {
    const e = validateSettlement(pay, 'پرداخت');
    if (Object.keys(e).length) payments[i] = e;
  });

  const error = new PurchaseValidationError({ fields, lines, payments });
  if (!error.isEmpty) throw error;
}

// ───────────────────────────────── محاسبات ─────────────────────────────────

/**
 * محاسبه‌ی کامل مبالغ سند (بدون هیچ دسترسی به دیتابیس).
 * UI از همین تابع برای نمایش زنده‌ی جمع فاکتور استفاده می‌کند تا عددی که کاربر
 * می‌بیند دقیقاً همان عددی باشد که ذخیره می‌شود (نه یک محاسبه‌ی موازی در فرم).
 */
export function computePurchaseTotals(input, rawConfig = 0) {
  const normalized = normalizeInput(input);
  // فیِ سند، اگر وارد شده باشد، نرخ پایه‌ی همین سند است — یک سند، یک نرخ.
  const config = documentPricingConfig(normalized, rawConfig);

  // موتور قیمت (services/pricing.js) تنها مرجع محاسبه است — این تابع فقط
  // خروجی آن را با اطلاعات سطل انبار و تسویه‌ها تکمیل می‌کند.
  const { lines: pricedLines, totals: engineTotals } = computeDocument(
    { lines: normalized.lines },
    config,
    'purchase'
  );
  const baseLines = pricedLines.map((line) => ({
    ...line,
    inventoryRefId: line.goldType ? inventoryRefId(line) : null,
  }));

  const payments = normalized.payments.map((pay) => {
    // وزن طلای پرداختی هم با همان گام وزن گرد می‌شود؛ همین عدد به دفتر می‌رود.
    const rounded = { ...pay, weightGrams: pay.method === 'gold' ? roundWeight(pay.weightGrams, config) : 0 };
    return {
      ...rounded,
      valueIRR: settlementValue(rounded, config),
      inventoryRefId: rounded.method === 'gold' && rounded.goldType ? inventoryRefId(rounded) : null,
    };
  });

  // ── لایه‌ی گرمی (Phase 19): واحد رسمی مانده‌ی تأمین‌کننده ──
  const rate = effectiveRate(normalized, config);
  const gold = documentGoldTotals({ lines: baseLines, settlements: payments }, { rate, mode: 'purchase', units: unitsForConfig(config) });
  const lines = baseLines.map((line, i) => ({
    ...line,
    baseGrams: gold.lineParts[i]?.baseGrams || 0,
    lineTotalGrams: gold.lineParts[i]?.totalGrams || 0,
  }));

  const totalGoldPriceIRR = engineTotals.totalGoldPriceIRR;
  const totalWageIRR = engineTotals.totalWageIRR;
  const grandTotalIRR = engineTotals.grandTotalIRR;

  const paidCashIRR = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.valueIRR, 0);
  const paidGoldValueIRR = payments.filter((p) => p.method === 'gold').reduce((s, p) => s + p.valueIRR, 0);
  const paidGoldGrams = payments.filter((p) => p.method === 'gold').reduce((s, p) => s + p.weightGrams, 0);
  const paidTotalIRR = paidCashIRR + paidGoldValueIRR;

  return {
    lines,
    payments,
    totalGoldPriceIRR,
    totalWageIRR,
    totalProfitIRR: 0,
    totalTaxIRR: 0,
    grandTotalIRR,
    paidCashIRR,
    paidGoldValueIRR,
    paidGoldGrams,
    paidTotalIRR,
    remainingIRR: grandTotalIRR - paidTotalIRR,
    totalWeightGrams: engineTotals.totalWeightGrams,
    // ── واحد رسمی: گرم ۷۵۰ ──
    ratePerBaseGram: rate,
    gold,
    lineGoldParts: gold.lineParts,
    paymentGoldParts: gold.settlementParts,
    totalBaseGrams: gold.totalBaseGrams,
    totalWageGrams: gold.totalWageGrams,
    grandTotalGrams: gold.grandTotalGrams,
    paidTotalGrams: gold.settledGrams,
    paidGoldSettledGrams: gold.settledGoldGrams,
    paidCashGrams: gold.settledCashGrams,
    remainingGrams: gold.remainingGrams,
    needsRate: gold.needsRate,
    rateReasons: gold.rateReasons,
  };
}

/** نوع تسویه‌ای که از روی پرداخت‌ها **مشتق** می‌شود (مبنای اعتبارسنجی انتخاب کاربر). */
export function derivePaymentMode(totals) {
  // (Phase 19) از روی گرم تصمیم گرفته می‌شود، نه ریال: یک سند رسیدی بدون فی
  // اصلاً مبلغ ریالی ندارد و با معیار ریالی همیشه «نقدی» دیده می‌شد.
  if (isZeroGrams(totals.paidTotalGrams)) return 'credit';
  if (isZeroGrams(totals.remainingGrams)) return 'cash';
  return 'mixed';
}

const MODE_LABELS = { cash: 'نقدی', credit: 'رسیدی', mixed: 'ترکیبی' };

// ───────────────────────── آماده‌سازی (فقط خواندن) ─────────────────────────

/** پیکربندی مؤثر موتور قیمت (نرخ روز + گام‌های گِردکردن) — services/priceRates.js. */
async function loadPricingConfig() {
  return getPricingConfig();
}

/**
 * بررسی کفایت موجودی طلا برای پرداخت‌های طلایی.
 * تأثیر خطوط خود همین سند (که موجودی را افزایش می‌دهند) و اثر لغو سند قبلی (در
 * حالت اصلاح) هم لحاظ می‌شود تا هشدار واقعی باشد، نه کاذب.
 */
async function findGoldShortages(totals, adjustments = new Map()) {
  const balances = await inventoryBalances();
  const projected = new Map();

  const startOf = (refId) => {
    if (!projected.has(refId)) {
      projected.set(refId, (balances.get(refId)?.grams || 0) + (adjustments.get(refId) || 0));
    }
    return projected.get(refId);
  };

  for (const line of totals.lines) {
    if (!line.inventoryRefId) continue;
    projected.set(line.inventoryRefId, startOf(line.inventoryRefId) + line.weightGrams);
  }

  const shortages = [];
  for (const pay of totals.payments) {
    if (pay.method !== 'gold' || !pay.inventoryRefId) continue;
    const before = startOf(pay.inventoryRefId);
    const after = before - pay.weightGrams;
    projected.set(pay.inventoryRefId, after);
    if (after < -GRAM_EPS) {
      shortages.push({
        refId: pay.inventoryRefId,
        goldType: pay.goldType,
        karat: pay.karat,
        productId: pay.productId,
        available: before,
        requested: pay.weightGrams,
        shortfall: pay.weightGrams - before,
      });
    }
  }
  return shortages;
}

/**
 * تمام خواندن‌ها، اعتبارسنجی‌ها و ساخت رکوردها — پیش از باز شدن تراکنش.
 * خروجی یک «طرح نوشتن» کامل است که فقط باید نوشته شود.
 */
async function prepareCreate(rawInput, { allowNegativeGold = false, inventoryAdjust = new Map(), amendsPurchaseId = null } = {}) {
  // پیکربندی پیش از اعتبارسنجی خوانده می‌شود تا قلم بدون نرخ، نرخ روزِ عیارش را بگیرد.
  const pricingConfig = await loadPricingConfig();
  const normalizedInput = normalizeInput(rawInput);
  // فیِ سند بر نرخ روز مقدم است (یک سند، یک نرخ) — هم برای اقلامِ بدون نرخ و هم
  // برای Snapshot ذخیره‌شده در همان سند.
  const docConfig = documentPricingConfig(normalizedInput, pricingConfig);
  const input = resolveLineRates(normalizedInput, docConfig);
  validateStructure(input);

  const totals = computePurchaseTotals(input, docConfig);

  const fields = {};
  const lineErrors = {};
  const paymentErrors = {};

  // ── اعتبارسنجی‌های وابسته به دیتابیس ──
  const supplier = await get('suppliers', input.supplierId);
  if (!supplier || supplier.deletedAt) {
    fields.supplierId = 'تأمین‌کننده انتخاب‌شده یافت نشد یا حذف شده است.';
  }

  for (let i = 0; i < totals.lines.length; i += 1) {
    const line = totals.lines[i];
    if (!line.productId) continue;
    const product = await get('products', line.productId);
    if (!product || product.deletedAt) {
      lineErrors[i] = { ...(lineErrors[i] || {}), productId: 'کالای انتخاب‌شده یافت نشد یا حذف شده است.' };
    } else if (product.type !== line.goldType) {
      lineErrors[i] = {
        ...(lineErrors[i] || {}),
        productId: `نوع طلای این قلم با نوع کالای «${product.name}» یکسان نیست.`,
      };
    }
  }

  for (let i = 0; i < totals.payments.length; i += 1) {
    const pay = totals.payments[i];
    if (pay.method !== 'cash') continue;
    const account = await get('accounts', pay.accountId);
    if (!account || account.deletedAt) {
      paymentErrors[i] = { ...(paymentErrors[i] || {}), accountId: 'حساب انتخاب‌شده یافت نشد.' };
    }
  }

  // ── قواعد کسب‌وکار سطح سند ──
  // (Phase 19) «فی» فقط وقتی لازم است که سند جزء ریالی داشته باشد.
  if (totals.needsRate) {
    fields.ratePerBaseGram = rateRequirementMessage(totals.rateReasons);
  }
  if (totals.remainingGrams < -BASE_GRAM_EPS) {
    fields.payments = 'جمع پرداخت‌ها از مبلغ کل فاکتور بیشتر است.';
  }

  const derivedMode = derivePaymentMode(totals);
  if (!fields.paymentMode && input.paymentMode !== derivedMode) {
    fields.paymentMode =
      `نوع تسویه انتخاب‌شده «${MODE_LABELS[input.paymentMode]}» با پرداخت‌های ثبت‌شده هم‌خوان نیست ` +
      `(بر اساس پرداخت‌ها: «${MODE_LABELS[derivedMode]}»).`;
  }

  const hasRemaining = totals.remainingGrams > BASE_GRAM_EPS;
  // (Phase 19، تصمیم ۵۸) تاریخ سررسید **اختیاری** است: در کار واقعی بسیاری از
  // اسناد رسیدی سررسید مشخصی ندارند. مانده همچنان از تخصیص‌ها مشتق می‌شود؛ فقط
  // این سند در هشدارهای سررسید نمی‌آید.

  if (input.dueDate && Number.isNaN(new Date(input.dueDate).getTime())) {
    fields.dueDate = 'تاریخ سررسید نامعتبر است.';
  }

  const validationError = new PurchaseValidationError({
    fields,
    lines: lineErrors,
    payments: paymentErrors,
  });
  if (!validationError.isEmpty) throw validationError;

  // ── هشدار موجودی طلا (بلاک نمی‌کند، تأیید می‌خواهد) ──
  const shortages = await findGoldShortages(totals, inventoryAdjust);
  if (shortages.length && !allowNegativeGold) throw new GoldShortageError(shortages);

  // ── ساخت رکوردها ──
  const now = nowIso();
  const purchaseId = generateId();
  const number = await nextDocumentNumber('purchases', input.date);
  const paymentNumbers = await nextDocumentNumbers('payments', input.date, totals.payments.length);

  const paymentRecords = totals.payments.map((pay, i) => ({
    id: generateId(),
    number: paymentNumbers[i],
    ...unitsStamp(docConfig.gramsRoundingMode),
    partyType: 'supplier',
    partyId: input.supplierId,
    method: pay.method,
    amountIRR: pay.method === 'cash' ? pay.valueIRR : null,
    accountId: pay.method === 'cash' ? pay.accountId : null,
    weightGrams: pay.method === 'gold' ? pay.weightGrams : null,
    karat: pay.method === 'gold' ? pay.karat : null,
    goldType: pay.method === 'gold' ? pay.goldType : null,
    productId: pay.method === 'gold' ? pay.productId : null,
    ratePerGram: pay.method === 'gold' ? pay.ratePerGram : null,
    labName: pay.method === 'gold' ? pay.labName || null : null,
    valueIRR: pay.valueIRR,
    /** (Phase 19) ارزش این پرداخت به گرم ۷۵۰ — واحد رسمی کاهش بدهی. */
    valueGrams: totals.paymentGoldParts[i]?.totalGrams || 0,
    relatedDueDateId: null,
    relatedPurchaseId: purchaseId,
    date: input.date,
    description: pay.description,
    transactionIds: [],
    status: 'confirmed',
    createdAt: now,
  }));

  const dueDateRecord = hasRemaining && input.dueDate
    ? {
        id: generateId(),
        sourceType: 'purchase',
        sourceId: purchaseId,
        partyType: 'supplier',
        partyId: input.supplierId,
        dueDate: input.dueDate,
        amountIRR: totals.remainingIRR,
        /** (Phase 19) واحد رسمی سررسید: گرم ۷۵۰. */
        amountGrams: totals.remainingGrams,
        amountGoldGrams: 0,
        status: 'pending',
        settledByIds: [],
        createdAt: now,
        updatedAt: now,
      }
    : null;

  const purchase = {
    id: purchaseId,
    // Phase 22: پروفایل واحد این سند.
    ...unitsStamp(docConfig.gramsRoundingMode),
    number,
    supplierId: input.supplierId,
    supplierNameSnapshot: supplier?.name || '',
    date: input.date,
    paymentMode: derivedMode,
    lines: totals.lines,
    productIds: totals.lines.map((l) => l.productId).filter(Boolean),
    totalGoldPriceIRR: totals.totalGoldPriceIRR,
    totalWageIRR: totals.totalWageIRR,
    totalProfitIRR: 0,
    totalTaxIRR: 0,
    grandTotalIRR: totals.grandTotalIRR,
    totalWeightGrams: totals.totalWeightGrams,
    paidCashIRR: totals.paidCashIRR,
    paidGoldGrams: totals.paidGoldGrams,
    paidGoldValueIRR: totals.paidGoldValueIRR,
    remainingIRR: totals.remainingIRR,
    // ── واحد رسمی: گرم ۷۵۰ (Phase 19) ──
    ratePerBaseGram: totals.ratePerBaseGram,
    totalBaseGrams: totals.totalBaseGrams,
    totalWageGrams: totals.totalWageGrams,
    grandTotalGrams: totals.grandTotalGrams,
    paidTotalGrams: totals.paidTotalGrams,
    remainingGrams: totals.remainingGrams,
    status: hasRemaining ? 'open' : 'settled',
    dueDate: dueDateRecord ? input.dueDate : null,
    dueDateId: dueDateRecord ? dueDateRecord.id : null,
    paymentIds: paymentRecords.map((p) => p.id),
    transactionIds: [],
    description: input.description,
    /** Snapshot کامل پارامترهای محاسباتی — تغییر بعدی نرخ/تنظیمات این سند را تغییر نمی‌دهد. */
    pricingSnapshot: pricingSnapshot(docConfig, 'purchase'),
    amendsPurchaseId: amendsPurchaseId || null,
    replacedByPurchaseId: null,
    voidedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  // ── ساخت طرح دفاتر ──
  const plan = newPlan();

  const purchaseTx = addTransaction(plan, {
    type: 'purchase',
    sourceType: 'purchase',
    sourceId: purchase.id,
    date: purchase.date,
  });

  for (const [idx, line] of totals.lines.entries()) {
    // ورود طلا به انبار
    addGoldEntry(plan, {
      transactionId: purchaseTx.id,
      direction: 'IN',
      reason: 'purchase',
      accountRef: { kind: 'inventory', id: line.inventoryRefId },
      goldType: line.goldType,
      karat: line.karat,
      productId: line.productId,
      weightGrams: line.weightGrams,
      date: purchase.date,
    });
    // بهای تمام‌شده‌ی همان سطل انبار (طرف بدهکار سند) — ریالی و گرمی
    addMoneyEntry(plan, {
      transactionId: purchaseTx.id,
      reason: 'purchase',
      accountRef: { kind: 'inventory', id: line.inventoryRefId },
      debit: line.lineTotalIRR,
      debitGrams: totals.lineGoldParts[idx]?.totalGrams || 0,
      date: purchase.date,
    });
  }

  // بدهی ما به تأمین‌کننده بابت کل فاکتور (طرف بستانکار سند)
  addMoneyEntry(plan, {
    transactionId: purchaseTx.id,
    reason: 'purchase',
    accountRef: { kind: 'supplier', id: purchase.supplierId },
    credit: purchase.grandTotalIRR,
    creditGrams: purchase.grandTotalGrams,
    date: purchase.date,
  });

  // پرداخت‌ها: هر پرداخت یک سند و یک Transaction مستقل دارد (رهگیری کامل)
  for (const pay of paymentRecords) {
    if (pay.method === 'cash') {
      const tx = addTransaction(plan, {
        type: 'payment_cash',
        sourceType: 'payment',
        sourceId: pay.id,
        date: pay.date,
      });
      pay.transactionIds = [tx.id];
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'pay',
        accountRef: { kind: 'supplier', id: purchase.supplierId },
        debit: pay.valueIRR,
        debitGrams: pay.valueGrams,
        date: pay.date,
      });
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'pay',
        accountRef: { kind: 'account', id: pay.accountId },
        credit: pay.valueIRR,
        creditGrams: pay.valueGrams,
        date: pay.date,
      });
    } else {
      const tx = addTransaction(plan, {
        type: 'payment_gold',
        sourceType: 'payment',
        sourceId: pay.id,
        date: pay.date,
      });
      pay.transactionIds = [tx.id];
      const refId = inventoryRefId(pay);
      addGoldEntry(plan, {
        transactionId: tx.id,
        direction: 'OUT',
        reason: 'payment_gold',
        accountRef: { kind: 'inventory', id: refId },
        goldType: pay.goldType,
        karat: pay.karat,
        productId: pay.productId,
        weightGrams: pay.weightGrams,
        date: pay.date,
      });
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'pay',
        accountRef: { kind: 'supplier', id: purchase.supplierId },
        debit: pay.valueIRR,
        debitGrams: pay.valueGrams,
        date: pay.date,
      });
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'pay',
        accountRef: { kind: 'inventory', id: refId },
        credit: pay.valueIRR,
        creditGrams: pay.valueGrams,
        date: pay.date,
      });
    }
  }

  purchase.transactionIds = plan.transactions.map((t) => t.id);
  assertBalanced(plan);

  // (Phase 11) پرداخت‌های همراه سند، ۱۰۰٪ به همین سند تخصیص می‌یابند — FIFO اینجا
  // بی‌معناست چون این پول به‌تعریف بابت همین خرید است. اعتبارسنجی بالا تضمین کرده
  // که جمع پرداخت‌ها از مبلغ فاکتور بیشتر نیست، پس تخصیص هرگز از ظرفیت نمی‌گذرد.
  const allocationRecords = paymentRecords.flatMap((pay) =>
    buildAllocationRecords({
      docType: 'payment',
      docId: pay.id,
      docNumber: pay.number,
      partyType: 'supplier',
      partyId: purchase.supplierId,
      date: pay.date,
      splits: [
        {
          targetId: purchase.id,
          targetType: 'purchase',
          number: purchase.number,
          amountIRR: pay.valueIRR,
          amountGrams: pay.valueGrams,
        },
      ],
      auto: true,
      now,
    })
  );

  return { purchase, paymentRecords, dueDateRecord, plan, shortages, totals, allocationRecords };
}

/** رکوردهای دفتر و تراکنش‌های یک سند خرید (برای لغو/نمایش). */
async function loadPostings(purchase) {
  const transactions = [];
  const goldEntries = [];
  const moneyEntries = [];
  for (const txId of purchase.transactionIds || []) {
    const tx = await get('transactions', txId);
    if (!tx) continue;
    transactions.push(tx);
    goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
    moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
  }
  return { transactions, goldEntries, moneyEntries };
}

/** آماده‌سازی لغو یک سند: طرح Reversal + رکوردهای به‌روزشده. */
async function prepareVoid(id, { date = null, note = '' } = {}) {
  const purchase = await get('purchases', id);
  if (!purchase) throw new PurchaseStateError('سند خرید مورد نظر یافت نشد.');
  if (purchase.status === 'voided') return null; // Idempotent — دوباره Reversal نمی‌زنیم

  const { transactions, goldEntries, moneyEntries } = await loadPostings(purchase);
  for (const tx of transactions) {
    if (tx.reversedBy) {
      throw new PurchaseStateError('این سند قبلاً یک بار خنثی شده است؛ لغو دوباره مجاز نیست.');
    }
  }

  // تسویه‌های بعدی (Phase 11) نباید با لغو سند بی‌صاحب بمانند.
  const allPayments = await getByIndex('payments', 'party', ['supplier', purchase.supplierId]);
  const external = allPayments.filter(
    (p) => p.relatedPurchaseId === purchase.id && p.status !== 'voided' && !(purchase.paymentIds || []).includes(p.id)
  );
  if (external.length) {
    throw new PurchaseStateError(
      `این سند ${external.length} پرداخت بعدی دارد؛ ابتدا آن پرداخت‌ها را لغو کنید.`
    );
  }

  const voidDate = date || nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: voidDate });
  assertBalanced(plan);

  const now = nowIso();
  const voidedPurchase = {
    ...purchase,
    status: 'voided',
    voidedAt: now,
    voidNote: note || purchase.voidNote || '',
    updatedAt: now,
    transactionIds: [...(purchase.transactionIds || []), ...plan.transactions.map((t) => t.id)],
  };

  const payments = await Promise.all((purchase.paymentIds || []).map((pid) => get('payments', pid)));
  const voidedPayments = payments
    .filter(Boolean)
    .map((p) => ({ ...p, status: 'voided', voidedAt: now }));

  const dueDate = purchase.dueDateId ? await get('dueDates', purchase.dueDateId) : null;
  const voidedDueDate = dueDate ? { ...dueDate, status: 'voided', updatedAt: now } : null;

  // (Phase 11) تخصیص‌هایی که به این فاکتور اشاره دارند باطل می‌شوند — شامل تخصیص
  // اسناد تسویه‌ی مستقلی که بعداً بابت این فاکتور ثبت شده‌اند. آن اسناد **باطل
  // نمی‌شوند** (پول واقعاً جابه‌جا شده)؛ فقط دیگر بابت فاکتوری که وجود ندارد حساب
  // نمی‌شوند و مبلغشان به «علی‌الحساب» طرف حساب برمی‌گردد.
  const voidedAllocations = await prepareTargetVoid(purchase.id, { now });

  return {
    purchase,
    voidedPurchase,
    voidedPayments,
    voidedDueDate,
    voidedAllocations,
    plan,
    originalTransactions: new Map(transactions.map((t) => [t.id, t])),
  };
}

/** اثر لغو یک سند بر موجودی سطل‌ها — برای بررسی درست موجودی هنگام «اصلاح». */
function inventoryAdjustFromVoid(purchase) {
  const adjust = new Map();
  const bump = (refId, delta) => adjust.set(refId, (adjust.get(refId) || 0) + delta);
  for (const line of purchase.lines || []) {
    if (line.inventoryRefId) bump(line.inventoryRefId, -num(line.weightGrams));
  }
  return adjust;
}

// ─────────────────────────────── عملیات اصلی ───────────────────────────────

/**
 * ثبت خرید جدید — کل عملیات در یک IndexedDB Transaction.
 * @param {object} input فرم خرید
 * @param {object} options `allowNegativeGold` پس از تأیید صریح کاربر
 */
export async function createPurchase(input, options = {}) {
  const prepared = await prepareCreate(input, options);
  const { purchase, paymentRecords, dueDateRecord, plan, allocationRecords } = prepared;
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('purchases').add(purchase);
    for (const pay of paymentRecords) tx.objectStore('payments').add(pay);
    for (const alloc of allocationRecords) tx.objectStore('allocations').add(alloc);
    if (dueDateRecord) tx.objectStore('dueDates').add(dueDateRecord);
    writePlan(tx, plan);
    registerLabsInTx(tx, labNamesOf(purchase.lines, paymentRecords), timestamp);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'purchases',
      entityId: purchase.id,
      action: 'create',
      before: null,
      after: purchase,
      timestamp,
    });
  });

  return { purchase, payments: paymentRecords, dueDate: dueDateRecord, shortages: prepared.shortages };
}

/**
 * لغو (ابطال) سند خرید: Reversal کامل دفاتر + وضعیت `voided`.
 * سند و تراکنش‌های اصلی هرگز حذف نمی‌شوند (ACCOUNTING_RULES §6).
 */
export async function voidPurchase(id, { note = '', allowNegative = false } = {}) {
  const prepared = await prepareVoid(id, { note });
  if (!prepared) return get('purchases', id); // از قبل باطل شده

  // Phase 17: ابطال خرید یعنی خروج همان طلا از انبار. اگر در این فاصله فروخته
  // شده باشد، موجودی منفی می‌شود — «هشدار + تأیید صریح»، نه سکوت.
  await assertPlanInventory(prepared.plan, { allowNegative, operation: 'ابطال این سند خرید' });

  const { voidedPurchase, voidedPayments, voidedDueDate, voidedAllocations, plan, originalTransactions } = prepared;
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('purchases').put(voidedPurchase);
    for (const pay of voidedPayments) tx.objectStore('payments').put(pay);
    for (const alloc of voidedAllocations || []) tx.objectStore('allocations').put(alloc);
    if (voidedDueDate) tx.objectStore('dueDates').put(voidedDueDate);
    writePlan(tx, plan, originalTransactions);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'purchases',
      entityId: voidedPurchase.id,
      action: 'void',
      before: prepared.purchase,
      after: voidedPurchase,
      timestamp,
    });
  });

  return voidedPurchase;
}

/**
 * اصلاح خرید (تصمیم Phase 6): سند قدیمی باطل و یک سند جدید با شماره جدید ثبت
 * می‌شود — **هر دو در یک تراکنش**. ویرایش درجای یک سند مالی ثبت‌شده طبق
 * BUSINESS_RULES §9 ممنوع است.
 */
export async function amendPurchase(id, input, options = {}) {
  const voidPrepared = await prepareVoid(id, { note: 'اصلاح سند' });
  if (!voidPrepared) throw new PurchaseStateError('سند باطل‌شده قابل اصلاح نیست؛ سند جدید ثبت کنید.');

  const adjust = inventoryAdjustFromVoid(voidPrepared.purchase);
  const createPrepared = await prepareCreate(input, {
    ...options,
    inventoryAdjust: adjust,
    amendsPurchaseId: id,
  });

  const timestamp = nowIso();
  const voidedPurchase = {
    ...voidPrepared.voidedPurchase,
    replacedByPurchaseId: createPrepared.purchase.id,
  };

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    const purchases = tx.objectStore('purchases');
    const payments = tx.objectStore('payments');
    const allocations = tx.objectStore('allocations');
    const dues = tx.objectStore('dueDates');
    const audit = tx.objectStore('auditLog');

    // ۱) لغو سند قدیمی
    purchases.put(voidedPurchase);
    for (const pay of voidPrepared.voidedPayments) payments.put(pay);
    for (const alloc of voidPrepared.voidedAllocations || []) allocations.put(alloc);
    if (voidPrepared.voidedDueDate) dues.put(voidPrepared.voidedDueDate);
    writePlan(tx, voidPrepared.plan, voidPrepared.originalTransactions);

    // ۲) ثبت سند جدید
    purchases.add(createPrepared.purchase);
    for (const pay of createPrepared.paymentRecords) payments.add(pay);
    for (const alloc of createPrepared.allocationRecords) allocations.add(alloc);
    if (createPrepared.dueDateRecord) dues.add(createPrepared.dueDateRecord);
    writePlan(tx, createPrepared.plan);
    registerLabsInTx(tx, labNamesOf(createPrepared.purchase.lines, createPrepared.paymentRecords), timestamp);

    audit.add({
      id: generateId(),
      entity: 'purchases',
      entityId: voidedPurchase.id,
      action: 'void',
      before: voidPrepared.purchase,
      after: voidedPurchase,
      timestamp,
    });
    audit.add({
      id: generateId(),
      entity: 'purchases',
      entityId: createPrepared.purchase.id,
      action: 'create',
      before: null,
      after: createPrepared.purchase,
      timestamp,
    });
  });

  return {
    voided: voidedPurchase,
    purchase: createPrepared.purchase,
    payments: createPrepared.paymentRecords,
    dueDate: createPrepared.dueDateRecord,
    shortages: createPrepared.shortages,
  };
}

// ──────────────────────────── خواندن برای UI ────────────────────────────

export async function getPurchase(id) {
  return get('purchases', id);
}

/** (Phase 27) رکوردهای پرداخت ثبت‌شده‌ی یک سند خرید — برای پرکردن فرم اصلاح. */
export async function getPurchasePayments(purchase) {
  const records = await Promise.all((purchase?.paymentIds || []).map((id) => get('payments', id)));
  return records.filter(Boolean);
}

/**
 * فهرست اسناد خرید با جستجو/فیلتر.
 * status: 'all' (پیش‌فرض) | 'open' | 'settled' | 'voided'
 */
export async function listPurchases({ search = '', status = 'all', supplierId = null, from = null, to = null } = {}) {
  const [all, suppliers] = await Promise.all([getAll('purchases'), getAll('suppliers')]);
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const term = search.trim().toLowerCase();

  return all
    .filter((p) => {
      if (p.deletedAt) return false;
      if (status !== 'all' && p.status !== status) return false;
      if (supplierId && p.supplierId !== supplierId) return false;
      if (from && String(p.date) < from) return false;
      if (to && String(p.date) > to) return false;
      if (term) {
        const supplier = supplierById.get(p.supplierId);
        const haystack = `${p.number} ${supplier?.name || p.supplierNameSnapshot || ''} ${supplier?.code || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .map((p) => ({
      ...p,
      supplierName: supplierById.get(p.supplierId)?.name || p.supplierNameSnapshot || '—',
      supplierCode: supplierById.get(p.supplierId)?.code || '',
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
}

/** جمع‌های فهرست (نوار خلاصه) — از روی همان ردیف‌های نمایش‌داده‌شده. */
export function summarizePurchases(rows) {
  const active = rows.filter((r) => r.status !== 'voided');
  return {
    count: active.length,
    totalIRR: active.reduce((s, r) => s + num(r.grandTotalIRR), 0),
    totalWeightGrams: active.reduce((s, r) => s + num(r.totalWeightGrams), 0),
    openRemainingIRR: active.filter((r) => r.status === 'open').reduce((s, r) => s + num(r.remainingIRR), 0),
    totalGrams: roundBaseGrams(active.reduce((s, r) => s + num(r.grandTotalGrams), 0)),
    openRemainingGrams: roundBaseGrams(
      active.filter((r) => r.status === 'open').reduce((s, r) => s + num(r.remainingGrams), 0)
    ),
  };
}

/** تمام داده‌های صفحه جزئیات سند، در یک بار خواندن. */
export async function getPurchaseSummary(id) {
  const purchase = await get('purchases', id);
  if (!purchase) throw new PurchaseStateError('سند خرید مورد نظر یافت نشد.');

  const [supplier, postings, dueDate, history] = await Promise.all([
    get('suppliers', purchase.supplierId),
    loadPostings(purchase),
    purchase.dueDateId ? get('dueDates', purchase.dueDateId) : Promise.resolve(null),
    getPurchaseHistory(id),
  ]);

  const payments = (
    await Promise.all((purchase.paymentIds || []).map((pid) => get('payments', pid)))
  ).filter(Boolean);

  return {
    purchase,
    supplier: supplier || null,
    payments,
    dueDate,
    /** (Phase 12) همان سررسید با مانده و وضعیت زمانیِ مشتق‌شده. */
    dueItem: dueDate ? await getDueItem(dueDate.id) : null,
    transactions: postings.transactions,
    goldEntries: postings.goldEntries.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    moneyEntries: postings.moneyEntries.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    history,
  };
}

/** تاریخچه تغییرات سند از auditLog (جدیدترین اول). */
export async function getPurchaseHistory(id) {
  const entries = await getByIndex('auditLog', 'entityId', id);
  return entries
    .filter((e) => e.entity === 'purchases')
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

/** تاریخ سند به‌صورت شیء Date (کمکی برای UI). */
export function purchaseDate(purchase) {
  return toDate(purchase?.date);
}
