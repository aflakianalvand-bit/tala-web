// inventoryDocs.js — اسناد انبار: «اصلاح موجودی» و «ذوب/تبدیل» (Phase 10)
//
// ═══════════════════════════════════════════════════════════════════════════
// مسئله‌ای که این فایل حل می‌کند (PROJECT INSTRUCTIONS §۲۰):
//
//   «currentStock نباید قابل ویرایش مستقیم باشد. هر اصلاح موجودی باید
//    Adjustment Transaction داشته باشد.»
//
// در این معماری اصلاً فیلدی به نام `currentStock` وجود ندارد که بشود ویرایشش
// کرد — موجودی همیشه از `goldLedger` مشتق می‌شود (services/inventory.js). پس
// «اصلاح موجودی» یعنی **ثبت یک رویداد جدید**، نه تغییر یک عدد. این فایل تنها
// مسیر مجاز ثبت آن رویداد است و هر اصلاح را به یک سند شماره‌دار، تاریخ‌دار،
// توضیح‌دار و **قابل ابطال** گره می‌زند.
//
// دو تصمیم کسب‌وکاری Phase 10 که پرسیده شد و حدس زده نشد:
//
//   ۱. ذوب = **سند تبدیل دوطرفه با درصد افت**. یک سند اتمیک: خروج از سطل مبدأ +
//      ورود به سطل مقصد؛ تفاوت وزن همان «افت ذوب» است که هم در گرم و هم در ریال
//      دیده می‌شود. (گزینه‌ی «فقط خروج» رد شد چون ارتباط دو سند گم می‌شد.)
//
//   ۲. اصلاح موجودی **ارزش ریالی را هم اصلاح می‌کند**، با دسته‌ی «اضافی انبار» /
//      «کسری انبار» در دفتر وجه. اگر فقط گرم اصلاح می‌شد، سطلی که موجودی‌اش صفر
//      شده می‌توانست تا ابد یک مانده‌ی ریالی بی‌صاحب نگه دارد و «ارزش انبار» در
//      گزارش‌های Phase 14 بی‌معنا می‌شد.
//
// قاعده‌ی ارزش‌گذاری — عمداً نامتقارن، با دلیل:
//   • ورود (اضافی/ابتدای دوره/ورود مستقیم) → به **نرخ روز** همان عیار، چون این
//     طلا بهای تمام‌شده‌ی ثبت‌شده‌ای در سیستم ندارد و باید از جایی ارزش بگیرد.
//   • خروج (کسری/خروج مستقیم/ذوب)          → به **ارزش دفتری سهم همان وزن** از
//     سطل، دقیقاً مثل انتقال Phase 9. اگر خروج به نرخ روز ارزش‌گذاری می‌شد، سطل
//     می‌توانست با موجودی مثبت مانده‌ی ریالی منفی بگیرد — یعنی طلایی که هست ولی
//     «ارزشی ندارد».
// ═══════════════════════════════════════════════════════════════════════════

import {
  isValidFineness,
  isValidScaleWeight,
  FINENESS_ERROR,
  WEIGHT_DECIMALS_ERROR,
  unitsStamp,
  inventoryRefOfDoc,
} from './units.js';
import { get, getAll, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { nextDocumentNumber } from './docNumber.js';
import { roundWeight, ratePerGramForKarat } from './pricing.js';
import { getPricingConfig } from './priceRates.js';
import { inventoryRefId, inventoryBalances, moneyBalanceOf } from './ledger.js';
import { checkAvailable, proportionalBookValue, assertPlanInventory, GRAM_EPS, IRR_EPS } from './inventory.js';
import {
  newPlan,
  addTransaction,
  addGoldEntry,
  addMoneyEntry,
  addReversal,
  assertBalanced,
  writePlan,
} from './postings.js';

export const INVENTORY_DOC_KINDS = ['adjustment', 'melt'];
export const INVENTORY_DOC_STATUSES = ['confirmed', 'voided'];

/** Storeهایی که یک عملیات کامل سند انبار به آن‌ها می‌نویسد — همه در یک تراکنش. */
const WRITE_STORES = ['inventoryDocs', 'transactions', 'goldLedger', 'moneyLedger', 'auditLog'];

/**
 * دسته‌های سند «اصلاح موجودی».
 *   `direction`   جهت اثر روی انبار
 *   `reason`      مقداری که در `goldLedger.reason` نوشته می‌شود — همین است که گزارش
 *                 فرمول موجودی (services/inventory.js) هر دسته را در ردیف خودش می‌نشاند.
 *   `counterpart` کلید دسته‌ی طرف مقابل در دفتر وجه (`accountRef.kind='other'`).
 *
 * این فهرست عمداً در کد است و نه در دیتابیس — دقیقاً همان استدلال CASH_CATEGORIES
 * در Phase 9: هر دسته یک معنای حسابداری دارد که گزارش‌ها روی آن حساب می‌کنند.
 */
export const INVENTORY_CATEGORIES = [
  {
    key: 'opening',
    label: 'مانده ابتدای دوره',
    direction: 'in',
    reason: 'opening',
    counterpart: 'opening',
    hint: 'طلایی که پیش از شروع کار با نرم‌افزار در انبار بوده است.',
  },
  {
    key: 'countSurplus',
    label: 'اضافی انبار (شمارش)',
    direction: 'in',
    reason: 'adjustment',
    counterpart: 'inventoryGain',
    hint: 'انبارگردانی نشان داده طلای بیشتری از دفتر موجود است.',
  },
  {
    key: 'countShortage',
    label: 'کسری انبار (شمارش)',
    direction: 'out',
    reason: 'adjustment',
    counterpart: 'inventoryLoss',
    hint: 'انبارگردانی نشان داده طلای کمتری از دفتر موجود است.',
  },
  {
    key: 'goldIn',
    label: 'ورود مستقیم طلا',
    direction: 'in',
    reason: 'gold_in',
    counterpart: 'inventoryGain',
    hint: 'ورود طلا بدون طرف حساب — مثلاً بازگشت طلا از کارگاه.',
  },
  {
    key: 'goldOut',
    label: 'خروج مستقیم طلا',
    direction: 'out',
    reason: 'gold_out',
    counterpart: 'inventoryLoss',
    hint: 'خروج طلا بدون طرف حساب — مثلاً ارسال به کارگاه.',
  },
];

export const INVENTORY_CATEGORY_LABELS = Object.fromEntries(
  INVENTORY_CATEGORIES.map((c) => [c.key, c.label])
);

/** دسته‌ی طرف مقابلِ ریالیِ افت ذوب (در همان فضای نام `other` دفتر وجه). */
export const MELT_LOSS_CATEGORY = 'meltLoss';

export function categoryByKey(key) {
  return INVENTORY_CATEGORIES.find((c) => c.key === key) || null;
}

/** دسته‌های مجاز برای یک جهت ('in' = ورود به انبار، 'out' = خروج). */
export function inventoryCategoriesFor(direction) {
  return INVENTORY_CATEGORIES.filter((c) => c.direction === direction);
}

// ────────────────────────────────── خطاها ──────────────────────────────────

/** خطای اعتبارسنجی با نگاشت field → پیام (UI_GUIDELINES §3). */
export class InventoryValidationError extends Error {
  constructor(fieldErrors) {
    super('اطلاعات سند انبار نامعتبر است.');
    this.name = 'InventoryValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class InventoryStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InventoryStateError';
  }
}

/**
 * کمبود موجودی هنگام خروج — طبق INVENTORY_RULES §۵ این یک **هشدار** است نه بلاک:
 * هیچ‌چیز نوشته نمی‌شود، UI کسری را نشان می‌دهد و با تأیید صریح کاربر همان عملیات
 * با `allowNegative: true` دوباره اجرا می‌شود.
 * (تنها استثنای این سیاست، فروش است — §۵.۰ — که هیچ مسیر Override ندارد.)
 */
export class InventoryShortageError extends Error {
  constructor(shortages) {
    super('موجودی سطل انبار برای این عملیات کافی نیست.');
    this.name = 'InventoryShortageError';
    this.shortages = shortages;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeZero(n) {
  return n === 0 ? 0 : n;
}

// ───────────────────── شناسایی سطل از ورودی کاربر ─────────────────────

/**
 * ورودی سطل را به `{refId, goldType, karat, productId}` تبدیل می‌کند.
 * ورودی می‌تواند `refId` یک سطل موجود باشد یا مشخصات یک سطل (که ممکن است هنوز
 * وجود نداشته باشد — مثل اولین «مانده ابتدای دوره»).
 */
async function resolveBucket(spec, { buckets, products }) {
  if (!spec) return null;

  if (typeof spec === 'string' || spec.refId) {
    const refId = typeof spec === 'string' ? spec : spec.refId;
    const existing = buckets.get(refId);
    if (existing) {
      const product = existing.productId ? products.find((p) => p.id === existing.productId) : null;
      return {
        refId,
        goldType: existing.goldType,
        karat: product ? num(product.karat) : num(existing.karat),
        productId: existing.productId || null,
      };
    }
    // سطل هنوز رکورد دفتری ندارد: شناسه را تجزیه می‌کنیم.
    const [head, tail] = String(refId).split(':');
    if (head === 'product') {
      const product = products.find((p) => p.id === tail);
      if (!product) return null;
      return { refId, goldType: product.type, karat: num(product.karat), productId: product.id };
    }
    if (!head || !tail || Number.isNaN(Number(tail))) return null;
    return { refId, goldType: head, karat: Number(tail), productId: null };
  }

  const productId = spec.productId || null;
  if (productId) {
    const product = products.find((p) => p.id === productId);
    if (!product || product.deletedAt) return null;
    return {
      refId: inventoryRefId({ goldType: product.type, karat: product.karat, productId }),
      goldType: product.type,
      karat: num(product.karat),
      productId,
    };
  }

  if (!spec.goldType || !isValidFineness(spec.karat)) return null;
  return {
    refId: inventoryRefId({ goldType: spec.goldType, karat: spec.karat, productId: null }),
    goldType: spec.goldType,
    karat: num(spec.karat),
    productId: null,
  };
}

/**
 * دو رکورد متوازنِ دفتر وجه برای جابه‌جایی ارزش بین انبار و یک دسته‌ی `other`.
 * علامت منفی (که طبق ACCOUNTING_RULES §3.4 ممکن است) جهت هر دو رکورد را برمی‌گرداند،
 * تا «دارایی از هیچ» ساخته نشود بلکه همان بدهی دفتری منتقل شود.
 */
function addValuePair(plan, { transactionId, reason, date, refId, categoryKey, valueIRR, toInventory }) {
  const value = Math.abs(Math.round(num(valueIRR)));
  if (value < IRR_EPS) return 0;
  const positive = num(valueIRR) > 0;
  const inventoryDebit = toInventory === positive; // ورود با مبلغ مثبت ⇒ بدهکار انبار

  addMoneyEntry(plan, {
    transactionId,
    reason,
    accountRef: { kind: 'inventory', id: refId },
    debit: inventoryDebit ? value : 0,
    credit: inventoryDebit ? 0 : value,
    date,
  });
  addMoneyEntry(plan, {
    transactionId,
    reason,
    accountRef: { kind: 'other', id: categoryKey },
    debit: inventoryDebit ? 0 : value,
    credit: inventoryDebit ? value : 0,
    date,
  });
  return value;
}

// ═════════════════════════════ اصلاح موجودی ═════════════════════════════

function normalizeAdjustmentInput(raw = {}) {
  return {
    date: raw.date || nowIso(),
    bucket: raw.refId ? { refId: raw.refId } : raw.bucket || raw.to || null,
    categoryKey: raw.categoryKey || null,
    weightGrams: num(raw.weightGrams),
    ratePerGram: raw.ratePerGram === '' || raw.ratePerGram === undefined || raw.ratePerGram === null
      ? null
      : num(raw.ratePerGram),
    description: String(raw.description ?? '').trim(),
  };
}

async function prepareAdjustment(rawInput, { allowNegative = false } = {}) {
  const input = normalizeAdjustmentInput(rawInput);
  const errors = {};

  const category = categoryByKey(input.categoryKey);
  if (!category) errors.categoryKey = 'دسته‌ی اصلاح موجودی را انتخاب کنید.';

  if (Number.isNaN(new Date(input.date).getTime())) errors.date = 'تاریخ سند نامعتبر است.';
  if (input.description.length > 500) errors.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';

  // وزن اصلاح هم مثل هر وزن دیگری در سیستم گِرد می‌شود (INVENTORY_RULES §۱): اگر این
  // قاعده اینجا رعایت نمی‌شد، اصلاح موجودی می‌توانست وزنی نامضربِ گام وارد انبار کند
  // که هیچ فروش یا انتقالی هرگز دقیقاً صفرش نمی‌کرد.
  const config = await getPricingConfig();
  const weightGrams = roundWeight(input.weightGrams, config);
  if (!(weightGrams > 0)) errors.weightGrams = 'وزن اصلاح باید بزرگ‌تر از صفر باشد.';
  else if (!isValidScaleWeight(input.weightGrams)) errors.weightGrams = WEIGHT_DECIMALS_ERROR;

  const [buckets, products] = await Promise.all([inventoryBalances(), getAll('products')]);
  const bucket = await resolveBucket(input.bucket, { buckets, products });
  if (!bucket) errors.bucket = 'سطل انبار (نوع/عیار یا کالا) را مشخص کنید.';

  if (Object.keys(errors).length > 0) throw new InventoryValidationError(errors);

  const direction = category.direction === 'in' ? 'IN' : 'OUT';

  // ── هشدار موجودی منفی (فقط خروج) ──
  let shortage = null;
  if (direction === 'OUT') {
    shortage = await checkAvailable(bucket.refId, weightGrams);
    if (shortage && !allowNegative) throw new InventoryShortageError([shortage]);
  }

  // ── ارزش‌گذاری (قاعده‌ی نامتقارن — توضیح بالای فایل) ──
  let ratePerGram = null;
  let valueIRR = 0;
  if (direction === 'IN') {
    ratePerGram = input.ratePerGram !== null && input.ratePerGram > 0
      ? input.ratePerGram
      : ratePerGramForKarat(bucket.karat, config);
    valueIRR = Math.round(weightGrams * ratePerGram);
  } else {
    valueIRR = await proportionalBookValue(bucket.refId, weightGrams);
    ratePerGram = Math.abs(weightGrams) > GRAM_EPS ? Math.round(valueIRR / weightGrams) : 0;
  }

  const docId = generateId();
  const number = await nextDocumentNumber('inventoryDocs', input.date, { kind: 'adjustment' });
  const now = nowIso();

  const plan = newPlan();
  const transaction = addTransaction(plan, {
    type: 'inventory_adjustment',
    sourceType: 'inventoryDoc',
    sourceId: docId,
    date: input.date,
  });

  addGoldEntry(plan, {
    transactionId: transaction.id,
    direction,
    reason: category.reason,
    accountRef: { kind: 'inventory', id: bucket.refId },
    goldType: bucket.goldType,
    karat: bucket.karat,
    productId: bucket.productId,
    weightGrams,
    date: input.date,
  });

  const appliedValueIRR = addValuePair(plan, {
    transactionId: transaction.id,
    reason: category.reason,
    date: input.date,
    refId: bucket.refId,
    categoryKey: category.counterpart,
    valueIRR,
    toInventory: direction === 'IN',
  });

  assertBalanced(plan);

  const record = {
    id: docId,
    number,
    ...unitsStamp(),
    kind: 'adjustment',
    category: category.key,
    categoryLabel: category.label,
    direction,
    date: input.date,
    refId: bucket.refId,
    toRefId: null,
    goldType: bucket.goldType,
    karat: bucket.karat,
    productId: bucket.productId,
    weightGrams,
    weightGramsRaw: num(rawInput.weightGrams),
    outputWeightGrams: null,
    lossGrams: 0,
    lossPercent: 0,
    ratePerGram,
    // `valueIRR`      ارزش طلای جابه‌جاشده (همیشه علامت خودش را دارد)
    // `bookDeltaIRR`  تغییر خالص ارزش دفتری همین سطل بر اثر این سند
    valueIRR,
    bookDeltaIRR: direction === 'IN' ? appliedValueIRR : -valueIRR,
    lossValueIRR: 0,
    counterpartCategory: category.counterpart,
    description: input.description,
    transactionIds: [transaction.id],
    status: 'confirmed',
    createdAt: now,
    voidedAt: null,
    voidNote: '',
  };

  return { record, plan, shortage };
}

/**
 * ثبت سند اصلاح موجودی (شامل مانده ابتدای دوره و ورود/خروج مستقیم طلا).
 * @param {object} input `{date, refId|bucket:{goldType,karat,productId}, categoryKey, weightGrams, ratePerGram?, description}`
 * @param {object} options `allowNegative: true` پس از تأیید صریح کاربر روی هشدار کمبود.
 */
/**
 * (Phase 27) وزن ورودی، خروجی و افت ذوب — یک فرمول برای ثبت (createMelt) و پیش‌نمایش فرم.
 * وزن خروجیِ واردشده مقدم است (عدد واقعی ترازو)؛ وگرنه از درصد افت ساخته می‌شود.
 * خالص و بدون اعتبارسنجی؛ خطاها در createMelt بررسی می‌شوند.
 */
export function meltWeights({ weightGrams = 0, lossPercent = 0, outputWeightGrams = null } = {}, config = {}) {
  const inputWeight = roundWeight(num(weightGrams), config);
  const outputWeight =
    outputWeightGrams !== null && outputWeightGrams !== undefined && outputWeightGrams !== ''
      ? roundWeight(num(outputWeightGrams), config)
      : roundWeight(inputWeight - (inputWeight * num(lossPercent)) / 100, config);
  const lossGrams = normalizeZero(Number((inputWeight - outputWeight).toFixed(3)));
  return { inputWeight, outputWeight, lossGrams };
}

export async function createAdjustment(input, options = {}) {
  const { record, plan, shortage } = await prepareAdjustment(input, options);
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('inventoryDocs').add(record);
    writePlan(tx, plan);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'inventoryDocs',
      entityId: record.id,
      action: 'create',
      before: null,
      after: record,
      timestamp,
    });
  });

  return { record, shortage };
}

// ═══════════════════════════════ ذوب / تبدیل ═══════════════════════════════

function normalizeMeltInput(raw = {}) {
  return {
    date: raw.date || nowIso(),
    from: raw.fromRefId ? { refId: raw.fromRefId } : raw.from || null,
    to: raw.to || null,
    weightGrams: num(raw.weightGrams),
    lossPercent: num(raw.lossPercent),
    outputWeightGrams:
      raw.outputWeightGrams === '' || raw.outputWeightGrams === undefined || raw.outputWeightGrams === null
        ? null
        : num(raw.outputWeightGrams),
    description: String(raw.description ?? '').trim(),
  };
}

async function prepareMelt(rawInput, { allowNegative = false } = {}) {
  const input = normalizeMeltInput(rawInput);
  const errors = {};

  if (Number.isNaN(new Date(input.date).getTime())) errors.date = 'تاریخ سند نامعتبر است.';
  if (input.description.length > 500) errors.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';

  const config = await getPricingConfig();
  const inputWeight = roundWeight(input.weightGrams, config);
  if (!(inputWeight > 0)) errors.weightGrams = 'وزن ورودی ذوب باید بزرگ‌تر از صفر باشد.';
  else if (!isValidScaleWeight(input.weightGrams)) errors.weightGrams = WEIGHT_DECIMALS_ERROR;

  const [buckets, products] = await Promise.all([inventoryBalances(), getAll('products')]);
  const source = await resolveBucket(input.from, { buckets, products });
  const target = await resolveBucket(input.to, { buckets, products });

  if (!source) errors.from = 'سطل مبدأ ذوب را انتخاب کنید.';
  if (!target) errors.to = 'نوع و عیار طلای خروجی از کوره را مشخص کنید.';
  if (source && target && source.refId === target.refId) {
    errors.to = 'مبدأ و مقصد ذوب نمی‌توانند یک سطل باشند؛ برای جابه‌جایی درون یک نوع/عیار از «انتقال» استفاده کنید.';
  }
  if (input.to?.productId) {
    const product = products.find((p) => p.id === input.to.productId);
    if (!product || product.deletedAt) errors.to = 'کالای مقصد یافت نشد یا حذف شده است.';
    else if (product.type !== input.to.goldType) errors.to = 'نوع طلای مقصد با نوع کالای انتخاب‌شده یکسان نیست.';
  }

  // ── وزن خروجی و افت ──
  // کاربر می‌تواند «درصد افت» بدهد یا مستقیماً «وزن خروجی از کوره» را وارد کند.
  // وزن خروجی مقدم است، چون عدد واقعیِ ترازو پس از ذوب است نه یک تخمین.
  if (input.outputWeightGrams === null && (input.lossPercent < 0 || input.lossPercent >= 100)) {
    errors.lossPercent = 'درصد افت باید بین ۰ تا ۱۰۰ باشد.';
  }
  const { outputWeight, lossGrams } = meltWeights(input, config);

  if (!errors.weightGrams) {
    if (!(outputWeight > 0)) errors.outputWeightGrams = 'وزن خروجی باید بزرگ‌تر از صفر باشد.';
    else if (outputWeight - inputWeight > GRAM_EPS) {
      errors.outputWeightGrams = 'وزن خروجی از کوره نمی‌تواند بیشتر از وزن ورودی باشد.';
    }
  }

  if (Object.keys(errors).length > 0) throw new InventoryValidationError(errors);

  const lossPercent = inputWeight > 0 ? Number(((lossGrams / inputWeight) * 100).toFixed(4)) : 0;

  // ── هشدار موجودی منفی سطل مبدأ ──
  let shortage = null;
  const found = await checkAvailable(source.refId, inputWeight);
  if (found) {
    shortage = found;
    if (!allowNegative) throw new InventoryShortageError([found]);
  }

  // ── جابه‌جایی ارزش دفتری ──
  // کل ارزشِ سهمِ وزنِ ورودی از سطل مبدأ خارج می‌شود؛ سهم افت به «افت ذوب» (هزینه)
  // می‌رود و باقی به سطل مقصد. جمع سه رکورد دقیقاً صفر است، پس تراز نمی‌شکند.
  const movedValueIRR = await proportionalBookValue(source.refId, inputWeight);
  const lossValueIRR = inputWeight > 0 ? Math.round((movedValueIRR * lossGrams) / inputWeight) : 0;
  const targetValueIRR = movedValueIRR - lossValueIRR;

  const docId = generateId();
  const number = await nextDocumentNumber('inventoryDocs', input.date, { kind: 'melt' });
  const now = nowIso();

  const plan = newPlan();
  const transaction = addTransaction(plan, {
    type: 'melt',
    sourceType: 'inventoryDoc',
    sourceId: docId,
    date: input.date,
  });

  addGoldEntry(plan, {
    transactionId: transaction.id,
    direction: 'OUT',
    reason: 'melt',
    accountRef: { kind: 'inventory', id: source.refId },
    goldType: source.goldType,
    karat: source.karat,
    productId: source.productId,
    weightGrams: inputWeight,
    date: input.date,
  });

  addGoldEntry(plan, {
    transactionId: transaction.id,
    direction: 'IN',
    reason: 'melt',
    accountRef: { kind: 'inventory', id: target.refId },
    goldType: target.goldType,
    karat: target.karat,
    productId: target.productId,
    weightGrams: outputWeight,
    date: input.date,
  });

  if (Math.abs(movedValueIRR) >= IRR_EPS) {
    const positive = movedValueIRR > 0;
    const abs = (v) => Math.abs(Math.round(v));

    addMoneyEntry(plan, {
      transactionId: transaction.id,
      reason: 'melt',
      accountRef: { kind: 'inventory', id: source.refId },
      credit: positive ? abs(movedValueIRR) : 0,
      debit: positive ? 0 : abs(movedValueIRR),
      date: input.date,
    });

    if (abs(targetValueIRR) >= IRR_EPS) {
      addMoneyEntry(plan, {
        transactionId: transaction.id,
        reason: 'melt',
        accountRef: { kind: 'inventory', id: target.refId },
        debit: positive ? abs(targetValueIRR) : 0,
        credit: positive ? 0 : abs(targetValueIRR),
        date: input.date,
      });
    }

    if (abs(lossValueIRR) >= IRR_EPS) {
      addMoneyEntry(plan, {
        transactionId: transaction.id,
        reason: 'melt',
        accountRef: { kind: 'other', id: MELT_LOSS_CATEGORY },
        debit: positive ? abs(lossValueIRR) : 0,
        credit: positive ? 0 : abs(lossValueIRR),
        date: input.date,
      });
    }
  }

  assertBalanced(plan);

  const record = {
    id: docId,
    number,
    ...unitsStamp(),
    kind: 'melt',
    category: 'melt',
    categoryLabel: 'ذوب / تبدیل',
    direction: 'OUT',
    date: input.date,
    refId: source.refId,
    toRefId: target.refId,
    goldType: source.goldType,
    karat: source.karat,
    productId: source.productId,
    toGoldType: target.goldType,
    toKarat: target.karat,
    toProductId: target.productId,
    weightGrams: inputWeight,
    weightGramsRaw: num(rawInput.weightGrams),
    outputWeightGrams: outputWeight,
    lossGrams,
    lossPercent,
    ratePerGram: null,
    valueIRR: movedValueIRR,
    bookDeltaIRR: -movedValueIRR,
    targetValueIRR,
    lossValueIRR,
    counterpartCategory: MELT_LOSS_CATEGORY,
    description: input.description,
    transactionIds: [transaction.id],
    status: 'confirmed',
    createdAt: now,
    voidedAt: null,
    voidNote: '',
  };

  return { record, plan, shortage };
}

/**
 * ثبت سند ذوب/تبدیل — یک سند اتمیک با خروج از مبدأ و ورود به مقصد.
 * @param {object} input `{date, fromRefId|from, to:{goldType,karat,productId?}, weightGrams, lossPercent?|outputWeightGrams?, description}`
 */
export async function createMelt(input, options = {}) {
  const { record, plan, shortage } = await prepareMelt(input, options);
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('inventoryDocs').add(record);
    writePlan(tx, plan);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'inventoryDocs',
      entityId: record.id,
      action: 'create',
      before: null,
      after: record,
      timestamp,
    });
  });

  return { record, shortage };
}

// ═══════════════════════════════ لغو سند ═══════════════════════════════

/**
 * لغو یک سند انبار: Reversal کامل دفاتر + وضعیت `voided`.
 * سند و تراکنش اصلی هرگز حذف یا ویرایش نمی‌شوند (ACCOUNTING_RULES §6) — اثرشان با
 * رکوردهای معکوس خنثی می‌شود، پس ردّ «چه چیزی اشتباه ثبت شد» باقی می‌ماند.
 * Idempotent: لغو دوباره‌ی یک سند باطل، خطا نمی‌دهد.
 */
export async function voidInventoryDoc(id, { note = '', allowNegative = false } = {}) {
  const record = await get('inventoryDocs', id);
  if (!record) throw new InventoryStateError('سند انبار مورد نظر یافت نشد.');
  if (record.status === 'voided') return record;

  const transactions = [];
  const goldEntries = [];
  const moneyEntries = [];
  for (const txId of record.transactionIds || []) {
    const transaction = await get('transactions', txId);
    if (!transaction) continue;
    if (transaction.reversedBy) {
      throw new InventoryStateError('این سند قبلاً یک بار خنثی شده است؛ لغو دوباره مجاز نیست.');
    }
    transactions.push(transaction);
    goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
    moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
  }

  const now = nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: now });
  assertBalanced(plan);
  // Phase 17: ابطال سندی که طلا را وارد کرده بود، خروج واقعی از انبار است.
  await assertPlanInventory(plan, { allowNegative, operation: 'ابطال این سند انبار' });

  const voided = {
    ...record,
    status: 'voided',
    voidedAt: now,
    voidNote: note || record.voidNote || '',
    transactionIds: [...(record.transactionIds || []), ...plan.transactions.map((t) => t.id)],
  };

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('inventoryDocs').put(voided);
    writePlan(tx, plan, new Map(transactions.map((t) => [t.id, t])));
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'inventoryDocs',
      entityId: voided.id,
      action: 'void',
      before: record,
      after: voided,
      timestamp: now,
    });
  });

  return voided;
}

// ══════════════════════════════════ خواندن ══════════════════════════════════

export async function getInventoryDoc(id) {
  return get('inventoryDocs', id);
}

/** فهرست اسناد انبار با فیلتر — مرتب‌شده از جدید به قدیم. */
export async function listInventoryDocs({ kind = 'all', status = 'all', refId = null, search = '' } = {}) {
  const all = await getAll('inventoryDocs');
  const term = String(search || '').trim().toLowerCase();

  return all
    .filter((doc) => {
      if (kind !== 'all' && doc.kind !== kind) return false;
      if (status !== 'all' && doc.status !== status) return false;
      // Phase 22: سند پیش از v10 شناسه‌ی سطل قدیمی (`melted:18`) دارد؛ خودِ سند دست نمی‌خورد،
      // فقط برای مقایسه به شناسه‌ی v10 ترجمه می‌شود.
      if (refId && inventoryRefOfDoc(doc, doc.refId) !== refId && inventoryRefOfDoc(doc, doc.toRefId) !== refId) return false;
      if (term) {
        const haystack = `${doc.number} ${doc.categoryLabel} ${doc.description}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate !== 0) return byDate;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

/** تاریخچه‌ی تغییرات یک سند انبار از `auditLog`. */
export async function getInventoryDocHistory(id) {
  const rows = await getByIndex('auditLog', 'entityId', id);
  return rows
    .filter((r) => r.entity === 'inventoryDocs')
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

/** جمع اثر ریالی اسناد انبار به تفکیک دسته — پایه‌ی گزارش «کسری/اضافی انبار» Phase 14. */
export async function inventoryCategoryTotals() {
  const entries = await getAll('moneyLedger');
  const keys = new Set([
    ...INVENTORY_CATEGORIES.map((c) => c.counterpart),
    MELT_LOSS_CATEGORY,
  ]);
  const totals = new Map();

  for (const entry of entries) {
    if (entry?.accountRef?.kind !== 'other') continue;
    if (!keys.has(entry.accountRef.id)) continue;
    const key = entry.accountRef.id;
    const bucket = totals.get(key) || { key, inIRR: 0, outIRR: 0 };
    bucket.inIRR += num(entry.credit);
    bucket.outIRR += num(entry.debit);
    totals.set(key, bucket);
  }

  return Array.from(totals.values()).filter(
    (t) => Math.abs(t.inIRR) >= IRR_EPS || Math.abs(t.outIRR) >= IRR_EPS
  );
}
