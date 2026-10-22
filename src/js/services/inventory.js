// inventory.js — موتور موجودی طلا (Phase 10) — لایه‌ی **خواندن**
//
// ═══════════════════════════════════════════════════════════════════════════
// اصل بنیادین (PROJECT INSTRUCTIONS §۲۰ و INVENTORY_RULES §۳):
//   هیچ عددی به نام «موجودی فعلی» در هیچ رکوردی ذخیره نمی‌شود.
//   موجودی *همیشه* در لحظه از روی رکوردهای `goldLedger` محاسبه می‌شود.
//
// این فایل تنها مرجع مجاز «تفسیر» دفتر طلا به زبان انبار است: تفکیک سطل‌ها،
// شکستن گردش به اجزای فرمول، و ارزش‌گذاری. نوشتن در دفتر اینجا انجام نمی‌شود؛
// اسناد انبار (اصلاح موجودی / ذوب) در `services/inventoryDocs.js` هستند.
//
// فرمول رسمی موجودی (خواسته‌ی صریح Phase 10):
//
//   مانده ابتدای دوره
//   + خرید            + طلای دریافتی      + برگشت از فروش      + ورود مستقیم
//   − فروش            − طلای پرداختی      − خروج مستقیم        ± ذوب
//   ± انتقال بین سطل‌ها                   ± اصلاح موجودی
//   ─────────────────────────────────────────────────────────────
//   = موجودی فعلی
//
// تضمین ساختاری: مجموع اجزای بالا **همیشه** دقیقاً برابر موجودی فعلی است، چون
// هر دو از یک منبع (`goldLedger`) می‌آیند و هیچ `reason` ای از قلم نمی‌افتد —
// هر مقدار ناشناخته‌ای در ردیف «سایر» دیده می‌شود، نه اینکه بی‌صدا گم شود.
// این تضمین با تست عددی صریح بررسی می‌شود (inventory.test.mjs §۱).
// ═══════════════════════════════════════════════════════════════════════════

import { getAll } from '../db/repo.js';
import {
  inventoryRefId,
  inventoryBalances,
  inventoryGramsOf,
  inventoryStatement,
  moneyBalanceOf,
  roundGrams,
} from './ledger.js';
import { ratePerGramForKarat } from './pricing.js';
import { getPricingConfig } from './priceRates.js';
import { GOLD_ACCOUNT_TYPES, GOLD_ACCOUNT_TYPE_LABELS, GRAM_EPS, IRR_EPS } from './accounts.js';
import { phaseOf as rangePhaseOf } from '../utils/dateRange.js';

export { inventoryRefId, GOLD_ACCOUNT_TYPES, GOLD_ACCOUNT_TYPE_LABELS, GRAM_EPS, IRR_EPS };

/**
 * اجزای فرمول موجودی، به ترتیب نمایش.
 * `reasons` همان مقادیر فیلد `reason` در `goldLedger` است که هر جزء را تغذیه می‌کند.
 * `sign` فقط برای نمایش است (انتظار جهت غالب)؛ محاسبه همیشه `ورود − خروج` واقعی است،
 * پس اگر یک سند لغو شود، اثر معکوسش هم در همان ردیف دیده می‌شود.
 */
export const INVENTORY_FLOW_STEPS = [
  { key: 'opening', label: 'مانده ابتدای دوره', sign: +1, reasons: ['opening'] },
  { key: 'purchase', label: 'خرید', sign: +1, reasons: ['purchase'] },
  { key: 'goldReceived', label: 'طلای دریافتی', sign: +1, reasons: ['receipt_gold'] },
  { key: 'saleReturn', label: 'برگشت از فروش', sign: +1, reasons: ['sale_return'] },
  { key: 'goldIn', label: 'ورود مستقیم طلا', sign: +1, reasons: ['gold_in'] },
  { key: 'sale', label: 'فروش', sign: -1, reasons: ['sale'] },
  { key: 'goldPaid', label: 'طلای پرداختی', sign: -1, reasons: ['payment_gold'] },
  { key: 'goldOut', label: 'خروج مستقیم طلا', sign: -1, reasons: ['gold_out'] },
  { key: 'melt', label: 'ذوب / تبدیل', sign: -1, reasons: ['melt'] },
  { key: 'transfer', label: 'انتقال بین سطل‌ها', sign: 0, reasons: ['transfer'] },
  { key: 'adjustment', label: 'اصلاح موجودی', sign: 0, reasons: ['adjustment'] },
];

/** نگاشت reason → کلید جزء فرمول. هر reason ناشناخته به «سایر» می‌رود (هیچ‌وقت گم نمی‌شود). */
const REASON_TO_STEP = new Map();
for (const step of INVENTORY_FLOW_STEPS) {
  for (const reason of step.reasons) REASON_TO_STEP.set(reason, step.key);
}

export const OTHER_STEP = { key: 'other', label: 'سایر (بدون دسته)', sign: 0, reasons: [] };

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeZero(n) {
  return n === 0 ? 0 : n;
}

export { roundGrams };

/** رکوردهای دفتر طلا که به انبار مربوط‌اند (نه به طرف حساب). */
function isInventoryEntry(entry) {
  return entry?.accountRef?.kind === 'inventory';
}

function inDateRange(entry, from, to) {
  if (!from && !to) return true;
  const date = String(entry.date || '');
  if (from && date < String(from)) return false;
  if (to && date > String(to)) return false;
  return true;
}

// ───────────────────────────── نام‌گذاری سطل ─────────────────────────────

/** برچسب فارسی یک سطل انبار — تنها تولیدکننده‌ی این رشته در کل برنامه. */
export function bucketLabel(bucket, product = null) {
  if (product) return `${product.name} (${product.code})`;
  const typeLabel = GOLD_ACCOUNT_TYPE_LABELS[bucket.goldType] || bucket.goldType || '—';
  return `${typeLabel} — عیار ${num(bucket.karat)}`;
}

// ──────────────────────────── موجودی سطل‌ها ────────────────────────────

/**
 * موجودی کامل انبار: هر سطل با وزن، ورود، خروج، ارزش روز و ارزش دفتری.
 *
 * ارزش‌گذاری (تصمیم Phase 10 — هر دو دیدگاه کنار هم):
 *   • ارزش روز    = وزن × نرخ جاری همان عیار (INVENTORY_RULES §۶)
 *   • ارزش دفتری  = مانده‌ی ریالی همان سطل در `moneyLedger` (بهای ثبت‌شده)
 *   • تفاوت       = سود/زیان تحقق‌نیافته
 */
export async function listBuckets({ goldType = 'all', includeEmpty = false, search = '' } = {}) {
  const [buckets, products, entries, config] = await Promise.all([
    inventoryBalances(),
    getAll('products'),
    getAll('goldLedger'),
    getPricingConfig(),
  ]);

  const productById = new Map(products.map((p) => [p.id, p]));

  // ورود/خروج هر سطل با یک بار پیمایش دفتر (به‌جای یک کوئری برای هر سطل).
  const flowByRef = new Map();
  for (const entry of entries) {
    if (!isInventoryEntry(entry)) continue;
    const refId = entry.accountRef.id;
    const acc = flowByRef.get(refId) || { inGrams: 0, outGrams: 0 };
    if (entry.direction === 'IN') acc.inGrams += num(entry.weightGrams);
    else acc.outGrams += num(entry.weightGrams);
    flowByRef.set(refId, acc);
  }

  const term = String(search || '').trim().toLowerCase();
  const rows = [];

  for (const bucket of buckets.values()) {
    if (!includeEmpty && Math.abs(bucket.grams) < GRAM_EPS) continue;
    if (goldType !== 'all' && bucket.goldType !== goldType) continue;

    const product = bucket.productId ? productById.get(bucket.productId) || null : null;
    const label = bucketLabel(bucket, product);
    if (term && !label.toLowerCase().includes(term)) continue;

    const karat = product ? num(product.karat) : num(bucket.karat);
    const ratePerGram = ratePerGramForKarat(karat, config);
    const flow = flowByRef.get(bucket.refId) || { inGrams: 0, outGrams: 0 };
    const bookValueIRR = (await moneyBalanceOf('inventory', bucket.refId)).balance;
    const marketValueIRR = Math.round(bucket.grams * ratePerGram);

    rows.push({
      refId: bucket.refId,
      goldType: bucket.goldType,
      karat,
      productId: bucket.productId,
      productName: product ? product.name : null,
      productCode: product ? product.code : null,
      label,
      grams: roundGrams(bucket.grams),
      inGrams: roundGrams(flow.inGrams),
      outGrams: roundGrams(flow.outGrams),
      ratePerGram,
      marketValueIRR,
      bookValueIRR,
      unrealizedIRR: marketValueIRR - bookValueIRR,
    });
  }

  return rows.sort(compareBuckets);
}

function compareBuckets(a, b) {
  const byType = GOLD_ACCOUNT_TYPES.indexOf(a.goldType) - GOLD_ACCOUNT_TYPES.indexOf(b.goldType);
  if (byType !== 0) return byType;
  if (a.karat !== b.karat) return a.karat - b.karat;
  return String(a.label).localeCompare(String(b.label), 'fa');
}

/**
 * جمع موجودی به تفکیک **نوع طلا** — ساخته‌شده / آبشده / متفرقه.
 * این سه عدد عمداً با هم جمع زده نمی‌شوند مگر برای نمایش «کل» (INVENTORY_RULES §۲):
 * یک گرم طلای ۲۱ عیار با یک گرم ۱۸ عیار هم‌ارزش نیست.
 */
export function totalsByType(rows) {
  const totals = GOLD_ACCOUNT_TYPES.map((goldType) => ({
    goldType,
    label: GOLD_ACCOUNT_TYPE_LABELS[goldType],
    grams: 0,
    marketValueIRR: 0,
    bookValueIRR: 0,
    buckets: 0,
  }));
  const byKey = new Map(totals.map((t) => [t.goldType, t]));

  for (const row of rows) {
    const bucket = byKey.get(row.goldType);
    if (!bucket) continue;
    bucket.grams = roundGrams(bucket.grams + row.grams);
    bucket.marketValueIRR += row.marketValueIRR;
    bucket.bookValueIRR += row.bookValueIRR;
    bucket.buckets += 1;
  }

  return totals;
}

/** جمع موجودی به تفکیک **عیار** (در همه‌ی انواع). */
export function totalsByKarat(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = num(row.karat);
    const bucket = map.get(key) || { karat: key, grams: 0, marketValueIRR: 0, bookValueIRR: 0, buckets: 0 };
    bucket.grams = roundGrams(bucket.grams + row.grams);
    bucket.marketValueIRR += row.marketValueIRR;
    bucket.bookValueIRR += row.bookValueIRR;
    bucket.buckets += 1;
    map.set(key, bucket);
  }
  return Array.from(map.values()).sort((a, b) => a.karat - b.karat);
}

/** جمع کل انبار (وزن خام همه‌ی عیارها + ارزش‌ها). */
export function grandTotal(rows) {
  return rows.reduce(
    (acc, row) => ({
      grams: roundGrams(acc.grams + row.grams),
      inGrams: roundGrams(acc.inGrams + row.inGrams),
      outGrams: roundGrams(acc.outGrams + row.outGrams),
      marketValueIRR: acc.marketValueIRR + row.marketValueIRR,
      bookValueIRR: acc.bookValueIRR + row.bookValueIRR,
      unrealizedIRR: acc.unrealizedIRR + row.unrealizedIRR,
      buckets: acc.buckets + 1,
    }),
    { grams: 0, inGrams: 0, outGrams: 0, marketValueIRR: 0, bookValueIRR: 0, unrealizedIRR: 0, buckets: 0 }
  );
}

// ───────────────────────── شکستن گردش به فرمول ─────────────────────────

/**
 * گردش انبار شکسته‌شده به اجزای فرمول.
 *
 * @param {object} options
 * @param {string|null} options.refId فقط یک سطل (پیش‌فرض: کل انبار)
 * @param {string} options.goldType فیلتر نوع طلا
 * @param {number|null} options.karat فیلتر عیار
 * @param {string|null} options.from تاریخ شروع (ISO) — رکوردهای قبل از آن در `openingCarried` جمع می‌شوند
 * @param {string|null} options.to تاریخ پایان (ISO)
 * @param {{from:string|null,to:string|null}|null} options.range (Phase 14) بازه‌ی نرمال‌شده با کلید
 *   روز تقویمی محلی (utils/dateRange.js). وقتی داده شود، به‌جای from/to استفاده می‌شود؛
 *   گزارش‌ها همیشه از این مسیر می‌آیند تا رکورد ساعت ۱ بامداد در روز درست بنشیند.
 * @returns {Promise<{steps:Array, openingCarried:number, closing:number, balanced:boolean}>}
 */
export async function inventoryFlow({ refId = null, goldType = 'all', karat = null, from = null, to = null, range = null } = {}) {
  const entries = await getAll('goldLedger');

  const stepTotals = new Map(
    [...INVENTORY_FLOW_STEPS, OTHER_STEP].map((s) => [s.key, { ...s, inGrams: 0, outGrams: 0, netGrams: 0, count: 0 }])
  );

  let openingCarried = 0; // اثر رکوردهای *پیش از* بازه، که مانده‌ی ابتدای بازه را می‌سازد
  let allTimeNet = 0;

  for (const entry of entries) {
    if (!isInventoryEntry(entry)) continue;
    if (refId && entry.accountRef.id !== refId) continue;
    if (goldType !== 'all' && entry.goldType !== goldType) continue;
    if (karat !== null && num(entry.karat) !== num(karat)) continue;

    const weight = num(entry.weightGrams);
    const delta = entry.direction === 'IN' ? weight : -weight;
    allTimeNet += delta;

    if (range) {
      const phase = rangePhaseOf(entry.date, range);
      if (phase === 'before') openingCarried += delta;
      if (phase !== 'in') continue;
    } else if (!inDateRange(entry, from, to)) {
      // فقط رکوردهای *قبل* از بازه مانده‌ی ابتدای بازه را می‌سازند؛ رکوردهای بعد از
      // بازه اصلاً به این گزارش ربطی ندارند.
      if (from && String(entry.date || '') < String(from)) openingCarried += delta;
      continue;
    }

    const stepKey = REASON_TO_STEP.get(entry.reason) || OTHER_STEP.key;
    const bucket = stepTotals.get(stepKey);
    if (entry.direction === 'IN') bucket.inGrams += weight;
    else bucket.outGrams += weight;
    bucket.netGrams = roundGrams(bucket.inGrams - bucket.outGrams);
    bucket.count += 1;
  }

  const steps = Array.from(stepTotals.values())
    .map((s) => ({ ...s, inGrams: roundGrams(s.inGrams), outGrams: roundGrams(s.outGrams) }))
    .filter((s) => s.key !== OTHER_STEP.key || s.count > 0);

  const movement = roundGrams(steps.reduce((sum, s) => sum + s.netGrams, 0));
  const closing = roundGrams(openingCarried + movement);

  return {
    steps,
    openingCarried: roundGrams(openingCarried),
    movement,
    closing,
    // تضمین §۱: وقتی بازه‌ای در کار نیست، جمع اجزا باید دقیقاً برابر موجودی کل باشد.
    balanced: Math.abs(closing - allTimeNet) < GRAM_EPS || Boolean(from || to || range?.from || range?.to),
  };
}

// ──────────────────────────── جزئیات یک سطل ────────────────────────────

/**
 * تمام داده‌های صفحه‌ی جزئیات یک سطل: موجودی، ارزش‌ها، اجزای فرمول و گردش کامل.
 * مانده‌ی پایانی گردش همیشه دقیقاً برابر موجودی است (هر دو از یک منبع می‌آیند).
 */
export async function bucketSummary(refId) {
  const [inv, statement, buckets, products, config, book, flow] = await Promise.all([
    inventoryGramsOf(refId),
    inventoryStatement(refId),
    inventoryBalances(),
    getAll('products'),
    getPricingConfig(),
    moneyBalanceOf('inventory', refId),
    inventoryFlow({ refId }),
  ]);

  const bucket = buckets.get(refId);
  if (!bucket) throw new Error('سطل موجودی مورد نظر یافت نشد.');

  const product = bucket.productId ? products.find((p) => p.id === bucket.productId) || null : null;
  const karat = product ? num(product.karat) : num(bucket.karat);
  const ratePerGram = ratePerGramForKarat(karat, config);
  const marketValueIRR = Math.round(inv.grams * ratePerGram);

  return {
    refId,
    goldType: bucket.goldType,
    karat,
    productId: bucket.productId,
    productName: product ? product.name : null,
    label: bucketLabel(bucket, product),
    grams: inv.grams,
    inGrams: inv.inGrams,
    outGrams: inv.outGrams,
    ratePerGram,
    marketValueIRR,
    bookValueIRR: book.balance,
    unrealizedIRR: marketValueIRR - book.balance,
    flow,
    statement: statement.rows,
    closing: statement.closing,
  };
}

// ─────────────────────────── کفایت موجودی ───────────────────────────

/**
 * بررسی کفایت موجودی یک سطل برای خروج وزن مشخص.
 * خروجی `null` یعنی مشکلی نیست؛ در غیر این صورت شیء کمبود برای نمایش در هشدار.
 * (سیاست موجودی منفی: INVENTORY_RULES §۵ — هشدار + تأیید، نه بلاک. استثنا: فروش.)
 */
export async function checkAvailable(refId, weightGrams, { extraOutflow = 0 } = {}) {
  const inv = await inventoryGramsOf(refId);
  const requested = num(weightGrams) + num(extraOutflow);
  const after = inv.grams - requested;
  if (after >= -GRAM_EPS) return null;

  const buckets = await inventoryBalances();
  const bucket = buckets.get(refId) || {};
  return {
    refId,
    goldType: bucket.goldType || null,
    karat: bucket.karat ?? null,
    productId: bucket.productId || null,
    available: inv.grams,
    requested,
    shortfall: roundGrams(-after),
  };
}

/**
 * ارزش دفتریِ سهم یک وزن از یک سطل — به نسبت وزن (همان قاعده‌ی انتقال، Phase 9).
 * بدون این کار، سطلی که همه‌ی طلایش خارج شده تا ابد یک مانده‌ی ریالی بی‌صاحب نگه می‌دارد.
 */
export async function proportionalBookValue(refId, weightGrams) {
  const [inv, book] = await Promise.all([inventoryGramsOf(refId), moneyBalanceOf('inventory', refId)]);
  const available = inv.grams;
  const weight = num(weightGrams);
  if (Math.abs(available) < GRAM_EPS || Math.abs(book.balance) < IRR_EPS) return 0;
  const ratio = Math.abs(weight - available) < GRAM_EPS ? 1 : weight / available;
  return Math.round(book.balance * ratio);
}

// ─────────── کفایت موجودی در مسیر ابطال (Phase 17) ───────────
//
// ═══════════════════════════════════════════════════════════════════════════
// ایرادی که ممیزی Phase 17 پیدا کرد:
//
// مسیرهای «ایجاد» (فروش، پرداخت با طلا، اصلاح انبار، ذوب، انتقال) همگی پیش از
// ثبت، کفایت موجودی را می‌سنجند. اما مسیرهای «ابطال» هیچ بررسی‌ای نداشتند — در
// حالی که ابطال یک سندی که طلا را **وارد** کرده بود، در عمل یک خروج واقعی از
// انبار است. پنج مسیر آسیب‌پذیر بودند:
//   voidPurchase · voidInventoryDoc · voidSaleReturn · voidSettlement · voidTransfer
//
// سناریوی واقعی: ۲۰ گرم خریده‌اید، همان ۲۰ گرم را فروخته‌اید، بعد متوجه می‌شوید
// سند خرید اشتباه بوده و ابطالش می‌کنید ⇒ موجودی انبار **بی‌هیچ هشداری** منفی
// می‌شد. این دقیقاً همان چیزی است که INVENTORY_RULES §۵ («هشدار + تأیید صریح»)
// از Phase 6 وعده داده بود و در مسیر ابطال اجرا نشده بود.
//
// راه‌حل: یک بررسی مشترک روی **طرح نوشتن** (postings plan) — پیش از باز شدن
// تراکنش، مثل تمام بررسی‌های دیگر پروژه. چون همه‌ی ابطال‌ها از طریق
// `addReversal()` طرح می‌سازند، یک تابع همه‌ی پنج مسیر را پوشش می‌دهد.
// ═══════════════════════════════════════════════════════════════════════════

/** خطای کمبود موجودی در مسیر ابطال — «هشدار + تأیید»، نه بلاک (بر خلاف فروش). */
export class VoidShortageError extends Error {
  constructor(shortages, operation = 'ابطال این سند') {
    super(`${operation} موجودی طلا را منفی می‌کند.`);
    this.name = 'VoidShortageError';
    this.shortages = shortages;
    this.operation = operation;
  }
}

/**
 * کمبودهای موجودی که نوشتن یک طرح ایجاد می‌کند — پیش از نوشتن.
 * فقط سطل‌هایی بررسی می‌شوند که **خالص** خروجی دارند؛ طرحی که هم‌زمان ورود و
 * خروج دارد (مثل ذوب) با خالص همان سطل سنجیده می‌شود، نه با هر رکورد جدا.
 */
export async function planInventoryShortages(plan) {
  const net = new Map();
  for (const e of plan?.goldEntries || []) {
    if (e?.accountRef?.kind !== 'inventory') continue;
    const id = e.accountRef.id;
    const delta = e.direction === 'OUT' ? num(e.weightGrams) : -num(e.weightGrams);
    net.set(id, roundGrams((net.get(id) || 0) + delta));
  }

  const shortages = [];
  for (const [refId, outflow] of net) {
    if (outflow <= GRAM_EPS) continue;
    const shortage = await checkAvailable(refId, outflow);
    if (shortage) shortages.push(shortage);
  }
  return shortages;
}

/** بررسی + پرتاب خطا، برای استفاده در تمام مسیرهای ابطال. */
export async function assertPlanInventory(plan, { allowNegative = false, operation } = {}) {
  const shortages = await planInventoryShortages(plan);
  if (shortages.length && !allowNegative) throw new VoidShortageError(shortages, operation);
  return shortages;
}
