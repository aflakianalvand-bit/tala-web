// sales.js — موتور فروش طلا و برگشت از فروش (Phase 7)
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل همان اصول Phase 6 را دنبال می‌کند (اتمیک بودن، Snapshot، ممنوعیت
// ویرایش سند ثبت‌شده، اشتقاق تمام مانده‌ها از دفاتر) با سه تفاوت کلیدی:
//
// ۱) **جهت طلا معکوس است:** فروش طلا را از انبار خارج می‌کند.
// ۲) **کنترل موجودی سخت‌گیرانه است:** بر خلاف «پرداخت با طلا» در خرید که فقط
//    هشدار می‌دهد، فروش بیش از موجودی **ممنوع** است (دستور صریح Phase 7) و هیچ
//    مسیر Override ای ندارد. دلیل تفاوت: پرداخت با طلا ممکن است ثبتِ با تأخیرِ
//    یک رویداد گذشته باشد، اما فروشِ طلایی که نداریم یک رویداد ناممکن است.
// ۳) **برگشت از فروش** یک سند مستقل (`saleReturns`) است، نه ویرایش فاکتور:
//    یک فاکتور می‌تواند چند برگشت جزئی داشته باشد و فاکتور اصلی دست‌نخورده
//    می‌ماند (فقط شمارنده‌های برگشتی‌اش به‌روزرسانی می‌شوند).
//
// نگاشت رویدادها به دفاتر:
//   فروش            → Gold: OUT از سطل انبار | Money: Debit مشتری / Credit انبار
//   دریافت وجه      → Money: Debit حساب / Credit مشتری (کاهش طلب ما)
//   دریافت طلا      → Gold: IN به انبار | Money: Debit انبار / Credit مشتری
//   برگشت از فروش   → Gold: IN به انبار | Money: Debit انبار / Credit مشتری
// ═══════════════════════════════════════════════════════════════════════════

import {
  isValidFineness,
  isValidScaleWeight,
  FINENESS_ERROR,
  WEIGHT_DECIMALS_ERROR,
  unitsStamp,
  finenessOf,
  inventoryRefOfDoc,
  roundGrams750,
  currentUnits,
} from './units.js';
import { get, getAll, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { nextDocumentNumber, nextDocumentNumbers } from './docNumber.js';
import { inventoryRefId, inventoryBalances } from './ledger.js';
import {
  computeDocument,
  roundWeight,
  roundAmount,
  pricingSnapshot,
  ratePerGramForKarat,
  WAGE_TYPES,
} from './pricing.js';
import { getPricingConfig } from './priceRates.js';
import { normalizeSettlement, validateSettlement, settlementValue } from './settlement.js';
import { registerLabsInTx, labNamesOf } from './labs.js';
// (Phase 11) هر دریافتِ داخل فاکتور هم یک رکورد «تخصیص» می‌سازد تا مانده‌ی فاکتور در
// کل برنامه از یک فرمول یکتا بیاید: مبلغ − برگشت‌ها − Σ تخصیص‌ها.
import {
  buildAllocationRecords,
  prepareTargetVoid,
  allocationsForTarget,
  dueDateStatusOf,
  roundIRR,
} from './allocations.js';
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
  GRAM_EPS as BASE_GRAM_EPS,
  rateRequirementMessage,
  documentPricingConfig,
  unitsForConfig,
} from './goldTotals.js';

export const GOLD_TYPES = ['manufactured', 'melted', 'misc'];
export const PAYMENT_MODES = ['cash', 'credit', 'mixed'];
export const SALE_STATUSES = ['open', 'settled', 'voided'];
export const RETURN_STATUSES = ['none', 'partial', 'full'];

/** Storeهایی که یک عملیات کامل فروش/برگشت به آن‌ها می‌نویسد — همه در یک تراکنش. */
const WRITE_STORES = [
  'sales',
  'saleReturns',
  'receipts',
  'allocations',
  'dueDates',
  'transactions',
  'goldLedger',
  'moneyLedger',
  'auditLog',
  // Phase 23: فهرست آزمایشگاه‌ها (طلای دریافتی آبشده/متفرقه) در همان تراکنش فاکتور.
  'settings',
];

const IRR_EPS = 0.5;
const GRAM_EPS = 0.0005;

// ────────────────────────────────── خطاها ──────────────────────────────────

/** خطای اعتبارسنجی با تفکیک فیلد سند، خطوط کالا و دریافت‌ها (UI_GUIDELINES §3). */
export class SaleValidationError extends Error {
  constructor({ fields = {}, lines = {}, receipts = {} } = {}) {
    super('اطلاعات فاکتور فروش نامعتبر است.');
    this.name = 'SaleValidationError';
    this.fieldErrors = fields;
    this.lineErrors = lines;
    this.receiptErrors = receipts;
  }
  get isEmpty() {
    return (
      Object.keys(this.fieldErrors).length === 0 &&
      Object.keys(this.lineErrors).length === 0 &&
      Object.keys(this.receiptErrors).length === 0
    );
  }
}

/**
 * موجودی کافی نیست — **بلاک‌کننده**، بدون مسیر Override.
 * (دستور صریح Phase 7: «فروش بیشتر از موجودی ممنوع باشد».)
 */
export class InsufficientStockError extends Error {
  constructor(shortages) {
    super('موجودی طلا برای این فروش کافی نیست.');
    this.name = 'InsufficientStockError';
    this.shortages = shortages;
  }
}

/** عملیات روی سندی که وضعیتش اجازه نمی‌دهد. */
export class SaleStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaleStateError';
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
    // اجرت/سود فقط برای ساخته‌شده (BUSINESS_RULES §8) — در سرویس اجبار می‌شود، نه فقط در UI.
    wageType: isManufactured ? (WAGE_TYPES.includes(raw.wageType) ? raw.wageType : 'percent') : null,
    wageValue: isManufactured ? num(raw.wageValue) : 0,
    profitPercent: isManufactured ? num(raw.profitPercent) : 0,
    // مالیات برای هر نوع طلا قابل تعریف است (تصمیم Phase 7: پیش‌فرض از کالا می‌آید).
    taxPercent: num(raw.taxPercent),
    description: String(raw.description ?? '').trim(),
  };
}

function normalizeInput(raw = {}) {
  return {
    customerId: raw.customerId || null,
    date: raw.date ? new Date(raw.date).toISOString() : nowIso(),
    paymentMode: PAYMENT_MODES.includes(raw.paymentMode) ? raw.paymentMode : null,
    dueDate: raw.dueDate ? new Date(raw.dueDate).toISOString() : null,
    discountIRR: num(raw.discountIRR),
    // (Phase 19) «فیِ سند»: ریال هر گرم طلای ۷۵۰ (همان ۱۸ عیار).
    ratePerBaseGram: num(raw.ratePerBaseGram),
    description: String(raw.description ?? '').trim(),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map(normalizeLine),
    receipts: (Array.isArray(raw.receipts) ? raw.receipts : []).map(normalizeSettlement),
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
  const receipts = {};

  if (!input.customerId) fields.customerId = 'انتخاب مشتری الزامی است.';
  if (!input.date || Number.isNaN(new Date(input.date).getTime())) fields.date = 'تاریخ فروش نامعتبر است.';
  if (!input.paymentMode) fields.paymentMode = 'نوع تسویه را انتخاب کنید.';
  if (input.discountIRR < 0) fields.discountIRR = 'تخفیف نمی‌تواند منفی باشد.';
  if (input.description.length > 500) fields.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
  if (!input.lines.length) fields.lines = 'حداقل یک قلم کالا برای فروش لازم است.';

  input.lines.forEach((line, i) => {
    const e = {};
    if (!line.goldType) e.goldType = 'نوع طلا نامعتبر است.';
    if (!isValidFineness(line.karat)) e.karat = FINENESS_ERROR;
    if (!isPositive(line.weightGrams)) e.weightGrams = 'وزن باید بزرگ‌تر از صفر باشد.';
    else if (!isValidScaleWeight(line.weightGrams)) e.weightGrams = WEIGHT_DECIMALS_ERROR;
    // (Phase 19) قیمت روز هر گرم دیگر الزامی نیست — فاکتور رسیدی به گرم ۷۵۰ حساب می‌شود.
    if (line.wageValue < 0) e.wageValue = 'اجرت نمی‌تواند منفی باشد.';
    if (line.profitPercent < 0) e.profitPercent = 'سود نمی‌تواند منفی باشد.';
    if (line.taxPercent < 0) e.taxPercent = 'مالیات نمی‌تواند منفی باشد.';
    if (Object.keys(e).length) lines[i] = e;
  });

  input.receipts.forEach((rec, i) => {
    const e = validateSettlement(rec, 'دریافت');
    if (Object.keys(e).length) receipts[i] = e;
  });

  const error = new SaleValidationError({ fields, lines, receipts });
  if (!error.isEmpty) throw error;
}

// ───────────────────────────────── محاسبات ─────────────────────────────────

/**
 * محاسبه‌ی کامل مبالغ فاکتور (بدون دسترسی به دیتابیس) — همان تابعی که UI برای
 * نمایش زنده استفاده می‌کند، تا عدد نمایش‌داده‌شده دقیقاً همان عدد ذخیره‌شده باشد.
 */
export function computeSaleTotals(input, rawConfig = 0) {
  const normalized = normalizeInput(input);
  const config = documentPricingConfig(normalized, rawConfig);

  // تمام محاسبه در موتور قیمت انجام می‌شود؛ اینجا فقط سطل انبار و دریافت‌ها اضافه می‌شوند.
  const { lines: pricedLines, totals } = computeDocument(
    { lines: normalized.lines, discountIRR: normalized.discountIRR },
    config,
    'sale'
  );
  const baseLines = pricedLines.map((line) => ({
    ...line,
    inventoryRefId: line.goldType ? inventoryRefId(line) : null,
    returnedWeightGrams: 0,
    returnedAmountIRR: 0,
    returnedGrams: 0,
  }));

  const receipts = normalized.receipts.map((rec) => {
    // وزن طلای دریافتی هم با همان گام وزن گرد می‌شود؛ همین عدد وارد دفتر می‌شود.
    const rounded = { ...rec, weightGrams: rec.method === 'gold' ? roundWeight(rec.weightGrams, config) : 0 };
    return {
      ...rounded,
      valueIRR: settlementValue(rounded, config),
      inventoryRefId: rounded.method === 'gold' && rounded.goldType ? inventoryRefId(rounded) : null,
    };
  });

  const receivedCashIRR = receipts.filter((r) => r.method === 'cash').reduce((s, r) => s + r.valueIRR, 0);
  const receivedGoldValueIRR = receipts.filter((r) => r.method === 'gold').reduce((s, r) => s + r.valueIRR, 0);
  const receivedGoldGrams = receipts.filter((r) => r.method === 'gold').reduce((s, r) => s + r.weightGrams, 0);
  const receivedTotalIRR = receivedCashIRR + receivedGoldValueIRR;

  // ── لایه‌ی گرمی (Phase 19) ──
  const rate = effectiveRate(normalized, config);
  const gold = documentGoldTotals({ lines: baseLines, settlements: receipts }, { rate, mode: 'sale', units: unitsForConfig(config) });
  // وزن معادل هر قلم روی خودِ قلم ذخیره می‌شود: برگشت از فروش و برگه به آن نیاز
  // دارند و نباید آن را دوباره (و شاید متفاوت) حساب کنند.
  const lines = baseLines.map((line, i) => ({
    ...line,
    baseGrams: gold.lineParts[i]?.baseGrams || 0,
    lineTotalGrams: gold.lineParts[i]?.totalGrams || 0,
  }));

  return {
    lines,
    receipts,
    ...totals,
    receivedCashIRR,
    receivedGoldValueIRR,
    receivedGoldGrams,
    receivedTotalIRR,
    remainingIRR: totals.grandTotalIRR - receivedTotalIRR,
    ratePerBaseGram: rate,
    gold,
    lineGoldParts: gold.lineParts,
    receiptGoldParts: gold.settlementParts,
    totalBaseGrams: gold.totalBaseGrams,
    totalWageGrams: gold.totalWageGrams,
    totalProfitGrams: gold.totalProfitGrams,
    totalTaxGrams: gold.totalTaxGrams,
    discountGrams: gold.totalDiscountGrams,
    grandTotalGrams: gold.grandTotalGrams,
    receivedTotalGrams: gold.settledGrams,
    receivedGoldSettledGrams: gold.settledGoldGrams,
    receivedCashGrams: gold.settledCashGrams,
    remainingGrams: gold.remainingGrams,
    needsRate: gold.needsRate,
    rateReasons: gold.rateReasons,
  };
}

/** نوع تسویه‌ای که از روی دریافت‌ها **مشتق** می‌شود. */
export function derivePaymentMode(totals) {
  // (Phase 19) مبنا گرم است، نه ریال — فاکتور رسیدیِ بدون فی مبلغ ریالی ندارد.
  if (isZeroGrams(totals.receivedTotalGrams)) return 'credit';
  if (isZeroGrams(totals.remainingGrams)) return 'cash';
  return 'mixed';
}

const MODE_LABELS = { cash: 'نقدی', credit: 'رسیدی', mixed: 'ترکیبی' };

/** پیکربندی مؤثر موتور قیمت (نرخ روز + گام‌های گِردکردن) — services/priceRates.js. */
async function loadPricingConfig() {
  return getPricingConfig();
}

// ───────────────────────────── کنترل موجودی ─────────────────────────────

/**
 * بررسی کفایت موجودی برای اقلام فروش.
 * **طلای دریافتی در همین فاکتور به حساب نمی‌آید**: کالایی که می‌فروشیم باید همین
 * حالا در انبار باشد، فارغ از اینکه مشتری در همان معامله طلای کهنه تحویل می‌دهد
 * (آن طلا به سطل دیگری وارد می‌شود و کالای فروخته‌شده را جایگزین نمی‌کند).
 */
async function findStockShortages(lines, adjustments = new Map()) {
  const balances = await inventoryBalances();
  const projected = new Map();
  const shortages = [];

  for (const line of lines) {
    if (!line.inventoryRefId) continue;
    const refId = line.inventoryRefId;
    if (!projected.has(refId)) {
      projected.set(refId, (balances.get(refId)?.grams || 0) + (adjustments.get(refId) || 0));
    }
    const available = projected.get(refId);
    const after = available - line.weightGrams;
    projected.set(refId, after);
    if (after < -GRAM_EPS) {
      shortages.push({
        refId,
        goldType: line.goldType,
        karat: line.karat,
        productId: line.productId,
        available,
        requested: line.weightGrams,
        shortfall: line.weightGrams - available,
      });
    }
  }
  return shortages;
}

/** موجودی قابل فروش هر سطل — برای نمایش در فرم فروش (پیش از انتخاب کاربر). */
export async function availableStock() {
  return inventoryBalances();
}

// ───────────────────────── آماده‌سازی ثبت فاکتور ─────────────────────────

async function prepareCreate(rawInput) {
  // ترتیب مهم است: پیکربندی موتور قیمت پیش از اعتبارسنجی خوانده می‌شود تا قلمی که
  // نرخش وارد نشده، نرخ روزِ عیار خودش را بگیرد و بعد اعتبارسنجی شود (Phase 8).
  const pricingConfig = await loadPricingConfig();
  const normalizedInput = normalizeInput(rawInput);
  // فیِ سند بر نرخ روز مقدم است — یک فاکتور، یک نرخ.
  const docConfig = documentPricingConfig(normalizedInput, pricingConfig);
  const input = resolveLineRates(normalizedInput, docConfig);
  validateStructure(input);

  const totals = computeSaleTotals(input, docConfig);

  const fields = {};
  const lineErrors = {};
  const receiptErrors = {};

  const customer = await get('customers', input.customerId);
  if (!customer || customer.deletedAt) {
    fields.customerId = 'مشتری انتخاب‌شده یافت نشد یا حذف شده است.';
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

  for (let i = 0; i < totals.receipts.length; i += 1) {
    const rec = totals.receipts[i];
    if (rec.method !== 'cash') continue;
    const account = await get('accounts', rec.accountId);
    if (!account || account.deletedAt) {
      receiptErrors[i] = { ...(receiptErrors[i] || {}), accountId: 'حساب انتخاب‌شده یافت نشد.' };
    }
  }

  if (totals.requestedDiscountIRR > totals.subtotalIRR + IRR_EPS) {
    fields.discountIRR = 'تخفیف نمی‌تواند از جمع فاکتور (پیش از مالیات) بیشتر باشد.';
  }
  if (totals.needsRate) {
    fields.ratePerBaseGram = rateRequirementMessage(totals.rateReasons);
  }
  if (totals.remainingGrams < -BASE_GRAM_EPS) {
    fields.receipts = 'جمع دریافت‌ها از مبلغ نهایی فاکتور بیشتر است.';
  }

  const derivedMode = derivePaymentMode(totals);
  if (!fields.paymentMode && input.paymentMode !== derivedMode) {
    fields.paymentMode =
      `نوع تسویه انتخاب‌شده «${MODE_LABELS[input.paymentMode]}» با دریافت‌های ثبت‌شده هم‌خوان نیست ` +
      `(بر اساس دریافت‌ها: «${MODE_LABELS[derivedMode]}»).`;
  }

  const hasRemaining = totals.remainingGrams > BASE_GRAM_EPS;
  // (Phase 19، تصمیم ۵۸) تاریخ سررسید **اختیاری** است: در کار واقعی بسیاری از
  // اسناد رسیدی سررسید مشخصی ندارند. مانده همچنان از تخصیص‌ها مشتق می‌شود؛ فقط
  // این سند در هشدارهای سررسید نمی‌آید.

  if (input.dueDate && Number.isNaN(new Date(input.dueDate).getTime())) {
    fields.dueDate = 'تاریخ سررسید نامعتبر است.';
  }

  const validationError = new SaleValidationError({ fields, lines: lineErrors, receipts: receiptErrors });
  if (!validationError.isEmpty) throw validationError;

  // کنترل موجودی — بلاک‌کننده، پیش از هر نوشتنی
  const shortages = await findStockShortages(totals.lines);
  if (shortages.length) throw new InsufficientStockError(shortages);

  // ── ساخت رکوردها ──
  const now = nowIso();
  const saleId = generateId();
  const number = await nextDocumentNumber('sales', input.date);
  const receiptNumbers = await nextDocumentNumbers('receipts', input.date, totals.receipts.length);

  const receiptRecords = totals.receipts.map((rec, i) => ({
    id: generateId(),
    number: receiptNumbers[i],
    ...unitsStamp(docConfig.gramsRoundingMode),
    partyType: 'customer',
    partyId: input.customerId,
    method: rec.method,
    amountIRR: rec.method === 'cash' ? rec.valueIRR : null,
    accountId: rec.method === 'cash' ? rec.accountId : null,
    weightGrams: rec.method === 'gold' ? rec.weightGrams : null,
    karat: rec.method === 'gold' ? rec.karat : null,
    goldType: rec.method === 'gold' ? rec.goldType : null,
    productId: rec.method === 'gold' ? rec.productId : null,
    ratePerGram: rec.method === 'gold' ? rec.ratePerGram : null,
    labName: rec.method === 'gold' ? rec.labName || null : null,
    valueIRR: rec.valueIRR,
    /** (Phase 19) ارزش این دریافت به گرم ۷۵۰. */
    valueGrams: totals.receiptGoldParts[i]?.totalGrams || 0,
    relatedDueDateId: null,
    relatedSaleId: saleId,
    date: input.date,
    description: rec.description,
    transactionIds: [],
    status: 'confirmed',
    createdAt: now,
  }));

  const dueDateRecord = hasRemaining && input.dueDate
    ? {
        id: generateId(),
        sourceType: 'sale',
        sourceId: saleId,
        partyType: 'customer',
        partyId: input.customerId,
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

  const sale = {
    id: saleId,
    // Phase 22: پروفایل واحد این سند (عیار هزاری، گرم ۷۵۰ سه رقمی).
    ...unitsStamp(docConfig.gramsRoundingMode),
    number,
    customerId: input.customerId,
    customerNameSnapshot: customer?.name || '',
    date: input.date,
    paymentMode: derivedMode,
    lines: totals.lines,
    productIds: totals.lines.map((l) => l.productId).filter(Boolean),
    totalGoldPriceIRR: totals.totalGoldPriceIRR,
    totalWageIRR: totals.totalWageIRR,
    totalProfitIRR: totals.totalProfitIRR,
    totalTaxIRR: totals.totalTaxIRR,
    subtotalIRR: totals.subtotalIRR,
    discountIRR: totals.discountIRR,
    grandTotalIRR: totals.grandTotalIRR,
    totalWeightGrams: totals.totalWeightGrams,
    receivedCashIRR: totals.receivedCashIRR,
    receivedGoldGrams: totals.receivedGoldGrams,
    receivedGoldValueIRR: totals.receivedGoldValueIRR,
    remainingIRR: totals.remainingIRR,
    // ── واحد رسمی: گرم ۷۵۰ (Phase 19) ──
    ratePerBaseGram: totals.ratePerBaseGram,
    totalBaseGrams: totals.totalBaseGrams,
    totalWageGrams: totals.totalWageGrams,
    grandTotalGrams: totals.grandTotalGrams,
    receivedTotalGrams: totals.receivedTotalGrams,
    remainingGrams: totals.remainingGrams,
    returnedGrams: 0,
    status: hasRemaining ? 'open' : 'settled',
    dueDate: dueDateRecord ? input.dueDate : null,
    dueDateId: dueDateRecord ? dueDateRecord.id : null,
    receiptIds: receiptRecords.map((r) => r.id),
    transactionIds: [],
    description: input.description,
    pricingSnapshot: { ...pricingSnapshot(docConfig, 'sale'), discountScope: 'invoice-before-tax' },
    returnedWeightGrams: 0,
    returnedAmountIRR: 0,
    returnStatus: 'none',
    returnIds: [],
    voidedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  // ── طرح دفاتر ──
  const plan = newPlan();
  const saleTx = addTransaction(plan, {
    type: 'sale',
    sourceType: 'sale',
    sourceId: sale.id,
    date: sale.date,
  });

  for (const [idx, line] of totals.lines.entries()) {
    addGoldEntry(plan, {
      transactionId: saleTx.id,
      direction: 'OUT',
      reason: 'sale',
      accountRef: { kind: 'inventory', id: line.inventoryRefId },
      goldType: line.goldType,
      karat: line.karat,
      productId: line.productId,
      weightGrams: line.weightGrams,
      date: sale.date,
    });
    addMoneyEntry(plan, {
      transactionId: saleTx.id,
      reason: 'sale',
      accountRef: { kind: 'inventory', id: line.inventoryRefId },
      credit: line.lineTotalIRR,
      creditGrams: totals.lineGoldParts[idx]?.totalGrams || 0,
      date: sale.date,
    });
  }

  addMoneyEntry(plan, {
    transactionId: saleTx.id,
    reason: 'sale',
    accountRef: { kind: 'customer', id: sale.customerId },
    debit: sale.grandTotalIRR,
    debitGrams: sale.grandTotalGrams,
    date: sale.date,
  });

  for (const rec of receiptRecords) {
    if (rec.method === 'cash') {
      const tx = addTransaction(plan, {
        type: 'receipt_cash',
        sourceType: 'receipt',
        sourceId: rec.id,
        date: rec.date,
      });
      rec.transactionIds = [tx.id];
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'receive',
        accountRef: { kind: 'account', id: rec.accountId },
        debit: rec.valueIRR,
        debitGrams: rec.valueGrams,
        date: rec.date,
      });
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'receive',
        accountRef: { kind: 'customer', id: sale.customerId },
        credit: rec.valueIRR,
        creditGrams: rec.valueGrams,
        date: rec.date,
      });
    } else {
      const tx = addTransaction(plan, {
        type: 'receipt_gold',
        sourceType: 'receipt',
        sourceId: rec.id,
        date: rec.date,
      });
      rec.transactionIds = [tx.id];
      const refId = inventoryRefId(rec);
      addGoldEntry(plan, {
        transactionId: tx.id,
        direction: 'IN',
        reason: 'receipt_gold',
        accountRef: { kind: 'inventory', id: refId },
        goldType: rec.goldType,
        karat: rec.karat,
        productId: rec.productId,
        weightGrams: rec.weightGrams,
        date: rec.date,
      });
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'receive',
        accountRef: { kind: 'inventory', id: refId },
        debit: rec.valueIRR,
        debitGrams: rec.valueGrams,
        date: rec.date,
      });
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'receive',
        accountRef: { kind: 'customer', id: sale.customerId },
        credit: rec.valueIRR,
        creditGrams: rec.valueGrams,
        date: rec.date,
      });
    }
  }

  sale.transactionIds = plan.transactions.map((t) => t.id);
  assertBalanced(plan);

  // (Phase 11) دریافت‌های همراه فاکتور ۱۰۰٪ به همین فاکتور تخصیص می‌یابند؛ FIFO اینجا
  // بی‌معناست چون این پول به‌تعریف بابت همین فروش است.
  const allocationRecords = receiptRecords.flatMap((rec) =>
    buildAllocationRecords({
      docType: 'receipt',
      docId: rec.id,
      docNumber: rec.number,
      partyType: 'customer',
      partyId: sale.customerId,
      date: rec.date,
      splits: [
        {
          targetId: sale.id,
          targetType: 'sale',
          number: sale.number,
          amountIRR: rec.valueIRR,
          amountGrams: rec.valueGrams,
        },
      ],
      auto: true,
      now,
    })
  );

  return { sale, receiptRecords, dueDateRecord, plan, totals, allocationRecords };
}

/** رکوردهای دفتر و تراکنش‌های یک سند (فاکتور یا برگشت). */
async function loadPostings(doc) {
  const transactions = [];
  const goldEntries = [];
  const moneyEntries = [];
  for (const txId of doc.transactionIds || []) {
    const tx = await get('transactions', txId);
    if (!tx) continue;
    transactions.push(tx);
    goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
    moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
  }
  return { transactions, goldEntries, moneyEntries };
}

// ─────────────────────────────── عملیات اصلی ───────────────────────────────

/** ثبت فاکتور فروش — کل عملیات در یک IndexedDB Transaction. */
export async function createSale(input) {
  const prepared = await prepareCreate(input);
  const { sale, receiptRecords, dueDateRecord, plan, allocationRecords } = prepared;
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('sales').add(sale);
    for (const rec of receiptRecords) tx.objectStore('receipts').add(rec);
    for (const alloc of allocationRecords) tx.objectStore('allocations').add(alloc);
    if (dueDateRecord) tx.objectStore('dueDates').add(dueDateRecord);
    writePlan(tx, plan);
    registerLabsInTx(tx, labNamesOf(receiptRecords), timestamp);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'sales',
      entityId: sale.id,
      action: 'create',
      before: null,
      after: sale,
      timestamp,
    });
  });

  return { sale, receipts: receiptRecords, dueDate: dueDateRecord };
}

/**
 * لغو فاکتور: Reversal کامل دفاتر ⇒ طلا به موجودی برمی‌گردد و طلب مشتری صفر می‌شود.
 * فاکتوری که برگشت ثبت‌شده‌ی فعال دارد لغو نمی‌شود (ابتدا باید برگشت لغو شود)،
 * وگرنه یک سند برگشت بی‌صاحب باقی می‌ماند که به فاکتوری باطل ارجاع می‌دهد.
 */
export async function voidSale(id, { note = '' } = {}) {
  const sale = await get('sales', id);
  if (!sale) throw new SaleStateError('فاکتور فروش مورد نظر یافت نشد.');
  if (sale.status === 'voided') return sale; // Idempotent

  const returns = await getByIndex('saleReturns', 'saleId', id);
  const activeReturns = returns.filter((r) => r.status !== 'voided');
  if (activeReturns.length) {
    throw new SaleStateError(
      `این فاکتور ${activeReturns.length} سند برگشت فعال دارد؛ ابتدا آن‌ها را لغو کنید.`
    );
  }

  const { transactions, goldEntries, moneyEntries } = await loadPostings(sale);
  for (const tx of transactions) {
    if (tx.reversedBy) throw new SaleStateError('این فاکتور قبلاً یک بار خنثی شده است.');
  }

  const allReceipts = await getByIndex('receipts', 'party', ['customer', sale.customerId]);
  const external = allReceipts.filter(
    (r) => r.relatedSaleId === sale.id && r.status !== 'voided' && !(sale.receiptIds || []).includes(r.id)
  );
  if (external.length) {
    throw new SaleStateError(`این فاکتور ${external.length} دریافت بعدی دارد؛ ابتدا آن‌ها را لغو کنید.`);
  }

  const now = nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: now });
  assertBalanced(plan);

  const voidedSale = {
    ...sale,
    status: 'voided',
    voidedAt: now,
    voidNote: note || sale.voidNote || '',
    updatedAt: now,
    transactionIds: [...(sale.transactionIds || []), ...plan.transactions.map((t) => t.id)],
  };

  const receipts = (await Promise.all((sale.receiptIds || []).map((rid) => get('receipts', rid)))).filter(Boolean);
  const voidedReceipts = receipts.map((r) => ({ ...r, status: 'voided', voidedAt: now }));
  const dueDate = sale.dueDateId ? await get('dueDates', sale.dueDateId) : null;
  const voidedDueDate = dueDate ? { ...dueDate, status: 'voided', updatedAt: now } : null;
  // (Phase 11) تخصیص‌های این فاکتور باطل می‌شوند؛ اسناد تسویه‌ی مستقل باطل نمی‌شوند و
  // مبلغشان به «علی‌الحساب» مشتری برمی‌گردد.
  const voidedAllocations = await prepareTargetVoid(sale.id, { now });
  const originalTransactions = new Map(transactions.map((t) => [t.id, t]));

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('sales').put(voidedSale);
    for (const rec of voidedReceipts) tx.objectStore('receipts').put(rec);
    for (const alloc of voidedAllocations) tx.objectStore('allocations').put(alloc);
    if (voidedDueDate) tx.objectStore('dueDates').put(voidedDueDate);
    writePlan(tx, plan, originalTransactions);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'sales',
      entityId: sale.id,
      action: 'void',
      before: sale,
      after: voidedSale,
      timestamp: now,
    });
  });

  return voidedSale;
}

// ───────────────────────── برگشت از فروش (Phase 7) ─────────────────────────

/** وزن و مبلغ قابل برگشت هر قلم فاکتور (باقیمانده پس از برگشت‌های قبلی). */
export function returnableLines(sale) {
  return (sale.lines || []).map((line, index) => {
    const returned = num(line.returnedWeightGrams);
    const remainingWeight = Math.max(0, num(line.weightGrams) - returned);
    return {
      index,
      goldType: line.goldType,
      // Phase 22: فاکتور پیش از v10 عیار ۲۴تایی و شناسه‌ی سطل قدیمی دارد؛ خودِ فاکتور
      // دست نمی‌خورد، فقط اینجا به عیار هزاری و سطل v10 ترجمه می‌شود تا طلای برگشتی
      // به همان سطلی برگردد که مهاجرت ساخته است.
      karat: finenessOf(sale, line.karat),
      productId: line.productId,
      inventoryRefId: inventoryRefOfDoc(sale, line.inventoryRefId),
      weightGrams: num(line.weightGrams),
      returnedWeightGrams: returned,
      remainingWeightGrams: remainingWeight,
      lineTotalIRR: num(line.lineTotalIRR),
      /** ارزش هر گرم این قلم در **همان فاکتور** (شامل اجرت/سود/تخفیف/مالیات). */
      valuePerGram: num(line.weightGrams) > 0 ? num(line.lineTotalIRR) / num(line.weightGrams) : 0,
      // ── واحد رسمی: گرم ۷۵۰ (Phase 19) ──
      lineTotalGrams: num(line.lineTotalGrams),
      returnedGrams: num(line.returnedGrams),
      gramsPerWeight:
        num(line.weightGrams) > 0 ? num(line.lineTotalGrams) / num(line.weightGrams) : 0,
    };
  });
}

/**
 * ثبت سند برگشت از فروش (جزئی یا کامل، قلم‌به‌قلم).
 *
 * @param {string} saleId فاکتور مرجع
 * @param {object} input `{date, description, lines: [{index, weightGrams}]}`
 *
 * مبلغ برگشت هر قلم به نسبت وزن، از **مبلغ نهایی همان قلم در همان فاکتور**
 * محاسبه می‌شود (شامل اجرت، سود، سهم تخفیف و مالیات). یعنی مشتری دقیقاً همان
 * چیزی را پس می‌گیرد که پرداخته بود، نه قیمت روزِ امروز.
 */
export async function createSaleReturn(saleId, input = {}) {
  const sale = await get('sales', saleId);
  if (!sale) throw new SaleStateError('فاکتور فروش مورد نظر یافت نشد.');
  if (sale.status === 'voided') throw new SaleStateError('فاکتور باطل‌شده قابل برگشت نیست.');

  const date = input.date ? new Date(input.date).toISOString() : nowIso();
  if (Number.isNaN(new Date(date).getTime())) {
    throw new SaleValidationError({ fields: { date: 'تاریخ برگشت نامعتبر است.' } });
  }
  if (String(date) < String(sale.date)) {
    throw new SaleValidationError({ fields: { date: 'تاریخ برگشت نمی‌تواند پیش از تاریخ فاکتور باشد.' } });
  }

  const pricingConfig = await loadPricingConfig();
  const available = returnableLines(sale);
  const fields = {};
  const lineErrors = {};

  const requested = (Array.isArray(input.lines) ? input.lines : [])
    // Phase 22: وزن برگشتی عیناً (سه رقم اعشار) — گام وزن دیگر وجود ندارد.
    .map((l) => ({ index: Number(l.index), weightGrams: roundWeight(num(l.weightGrams)) }))
    .filter((l) => l.weightGrams > 0);

  if (!requested.length) fields.lines = 'حداقل یک قلم با وزن بزرگ‌تر از صفر برای برگشت لازم است.';

  const returnLines = [];
  requested.forEach((req, i) => {
    const source = available[req.index];
    if (!source) {
      lineErrors[i] = { index: 'قلم انتخاب‌شده در این فاکتور وجود ندارد.' };
      return;
    }
    if (req.weightGrams > source.remainingWeightGrams + GRAM_EPS) {
      lineErrors[i] = {
        weightGrams: `حداکثر وزن قابل برگشت این قلم ${source.remainingWeightGrams} گرم است.`,
      };
      return;
    }
    const isFullLine = Math.abs(req.weightGrams - source.remainingWeightGrams) < GRAM_EPS;
    const alreadyReturnedAmount = num(sale.lines[req.index].returnedAmountIRR);
    // برای برگشت کامل باقیمانده، مبلغ دقیقاً «مانده‌ی مبلغ قلم» است تا اثر گِردکردن
    // در برگشت‌های جزئی متوالی روی هم انباشته نشود.
    const amountIRR = isFullLine
      ? source.lineTotalIRR - alreadyReturnedAmount
      : roundAmount(source.valuePerGram * req.weightGrams, pricingConfig);
    // همان قاعده، در واحد رسمی: برگشت کاملِ باقیمانده دقیقاً «مانده‌ی گرمی قلم»
    // است تا خطای گِردکردنِ برگشت‌های جزئی متوالی انباشته نشود.
    const amountGrams = isFullLine
      ? roundBaseGrams(source.lineTotalGrams - source.returnedGrams)
      : roundGrams750(source.gramsPerWeight * req.weightGrams, currentUnits(pricingConfig.gramsRoundingMode));

    returnLines.push({
      saleLineIndex: req.index,
      goldType: source.goldType,
      karat: source.karat,
      productId: source.productId,
      inventoryRefId: source.inventoryRefId,
      weightGrams: req.weightGrams,
      amountIRR,
      amountGrams,
    });
  });

  const error = new SaleValidationError({ fields, lines: lineErrors });
  if (!error.isEmpty) throw error;

  const now = nowIso();
  const returnId = generateId();
  const number = await nextDocumentNumber('saleReturns', date);
  const totalAmountIRR = returnLines.reduce((s, l) => s + l.amountIRR, 0);
  const totalWeightGrams = returnLines.reduce((s, l) => s + l.weightGrams, 0);
  const totalGrams = roundBaseGrams(returnLines.reduce((s, l) => s + l.amountGrams, 0));

  const returnRecord = {
    id: returnId,
    ...unitsStamp(pricingConfig.gramsRoundingMode),
    number,
    saleId: sale.id,
    saleNumberSnapshot: sale.number,
    customerId: sale.customerId,
    date,
    lines: returnLines,
    totalWeightGrams,
    totalAmountIRR,
    /** (Phase 19) واحد رسمی: گرم ۷۵۰. */
    totalGrams,
    description: String(input.description ?? '').trim(),
    status: 'confirmed',
    transactionIds: [],
    createdAt: now,
    updatedAt: now,
  };

  // ── طرح دفاتر: طلا برمی‌گردد، طلب مشتری کم می‌شود ──
  const plan = newPlan();
  const tx = addTransaction(plan, {
    type: 'sale_return',
    sourceType: 'sale_return',
    sourceId: returnId,
    date,
  });
  for (const line of returnLines) {
    addGoldEntry(plan, {
      transactionId: tx.id,
      direction: 'IN',
      reason: 'sale_return',
      accountRef: { kind: 'inventory', id: line.inventoryRefId },
      goldType: line.goldType,
      karat: line.karat,
      productId: line.productId,
      weightGrams: line.weightGrams,
      date,
    });
    if (line.amountIRR > 0 || line.amountGrams > 0) {
      addMoneyEntry(plan, {
        transactionId: tx.id,
        reason: 'sale',
        accountRef: { kind: 'inventory', id: line.inventoryRefId },
        debit: line.amountIRR,
        debitGrams: line.amountGrams,
        date,
      });
    }
  }
  if (totalAmountIRR > 0 || totalGrams > 0) {
    addMoneyEntry(plan, {
      transactionId: tx.id,
      reason: 'sale',
      accountRef: { kind: 'customer', id: sale.customerId },
      credit: totalAmountIRR,
      creditGrams: totalGrams,
      date,
    });
  }
  returnRecord.transactionIds = [tx.id];
  assertBalanced(plan);

  // ── به‌روزرسانی شمارنده‌های فاکتور (نه اعداد مالی — آن‌ها از دفتر می‌آیند) ──
  const activeAllocs = await allocationsForTarget(sale.id);
  const allocatedIRR = activeAllocs.reduce((sum, a) => sum + num(a.amountIRR), 0);
  const allocatedGrams = roundBaseGrams(activeAllocs.reduce((sum, a) => sum + num(a.amountGrams), 0));
  const updatedSale = applyReturnToSale(sale, returnRecord, +1, now, allocatedIRR, allocatedGrams);
  const dueDate = sale.dueDateId ? await get('dueDates', sale.dueDateId) : null;
  const updatedDueDate = syncDueDateWithSale(dueDate, updatedSale, allocatedGrams, now);

  await runTransaction(WRITE_STORES, 'readwrite', (t) => {
    t.objectStore('saleReturns').add(returnRecord);
    t.objectStore('sales').put(updatedSale);
    if (updatedDueDate) t.objectStore('dueDates').put(updatedDueDate);
    writePlan(t, plan);
    t.objectStore('auditLog').add({
      id: generateId(),
      entity: 'saleReturns',
      entityId: returnId,
      action: 'create',
      before: null,
      after: returnRecord,
      timestamp: now,
    });
    t.objectStore('auditLog').add({
      id: generateId(),
      entity: 'sales',
      entityId: sale.id,
      action: 'update',
      before: sale,
      after: updatedSale,
      timestamp: now,
    });
  });

  return { saleReturn: returnRecord, sale: updatedSale };
}

/** لغو سند برگشت: Reversal کامل + بازگرداندن شمارنده‌های فاکتور. */
export async function voidSaleReturn(returnId, { note = '', allowNegative = false } = {}) {
  const returnRecord = await get('saleReturns', returnId);
  if (!returnRecord) throw new SaleStateError('سند برگشت مورد نظر یافت نشد.');
  if (returnRecord.status === 'voided') return returnRecord; // Idempotent

  const sale = await get('sales', returnRecord.saleId);
  const { transactions, goldEntries, moneyEntries } = await loadPostings(returnRecord);
  for (const tx of transactions) {
    if (tx.reversedBy) throw new SaleStateError('این سند برگشت قبلاً خنثی شده است.');
  }

  const now = nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: now });
  assertBalanced(plan);
  // Phase 17: ابطال برگشت یعنی طلای برگشتی دوباره از انبار خارج می‌شود؛ اگر در
  // این فاصله فروخته شده باشد موجودی منفی می‌شود (هشدار + تأیید، نه سکوت).
  await assertPlanInventory(plan, { allowNegative, operation: 'ابطال این سند برگشت' });

  const voidedReturn = {
    ...returnRecord,
    status: 'voided',
    voidedAt: now,
    voidNote: note,
    updatedAt: now,
    transactionIds: [...(returnRecord.transactionIds || []), ...plan.transactions.map((t) => t.id)],
  };

  const activeAllocs = sale ? await allocationsForTarget(sale.id) : [];
  const allocatedIRR = activeAllocs.reduce((sum, a) => sum + num(a.amountIRR), 0);
  const allocatedGrams = roundBaseGrams(activeAllocs.reduce((sum, a) => sum + num(a.amountGrams), 0));
  const updatedSale = sale ? applyReturnToSale(sale, returnRecord, -1, now, allocatedIRR, allocatedGrams) : null;
  const dueDate = sale?.dueDateId ? await get('dueDates', sale.dueDateId) : null;
  const updatedDueDate = updatedSale ? syncDueDateWithSale(dueDate, updatedSale, allocatedGrams, now) : null;
  const originalTransactions = new Map(transactions.map((t) => [t.id, t]));

  await runTransaction(WRITE_STORES, 'readwrite', (t) => {
    t.objectStore('saleReturns').put(voidedReturn);
    if (updatedSale) t.objectStore('sales').put(updatedSale);
    if (updatedDueDate) t.objectStore('dueDates').put(updatedDueDate);
    writePlan(t, plan, originalTransactions);
    t.objectStore('auditLog').add({
      id: generateId(),
      entity: 'saleReturns',
      entityId: returnId,
      action: 'void',
      before: returnRecord,
      after: voidedReturn,
      timestamp: now,
    });
  });

  return voidedReturn;
}

/**
 * اثر یک سند برگشت را روی شمارنده‌های فاکتور اعمال (sign=+1) یا برمی‌گرداند (sign=−1).
 * این فیلدها فقط «خلاصه‌ی نمایشی» هستند؛ منبع حقیقتِ طلب مشتری و موجودی همچنان دفاتر است.
 */
/**
 * شمارنده‌های برگشت فاکتور را به‌روز می‌کند.
 *
 * (Phase 11) `allocatedIRR` از بیرون داده می‌شود و **جمع تخصیص‌های فعال همین فاکتور**
 * است، نه فقط دریافت‌های داخل فاکتور. پیش از Phase 11 مانده از `receivedCashIRR +
 * receivedGoldValueIRR` (یعنی فقط دریافت لحظه‌ی ثبت) حساب می‌شد؛ آن فرمول فاکتوری را
 * که بعداً با یک سند تسویه‌ی مستقل بسته شده بود، بعد از هر برگشت دوباره «باز» می‌کرد.
 */
function applyReturnToSale(sale, returnRecord, sign, timestamp, allocatedIRR = null, allocatedGrams = null) {
  const lines = sale.lines.map((line, i) => {
    const hit = returnRecord.lines.filter((l) => l.saleLineIndex === i);
    if (!hit.length) return line;
    const w = hit.reduce((s, l) => s + l.weightGrams, 0) * sign;
    const a = hit.reduce((s, l) => s + l.amountIRR, 0) * sign;
    const g = hit.reduce((s, l) => s + num(l.amountGrams), 0) * sign;
    return {
      ...line,
      returnedWeightGrams: Math.max(0, num(line.returnedWeightGrams) + w),
      returnedAmountIRR: Math.max(0, num(line.returnedAmountIRR) + a),
      returnedGrams: Math.max(0, roundBaseGrams(num(line.returnedGrams) + g)),
    };
  });

  const returnedWeightGrams = lines.reduce((s, l) => s + num(l.returnedWeightGrams), 0);
  const returnedAmountIRR = lines.reduce((s, l) => s + num(l.returnedAmountIRR), 0);
  const returnedGrams = roundBaseGrams(lines.reduce((s, l) => s + num(l.returnedGrams), 0));
  const soldWeight = lines.reduce((s, l) => s + num(l.weightGrams), 0);

  const returnStatus =
    returnedWeightGrams < GRAM_EPS ? 'none' : returnedWeightGrams >= soldWeight - GRAM_EPS ? 'full' : 'partial';

  const settledTotal =
    allocatedIRR === null ? num(sale.receivedCashIRR) + num(sale.receivedGoldValueIRR) : num(allocatedIRR);
  const remainingIRR = Math.max(0, num(sale.grandTotalIRR) - settledTotal - returnedAmountIRR);
  const settledGrams =
    allocatedGrams === null ? num(sale.receivedTotalGrams) : num(allocatedGrams);
  const remainingGrams = Math.max(
    0,
    roundBaseGrams(num(sale.grandTotalGrams) - settledGrams - returnedGrams)
  );

  const returnIds = new Set(sale.returnIds || []);
  if (sign > 0) returnIds.add(returnRecord.id);
  else returnIds.delete(returnRecord.id);

  return {
    ...sale,
    lines,
    returnedWeightGrams,
    returnedAmountIRR,
    returnedGrams,
    returnStatus,
    remainingIRR,
    remainingGrams,
    status:
      sale.status === 'voided' ? 'voided' : remainingGrams > BASE_GRAM_EPS ? 'open' : 'settled',
    returnIds: [...returnIds],
    updatedAt: timestamp,
  };
}

/**
 * سررسید فاکتور پس از ثبت/لغو برگشت.
 *
 * (Phase 12) مبلغ سررسید از روی **فاکتورِ به‌روزشده بازسازی** می‌شود، نه با جمع/تفریقِ
 * مبلغ برگشت روی مقدار قبلی. نسخه‌ی قبلی (`adjustDueDateForReturn`) دو خطای واقعی داشت
 * که تست Phase 12 پیدا کرد:
 *   ۱) مبلغ با `Math.max(0, …)` بریده می‌شد؛ برگشتی بزرگ‌تر از مانده سررسید را صفر
 *      می‌کرد و لغو همان برگشت، سررسید را **بزرگ‌تر از مبلغ واقعی** برمی‌گرداند
 *      (۴ میلیون → صفر → ۵ میلیون).
 *   ۲) سررسید `paid` اصلاً به‌روز نمی‌شد؛ پس لغو برگشتی که فاکتور را بسته بود، فاکتور
 *      را دوباره باز می‌کرد ولی سررسیدش «تسویه‌شده» می‌ماند و از هشدارها پنهان می‌شد.
 *
 *   مبلغ سررسید = کل فاکتور − دریافت لحظه‌ی ثبت − برگشت‌ها   (همان تعریف ساخت سررسید)
 *   وضعیت      = dueDateStatusOf(…)  با مانده‌ی مشتق‌شده (همان تابع همگام‌سازی Phase 11)
 *
 * اگر مبلغ به صفر برسد وضعیت `voided` می‌گیرد — نه `paid`، چون چیزی پرداخت نشده است.
 * @returns رکورد به‌روزشده، یا null اگر تغییری لازم نیست.
 */
function syncDueDateWithSale(dueDate, updatedSale, allocatedGrams, timestamp) {
  if (!dueDate || !updatedSale || updatedSale.status === 'voided') return null;
  // (Phase 19) همان بازسازی، در واحد رسمی: گرم ۷۵۰.
  const nextGrams = roundBaseGrams(
    Math.max(
      0,
      num(updatedSale.grandTotalGrams) -
        num(updatedSale.receivedTotalGrams) -
        num(updatedSale.returnedGrams)
    )
  );
  const nextAmount = roundIRR(
    Math.max(
      0,
      num(updatedSale.grandTotalIRR) -
        num(updatedSale.receivedCashIRR) -
        num(updatedSale.receivedGoldValueIRR) -
        num(updatedSale.returnedAmountIRR)
    )
  );
  let status;
  if (nextGrams < BASE_GRAM_EPS) {
    status = 'voided';
  } else {
    const outstanding = Math.max(
      0,
      roundBaseGrams(
        num(updatedSale.grandTotalGrams) - num(updatedSale.returnedGrams) - num(allocatedGrams)
      )
    );
    status = dueDateStatusOf({ ...dueDate, amountGrams: nextGrams, status: 'pending' }, outstanding);
  }
  if (
    Math.abs(nextGrams - num(dueDate.amountGrams)) < BASE_GRAM_EPS &&
    status === dueDate.status
  ) {
    return null;
  }
  return { ...dueDate, amountIRR: nextAmount, amountGrams: nextGrams, status, updatedAt: timestamp };
}

// ──────────────────────────── خواندن برای UI ────────────────────────────

export async function getSale(id) {
  return get('sales', id);
}

/** فهرست فاکتورها با جستجو/فیلتر. status: 'all' | 'open' | 'settled' | 'voided' | 'returned' */
export async function listSales({ search = '', status = 'all', customerId = null, from = null, to = null } = {}) {
  const [all, customers] = await Promise.all([getAll('sales'), getAll('customers')]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const term = search.trim().toLowerCase();

  return all
    .filter((s) => {
      if (s.deletedAt) return false;
      if (status === 'returned') {
        if (!s.returnStatus || s.returnStatus === 'none') return false;
      } else if (status !== 'all' && s.status !== status) {
        return false;
      }
      if (customerId && s.customerId !== customerId) return false;
      if (from && String(s.date) < from) return false;
      if (to && String(s.date) > to) return false;
      if (term) {
        const customer = customerById.get(s.customerId);
        const haystack = `${s.number} ${customer?.name || s.customerNameSnapshot || ''} ${customer?.code || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .map((s) => ({
      ...s,
      customerName: customerById.get(s.customerId)?.name || s.customerNameSnapshot || '—',
      customerCode: customerById.get(s.customerId)?.code || '',
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
}

/** جمع‌های نوار خلاصه — بر اساس همان ردیف‌های نمایش‌داده‌شده. */
export function summarizeSales(rows) {
  const active = rows.filter((r) => r.status !== 'voided');
  return {
    count: active.length,
    totalIRR: active.reduce((s, r) => s + num(r.grandTotalIRR), 0),
    totalWeightGrams: active.reduce((s, r) => s + num(r.totalWeightGrams), 0),
    openRemainingIRR: active.filter((r) => r.status === 'open').reduce((s, r) => s + num(r.remainingIRR), 0),
    returnedIRR: active.reduce((s, r) => s + num(r.returnedAmountIRR), 0),
  };
}

/** تمام داده‌های صفحه جزئیات فاکتور، در یک بار خواندن. */
export async function getSaleSummary(id) {
  const sale = await get('sales', id);
  if (!sale) throw new SaleStateError('فاکتور فروش مورد نظر یافت نشد.');

  const [customer, postings, dueDate, history, returns] = await Promise.all([
    get('customers', sale.customerId),
    loadPostings(sale),
    sale.dueDateId ? get('dueDates', sale.dueDateId) : Promise.resolve(null),
    getSaleHistory(id),
    getByIndex('saleReturns', 'saleId', id),
  ]);

  const receipts = (await Promise.all((sale.receiptIds || []).map((rid) => get('receipts', rid)))).filter(Boolean);

  return {
    sale,
    customer: customer || null,
    receipts,
    dueDate,
    /** (Phase 12) همان سررسید با مانده و وضعیت زمانیِ مشتق‌شده. */
    dueItem: dueDate ? await getDueItem(dueDate.id) : null,
    returns: returns.sort((a, b) => String(b.date).localeCompare(String(a.date))),
    returnable: returnableLines(sale),
    transactions: postings.transactions,
    goldEntries: postings.goldEntries.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    moneyEntries: postings.moneyEntries.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    history,
  };
}

/** تاریخچه تغییرات فاکتور از auditLog (شامل رویدادهای برگشت مرتبط). */
export async function getSaleHistory(id) {
  const entries = await getByIndex('auditLog', 'entityId', id);
  return entries
    .filter((e) => e.entity === 'sales')
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

/** فهرست اسناد برگشت (برای گزارش‌ها و صفحه فاکتور). */
export async function listSaleReturns({ saleId = null, customerId = null } = {}) {
  const all = saleId
    ? await getByIndex('saleReturns', 'saleId', saleId)
    : customerId
      ? await getByIndex('saleReturns', 'customerId', customerId)
      : await getAll('saleReturns');
  return all.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
