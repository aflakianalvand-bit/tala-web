// allocations.js — موتور تخصیص سند تسویه به فاکتور (Phase 11)
//
// ═══════════════════════════════════════════════════════════════════════════
// مسئله‌ای که این فایل حل می‌کند:
//
//   «مانده فاکتور = مبلغ فاکتور − پرداخت‌های تخصیص‌یافته. هیچ مانده‌ای دستی نباشد.»
//
// تا Phase 10، هر سند خرید/فروش یک فیلد `remainingIRR` داشت که **در لحظه‌ی ثبت**
// محاسبه می‌شد. آن عدد یک Snapshot تاریخی درست است (چقدر از این فاکتور همان روز
// نقد شد)، ولی نمی‌تواند «مانده‌ی امروز» باشد: تسویه‌های بعدی آن را نمی‌بینند.
// اگر با هر تسویه همان فیلد را کم می‌کردیم، دقیقاً همان «مانده‌ی دستی» ساخته
// می‌شد که دستور پروژه §۲۰ ممنوع کرده است.
//
// بنابراین در Phase 11 یک لایه‌ی سوم اضافه شد: **تخصیص (Allocation)**.
//
//   Outstanding(فاکتور) = grandTotal − برگشت‌ها − Σ تخصیص‌های فعال
//
// این تنها فرمول مانده‌ی فاکتور در کل برنامه است.
//
// ─── چرا تخصیص هیچ رکورد دفتری نمی‌سازد (مهم‌ترین نکته‌ی این فایل) ───
// وقتی مشتری ۱۰ میلیون می‌پردازد، اثر مالی همان لحظه کامل ثبت می‌شود: صندوق
// بدهکار، مشتری بستانکار. مانده‌ی مشتری از همان رکوردها می‌آید. «این ۱۰ میلیون
// بابت فاکتور SA-1405-0007 بود» یک **نسبت‌دادن** است، نه یک رویداد مالی جدید؛
// اگر برای آن هم رکورد دفتری می‌ساختیم، بدهی مشتری دو بار کم می‌شد.
// نتیجه‌ی عملی و آزموده‌شده: مجموع Outstanding فاکتورهای باز یک طرف حساب، منهای
// مبلغ علی‌الحساب او، دقیقاً برابر مانده‌ی دفتری اوست — دو مسیر مستقل، یک عدد.
// همین است که «ویرایش تخصیص بدون ابطال سند» (تصمیم Phase 11) را ممکن می‌کند:
// جابه‌جایی تخصیص هیچ ریالی را جابه‌جا نمی‌کند.
//
// ─── تصمیمات کسب‌وکاری Phase 11 که پرسیده شد و حدس زده نشد ───
//   ۱. تخصیص هنگام ثبت **فقط خودکار FIFO** است (قدیمی‌ترین فاکتور باز اول).
//   ۲. مبلغ مازاد یا بدون فاکتورِ باز، «علی‌الحساب» می‌ماند (مانده بستانکار).
//   ۳. «تخفیف تسویه» یک خط مستقل در سند تسویه است (services/settlements.js).
//   ۴. تخصیص **مستقل از سند** قابل ویرایش است (تابع reallocate در همین فایل).
// ═══════════════════════════════════════════════════════════════════════════

import { get, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { IRR_EPS } from './accounts.js';
// (Phase 19) واحد رسمی مانده‌ی فاکتور: گرم ۷۵۰.
import { roundBaseGrams, isZeroGrams, GRAM_EPS } from './goldTotals.js';

/** نگاشت نوع طرف حساب → سند تجاری، سند تسویه و نوع آن‌ها. */
export const PARTY_MAP = {
  customer: { docStore: 'sales', docIndex: 'customerId', targetType: 'sale', payStore: 'receipts', payType: 'receipt' },
  supplier: { docStore: 'purchases', docIndex: 'supplierId', targetType: 'purchase', payStore: 'payments', payType: 'payment' },
};

export const ALLOCATION_STATUSES = ['active', 'voided'];

// ─────────────────── جهت سند تسویه (Phase 22) ───────────────────
//
// تا Phase 21 جهت تسویه از نوع طرف حساب می‌آمد: مشتری فقط «دریافت»، تأمین‌کننده
// فقط «پرداخت». پس «تأمین‌کننده به ما طلا داد» فقط با سند «پرداخت» ثبت می‌شد و
// موجودی را **کم** می‌کرد (بازتولید در test/goldReceipt.test.mjs). از Phase 22 جهت
// مستقل است: 'in' (طلا/وجه به ما رسید ⇒ Store دریافت‌ها) و 'out' (از ما رفت ⇒
// Store پرداخت‌ها)، برای هر دو نوع طرف حساب.
//
// «جهت عادی» همان جهت قبلی است و فقط آن فاکتور می‌بندد (FIFO). جهت معکوس
// (پس دادن پیش‌پرداخت، طلای امانی تأمین‌کننده، …) هیچ فاکتوری نمی‌بندد و در
// «علی‌الحساب» با علامت منفی شمرده می‌شود تا همخوانی دو مسیر (§8) برقرار بماند.

/** جهت عادی تسویه‌ی هر نوع طرف حساب. */
export function normalDirectionOf(partyType) {
  return partyType === 'supplier' ? 'out' : 'in';
}

/** جهت یک سند تسویه: فیلد صریح سند جدید، وگرنه جهت عادی (اسناد پیش از Phase 22). */
export function settlementDirectionOf(doc) {
  if (doc?.direction === 'in' || doc?.direction === 'out') return doc.direction;
  return normalDirectionOf(doc?.partyType);
}

export function isReverseSettlement(doc) {
  return settlementDirectionOf(doc) !== normalDirectionOf(doc?.partyType);
}

/** Store سند تسویه بر اساس جهت: ورود ⇒ دریافت‌ها، خروج ⇒ پرداخت‌ها. */
export function settlementStoreOf(direction) {
  return direction === 'out' ? 'payments' : 'receipts';
}

/** همه‌ی اسناد دریافت/پرداخت یک طرف حساب از **هر دو** Store (با جهت‌شان). */
export async function partySettlementDocs(partyType, partyId) {
  const [ins, outs] = await Promise.all([
    getByIndex('receipts', 'party', [partyType, partyId]),
    getByIndex('payments', 'party', [partyType, partyId]),
  ]);
  return [
    ...ins.map((doc) => ({ doc, store: 'receipts' })),
    ...outs.map((doc) => ({ doc, store: 'payments' })),
  ];
}

export class AllocationError extends Error {
  constructor(message, fieldErrors = {}) {
    super(message);
    this.name = 'AllocationError';
    this.fieldErrors = fieldErrors;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * مبلغ ریالی انباشته را از خطای ممیز شناور پاک می‌کند.
 * همان دلیل roundGrams در ledger.js: مانده‌ی فاکتور جمعِ چند تخصیص است و
 * `10000000 - 3333333.33 - 6666666.67` می‌تواند `-1.8e-9` بدهد؛ آن‌وقت فاکتوری
 * که کامل تسویه شده تا ابد در فهرست «فاکتورهای باز» می‌ماند.
 */
export function roundIRR(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 10000) / 10000;
  return r === 0 ? 0 : r;
}

/** آیا این مبلغ عملاً صفر است (کمتر از نیم ریال). */
function isZero(v) {
  return Math.abs(num(v)) < IRR_EPS;
}

/** وزن معادل انباشته را از خطای ممیز شناور پاک می‌کند (همتای roundIRR). */
export function roundGrams(value) {
  return roundBaseGrams(value);
}

// ────────────────────────────── خواندن تخصیص‌ها ──────────────────────────────

/** تخصیص‌های فعال یک سند تسویه. */
export async function allocationsForDoc(docId, { includeVoided = false } = {}) {
  const rows = await getByIndex('allocations', 'docId', docId);
  return includeVoided ? rows : rows.filter((a) => a.status === 'active');
}

/** تخصیص‌های فعال یک فاکتور. */
export async function allocationsForTarget(targetId, { includeVoided = false } = {}) {
  const rows = await getByIndex('allocations', 'targetId', targetId);
  return includeVoided ? rows : rows.filter((a) => a.status === 'active');
}

/** تمام تخصیص‌های یک طرف حساب (یک بار خواندن برای کل صفحه). */
export async function allocationsForParty(partyType, partyId, { includeVoided = false } = {}) {
  const rows = await getByIndex('allocations', 'party', [partyType, partyId]);
  return includeVoided ? rows : rows.filter((a) => a.status === 'active');
}

// ─────────────────────── اشتقاق مانده‌ی فاکتور (فرمول اصلی) ───────────────────────

/**
 * مبلغ خالص قابل تسویه‌ی یک فاکتور: مبلغ کل منهای برگشت‌ها.
 * برگشت از فروش (Phase 7) بدهی مشتری را کم می‌کند، پس باید از پایه‌ی مانده هم کم شود؛
 * وگرنه فاکتوری که نصفش برگشت خورده هرگز به مانده‌ی صفر نمی‌رسید.
 */
export function invoiceGrossIRR(invoice) {
  return roundIRR(num(invoice.grandTotalIRR) - num(invoice.returnedAmountIRR));
}

/**
 * (Phase 19) همان فرمول، به واحد رسمی: گرم ۷۵۰.
 * از این فاز **این** مبناست و نسخه‌ی ریالی فقط برای نمایش/گزارش‌های ریالی می‌ماند —
 * چون یک سند رسیدیِ بدون فی اصلاً مبلغ ریالی ندارد و مانده‌اش با ریال قابل بیان نیست.
 */
export function invoiceGrossGrams(invoice) {
  return roundGrams(num(invoice.grandTotalGrams) - num(invoice.returnedGrams));
}

/**
 * مانده‌ی یک فاکتور — **تنها فرمول معتبر** در کل برنامه.
 * @param {object} invoice رکورد sale یا purchase
 * @param {Array} allocations تخصیص‌های فعالِ همین فاکتور
 */
export function invoiceOutstanding(invoice, allocations = []) {
  if (!invoice || invoice.status === 'voided') return 0;
  const allocated = allocations.reduce((s, a) => s + num(a.amountIRR), 0);
  const out = roundIRR(invoiceGrossIRR(invoice) - allocated);
  return isZero(out) ? 0 : out;
}

/** مانده‌ی فاکتور به گرم ۷۵۰ — **تنها فرمول معتبر** از Phase 19 به بعد. */
export function invoiceOutstandingGrams(invoice, allocations = []) {
  if (!invoice || invoice.status === 'voided') return 0;
  const allocated = allocations.reduce((s, a) => s + num(a.amountGrams), 0);
  const out = roundGrams(invoiceGrossGrams(invoice) - allocated);
  return isZeroGrams(out) ? 0 : out;
}

/** وضعیت مشتق‌شده‌ی فاکتور از روی مانده‌ی گرمی‌اش. */
export function invoiceStatusOf(invoice, outstandingGrams) {
  if (!invoice) return null;
  if (invoice.status === 'voided') return 'voided';
  return isZeroGrams(outstandingGrams) ? 'settled' : 'open';
}

/**
 * تمام فاکتورهای یک طرف حساب، غنی‌شده با مانده‌ی مشتق‌شده — با دو بار خواندن،
 * نه N بار. خروجی به ترتیب FIFO (قدیمی‌ترین اول) مرتب می‌شود، چون تخصیص خودکار
 * دقیقاً همین ترتیب را دنبال می‌کند.
 */
export async function partyInvoices(partyType, partyId, { onlyOpen = false } = {}) {
  const map = PARTY_MAP[partyType];
  if (!map) throw new AllocationError(`نوع طرف حساب نامعتبر است: ${partyType}`);

  const [docs, allocations] = await Promise.all([
    getByIndex(map.docStore, map.docIndex, partyId),
    allocationsForParty(partyType, partyId),
  ]);

  const byTarget = new Map();
  for (const a of allocations) {
    const list = byTarget.get(a.targetId) || [];
    list.push(a);
    byTarget.set(a.targetId, list);
  }

  const rows = docs
    .filter((d) => d.status !== 'voided' && !d.deletedAt)
    .map((invoice) => {
      const allocs = byTarget.get(invoice.id) || [];
      const allocatedIRR = roundIRR(allocs.reduce((s, a) => s + num(a.amountIRR), 0));
      const allocatedGrams = roundGrams(allocs.reduce((s, a) => s + num(a.amountGrams), 0));
      const outstandingIRR = invoiceOutstanding(invoice, allocs);
      const outstandingGrams = invoiceOutstandingGrams(invoice, allocs);
      return {
        invoice,
        targetType: map.targetType,
        targetId: invoice.id,
        number: invoice.number,
        date: invoice.date,
        dueDate: invoice.dueDate || null,
        dueDateId: invoice.dueDateId || null,
        totalIRR: num(invoice.grandTotalIRR),
        returnedIRR: num(invoice.returnedAmountIRR),
        grossIRR: invoiceGrossIRR(invoice),
        allocatedIRR,
        outstandingIRR,
        // ── واحد رسمی (Phase 19) ──
        totalGrams: num(invoice.grandTotalGrams),
        returnedGrams: num(invoice.returnedGrams),
        grossGrams: invoiceGrossGrams(invoice),
        allocatedGrams,
        outstandingGrams,
        derivedStatus: invoiceStatusOf(invoice, outstandingGrams),
        allocations: allocs,
      };
    })
    .sort(fifoOrder);

  return onlyOpen ? rows.filter((r) => r.outstandingGrams > GRAM_EPS) : rows;
}

/**
 * ترتیب FIFO: قدیمی‌ترین فاکتور اول.
 * معیار اصلی **تاریخ سند** است نه تاریخ سررسید — چون تصمیم Phase 11 «قدیمی‌ترین
 * بدهی اول» بود، و یک فاکتور نقدیِ قدیمی هم اصلاً سررسید ندارد. برای دو فاکتور
 * هم‌تاریخ، شماره‌ی سند (که ترتیبی و سالانه است) تصمیم قطعی می‌گیرد تا نتیجه‌ی
 * تخصیص هیچ‌وقت به ترتیب تصادفیِ خواندن از IndexedDB وابسته نباشد.
 */
function fifoOrder(a, b) {
  const byDate = String(a.date || '').localeCompare(String(b.date || ''));
  if (byDate !== 0) return byDate;
  return String(a.number || '').localeCompare(String(b.number || ''));
}

/**
 * مبلغ علی‌الحساب یک طرف حساب: بخشی از اسناد تسویه که به هیچ فاکتوری تخصیص نیافته.
 * (مثبت یعنی پول نزد ماست و هنوز بابت فاکتوری حساب نشده.)
 */
export async function unallocatedOf(partyType, partyId) {
  const map = PARTY_MAP[partyType];
  if (!map) throw new AllocationError(`نوع طرف حساب نامعتبر است: ${partyType}`);

  const [entries, allocations] = await Promise.all([
    partySettlementDocs(partyType, partyId),
    allocationsForParty(partyType, partyId),
  ]);

  const allocatedByDoc = new Map();
  const allocatedGramsByDoc = new Map();
  for (const a of allocations) {
    allocatedByDoc.set(a.docId, roundIRR(num(allocatedByDoc.get(a.docId)) + num(a.amountIRR)));
    allocatedGramsByDoc.set(a.docId, roundGrams(num(allocatedGramsByDoc.get(a.docId)) + num(a.amountGrams)));
  }

  let total = 0;
  let totalGrams = 0;
  let reverseIRR = 0;
  let reverseGrams = 0;
  const rows = [];
  for (const { doc } of entries) {
    if (doc.status === 'voided') continue;
    if (isReverseSettlement(doc)) {
      // Phase 22: سند معکوس (مثلاً پس دادن پیش‌پرداخت) علی‌الحساب را کم می‌کند.
      reverseIRR = roundIRR(reverseIRR + num(doc.valueIRR));
      reverseGrams = roundGrams(reverseGrams + num(doc.valueGrams));
      continue;
    }
    const value = num(doc.valueIRR);
    const allocated = num(allocatedByDoc.get(doc.id));
    const rest = roundIRR(value - allocated);
    const valueGrams = num(doc.valueGrams);
    const allocatedGrams = num(allocatedGramsByDoc.get(doc.id));
    const restGrams = roundGrams(valueGrams - allocatedGrams);
    if (restGrams > GRAM_EPS) {
      total = roundIRR(total + Math.max(0, rest));
      totalGrams = roundGrams(totalGrams + restGrams);
      rows.push({
        doc,
        valueIRR: value,
        allocatedIRR: allocated,
        unallocatedIRR: Math.max(0, rest),
        valueGrams,
        allocatedGrams,
        unallocatedGrams: restGrams,
      });
    }
  }
  total = roundIRR(total - reverseIRR);
  totalGrams = roundGrams(totalGrams - reverseGrams);
  return { totalIRR: total, totalGrams, docs: rows };
}

// ─────────────────────────── تخصیص خودکار (FIFO) ───────────────────────────

/**
 * تقسیم یک مبلغ روی فاکتورهای باز به روش FIFO — تابع خالص، بدون دیتابیس.
 * @param {Array} openRows خروجی partyInvoices (به ترتیب FIFO)
 * @param {number} amountIRR مبلغ قابل تخصیص
 * @returns {{splits: Array<{targetId, targetType, number, amountIRR}>, unallocatedIRR: number}}
 */
export function planFifo(openRows, amountGrams, { rate = 0 } = {}) {
  let rest = roundGrams(amountGrams);
  const splits = [];

  for (const row of openRows) {
    if (rest <= GRAM_EPS) break;
    const capacity = row.outstandingGrams;
    if (capacity <= GRAM_EPS) continue;
    const take = roundGrams(Math.min(capacity, rest));
    if (take <= GRAM_EPS) continue;
    splits.push({
      targetId: row.targetId,
      targetType: row.targetType,
      number: row.number,
      amountGrams: take,
      // معادل ریالی فقط برای نمایش/گزارش ریالی است، نه مبنای مانده.
      amountIRR: rate > 0 ? Math.round(take * rate) : 0,
      outstandingBefore: capacity,
      outstandingAfter: roundGrams(capacity - take),
    });
    rest = roundGrams(rest - take);
  }

  return { splits, unallocatedGrams: rest <= GRAM_EPS ? 0 : rest };
}

/** رکوردهای allocation از روی splits. */
export function buildAllocationRecords({
  docType,
  docId,
  docNumber,
  partyType,
  partyId,
  date,
  splits,
  auto = true,
  now = null,
}) {
  const stamp = now || nowIso();
  return splits.map((s) => ({
    id: generateId(),
    docType,
    docId,
    docNumberSnapshot: docNumber || '',
    partyType,
    partyId,
    targetType: s.targetType,
    targetId: s.targetId,
    targetNumberSnapshot: s.number || '',
    amountIRR: roundIRR(s.amountIRR),
    /** (Phase 19) واحد رسمی تخصیص: گرم ۷۵۰. */
    amountGrams: roundGrams(s.amountGrams),
    auto: !!auto,
    date,
    status: 'active',
    createdAt: stamp,
    updatedAt: stamp,
    voidedAt: null,
  }));
}

// ───────────── همگام‌سازی «نمای» وضعیت فاکتور و سررسید (Cache، نه منبع حقیقت) ─────────────
//
// `sales.status` / `purchases.status` و `dueDates.status` هر دو **Index** دارند و
// فهرست‌ها و هشدارهای Phase 12 روی آن‌ها کوئری می‌زنند. اگر آن‌ها را به‌روز نمی‌کردیم،
// فاکتوری که کامل تسویه شده تا ابد «باز» نشان داده می‌شد.
//
// اما این فیلدها **منبع حقیقت نیستند**: منبع حقیقت همیشه invoiceOutstanding() است.
// این‌ها فقط یک نمای ذخیره‌شده‌اند تا کوئری روی Index ممکن بماند، و در **همان**
// تراکنشی نوشته می‌شوند که تخصیص نوشته می‌شود (هرگز جدا). تست Phase 11 صریحاً برای
// هر فاکتور بررسی می‌کند که این نما دقیقاً برابر مقدار بازمحاسبه‌شده از دفتر است؛
// اگر روزی این دو واگرا شوند، تست می‌شکند به‌جای اینکه عددی بی‌صدا غلط شود.
// هیچ **مبلغی** اینجا ذخیره نمی‌شود — فقط وضعیت.

/**
 * وضعیت مشتق‌شده‌ی یک سررسید از روی مانده‌ی فاکتورش.
 * `overdue` عمداً اینجا نوشته نمی‌شود: آن یک وضعیت **وابسته به تاریخ امروز** است و
 * ذخیره‌کردنش یعنی رکوردی که با گذشت زمان بی‌سروصدا غلط می‌شود. Phase 12 آن را در
 * لحظه‌ی نمایش محاسبه می‌کند.
 */
export function dueDateStatusOf(dueDate, outstandingGrams) {
  if (!dueDate || dueDate.status === 'voided') return 'voided';
  if (isZeroGrams(outstandingGrams)) return 'paid';
  if (roundGrams(outstandingGrams) < roundGrams(num(dueDate.amountGrams)) - GRAM_EPS) return 'partial';
  return 'pending';
}

/**
 * محاسبه‌ی همه‌ی رکوردهایی که پس از یک تغییر تخصیص باید نوشته شوند.
 * تمام **خواندن‌ها** اینجا انجام می‌شود (پیش از باز شدن هر تراکنش)، طبق الگوی
 * prepare/commit کل کدبیس.
 *
 * @param {object} args
 * @param {string} args.partyType
 * @param {string} args.partyId
 * @param {Array}  args.added        رکوردهای allocation جدید (هنوز نوشته‌نشده)
 * @param {Array}  args.voidedIds    شناسه‌ی تخصیص‌هایی که باطل می‌شوند
 * @param {Array}  args.settledByDocIds شناسه‌ی اسناد تسویه‌ای که باید به settledByIds سررسید اضافه شوند
 */
export async function prepareTargetSync({ partyType, partyId, added = [], voidedIds = [], now = null }) {
  const stamp = now || nowIso();
  const rows = await partyInvoices(partyType, partyId);
  const voided = new Set(voidedIds);

  const addedByTarget = new Map();
  for (const a of added) {
    const list = addedByTarget.get(a.targetId) || [];
    list.push(a);
    addedByTarget.set(a.targetId, list);
  }

  const touched = new Set([...addedByTarget.keys()]);
  for (const row of rows) {
    if (row.allocations.some((a) => voided.has(a.id))) touched.add(row.targetId);
  }

  const invoiceUpdates = [];
  const dueDateUpdates = [];

  for (const row of rows) {
    if (!touched.has(row.targetId)) continue;

    const effective = row.allocations
      .filter((a) => !voided.has(a.id))
      .concat(addedByTarget.get(row.targetId) || []);
    const outstanding = invoiceOutstandingGrams(row.invoice, effective);
    const nextStatus = invoiceStatusOf(row.invoice, outstanding);

    if (row.invoice.status !== nextStatus) {
      invoiceUpdates.push({
        store: PARTY_MAP[partyType].docStore,
        record: { ...row.invoice, status: nextStatus, updatedAt: stamp },
      });
    }

    if (row.dueDateId) {
      const dueDate = await get('dueDates', row.dueDateId);
      if (dueDate && dueDate.status !== 'voided') {
        const settledByIds = Array.from(
          new Set([...(dueDate.settledByIds || []), ...effective.map((a) => a.docId)])
        );
        const nextDueStatus = dueDateStatusOf(dueDate, outstanding);
        const changed =
          nextDueStatus !== dueDate.status ||
          settledByIds.length !== (dueDate.settledByIds || []).length;
        if (changed) {
          dueDateUpdates.push({ ...dueDate, status: nextDueStatus, settledByIds, updatedAt: stamp });
        }
      }
    }
  }

  return { invoiceUpdates, dueDateUpdates, rows };
}

/** نوشتن خروجی prepareTargetSync داخل تراکنشی که سرویس تجاری باز کرده است. */
export function writeTargetSync(tx, { invoiceUpdates = [], dueDateUpdates = [] }) {
  for (const u of invoiceUpdates) tx.objectStore(u.store).put(u.record);
  const dues = dueDateUpdates.length ? tx.objectStore('dueDates') : null;
  for (const d of dueDateUpdates) dues.put(d);
}

/** Storeهایی که هر عملیات تخصیص به آن‌ها می‌نویسد. */
export const ALLOCATION_WRITE_STORES = ['allocations', 'sales', 'purchases', 'dueDates', 'auditLog'];

// ───────────────────────── ویرایش تخصیص (تصمیم ۴ Phase 11) ─────────────────────────

/**
 * تخصیص یک سند تسویه را بازنویسی می‌کند — **بدون هیچ اثر دفتری و بدون ابطال سند**.
 *
 * چرا این کار امن است: تخصیص فقط یک نسبت‌دادن است (توضیح ابتدای فایل). جابه‌جایی آن
 * بین دو فاکتورِ همان طرف حساب، نه مانده‌ی او را عوض می‌کند نه موجودی صندوق را —
 * فقط می‌گوید آن پول بابت کدام فاکتور بود. به همین دلیل «اصلاح تخصیص» نیازی به
 * Reversal ندارد، ولی **حتماً** در auditLog ثبت می‌شود.
 *
 * تخصیص‌های قبلی حذف نمی‌شوند؛ `status='voided'` می‌گیرند (همان قاعده‌ی ابطال اسناد).
 *
 * @param {string} docId شناسه‌ی سند دریافت/پرداخت
 * @param {Array<{targetId: string, amountIRR: number}>} entries تخصیص جدید (خالی = همه علی‌الحساب)
 */
export async function reallocate(docId, entries = [], { note = '' } = {}) {
  const doc = (await get('receipts', docId)) || (await get('payments', docId));
  if (!doc) throw new AllocationError('سند تسویه یافت نشد.');
  if (doc.status === 'voided') throw new AllocationError('سند باطل‌شده قابل تخصیص نیست.');
  if (doc.partyType !== 'customer' && doc.partyType !== 'supplier') {
    throw new AllocationError('این سند طرف حساب ندارد و تخصیص برای آن بی‌معناست.');
  }
  if (isReverseSettlement(doc)) {
    throw new AllocationError('سند تسویه‌ی معکوس (مثلاً پس دادن پیش‌پرداخت) به فاکتور تخصیص نمی‌یابد.');
  }

  const map = PARTY_MAP[doc.partyType];
  const docType = map.payType;
  const docValue = roundIRR(num(doc.valueIRR));
  const docGrams = roundGrams(num(doc.valueGrams));
  const docRate = num(doc.ratePerBaseGram) || (docGrams > 0 ? num(doc.valueIRR) / docGrams : 0);

  const current = await allocationsForDoc(docId);
  const currentByTarget = new Map(current.map((a) => [a.targetId, a]));
  const rows = await partyInvoices(doc.partyType, doc.partyId);
  const rowById = new Map(rows.map((r) => [r.targetId, r]));

  // ── اعتبارسنجی ──
  const fieldErrors = {};
  const seen = new Set();
  const clean = [];
  let sum = 0;

  for (const raw of entries) {
    const targetId = raw?.targetId;
    // (Phase 19) ورودی به گرم است؛ امضای ریالی قدیمی هم پذیرفته می‌شود تا کد
    // قدیمی بی‌صدا «صفر» تخصیص ندهد.
    const amount = roundGrams(
      raw?.amountGrams !== undefined ? num(raw.amountGrams) : docRate > 0 ? num(raw?.amountIRR) / docRate : 0
    );
    if (!targetId) continue;
    if (amount <= GRAM_EPS) continue;
    if (seen.has(targetId)) {
      fieldErrors[targetId] = 'برای یک فاکتور دو تخصیص جداگانه ثبت نشده است.';
      continue;
    }
    seen.add(targetId);

    const row = rowById.get(targetId);
    if (!row) {
      fieldErrors[targetId] = 'این فاکتور متعلق به همین طرف حساب نیست یا باطل شده است.';
      continue;
    }

    // ظرفیت فاکتور بدون احتساب تخصیص فعلیِ همین سند (چون قرار است جایگزین شود).
    const own = num(currentByTarget.get(targetId)?.amountGrams);
    const capacity = roundGrams(row.outstandingGrams + own);
    if (amount > capacity + GRAM_EPS) {
      fieldErrors[targetId] = `حداکثر مقدار قابل تخصیص به فاکتور ${row.number} برابر ${capacity} گرم ۷۵۰ است.`;
      continue;
    }

    sum = roundGrams(sum + amount);
    clean.push({
      targetId,
      targetType: row.targetType,
      number: row.number,
      amountGrams: amount,
      amountIRR: docRate > 0 ? Math.round(amount * docRate) : 0,
    });
  }

  if (sum > docGrams + GRAM_EPS) {
    fieldErrors.total = 'جمع تخصیص‌ها از مقدار سند تسویه بیشتر است.';
  }
  if (Object.keys(fieldErrors).length) {
    throw new AllocationError('تخصیص واردشده معتبر نیست.', fieldErrors);
  }

  const now = nowIso();
  const newRecords = buildAllocationRecords({
    docType,
    docId,
    docNumber: doc.number,
    partyType: doc.partyType,
    partyId: doc.partyId,
    date: doc.date,
    splits: clean,
    auto: false,
    now,
  });
  const voidedRecords = current.map((a) => ({ ...a, status: 'voided', voidedAt: now, updatedAt: now }));
  const sync = await prepareTargetSync({
    partyType: doc.partyType,
    partyId: doc.partyId,
    added: newRecords,
    voidedIds: current.map((a) => a.id),
    now,
  });

  await runTransaction(ALLOCATION_WRITE_STORES, 'readwrite', (tx) => {
    const store = tx.objectStore('allocations');
    for (const a of voidedRecords) store.put(a);
    for (const a of newRecords) store.add(a);
    writeTargetSync(tx, sync);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'allocations',
      entityId: docId,
      action: 'update',
      before: current,
      after: newRecords,
      note,
      timestamp: now,
    });
  });

  return {
    allocations: newRecords,
    unallocatedGrams: roundGrams(docGrams - sum),
    unallocatedIRR: roundIRR(docValue - newRecords.reduce((t, a) => t + num(a.amountIRR), 0)),
  };
}

/**
 * تخصیص‌های یک طرف حساب را از نو و کاملاً خودکار (FIFO) می‌چیند.
 * کاربرد: پس از ابطال یک فاکتور، یا وقتی کاربر می‌خواهد مبلغ علی‌الحسابِ انباشته
 * به فاکتورهای باز نسبت داده شود («تخصیص خودکار مانده علی‌الحساب» در صفحه‌ی طرف حساب).
 */
export async function autoAllocateUnallocated(partyType, partyId) {
  const { docs, totalGrams: availableGrams } = await unallocatedOf(partyType, partyId);
  if (!docs.length || availableGrams <= GRAM_EPS) return { allocated: 0, records: [] };
  // سقف: علی‌الحسابِ خالص (پس از کسر اسناد معکوس)، تا اعتباری که پس داده شده دوباره خرج نشود.
  let budgetGrams = availableGrams;

  const map = PARTY_MAP[partyType];
  const now = nowIso();
  const created = [];
  let totalAllocated = 0;
  let totalAllocatedGrams = 0;

  // هر سند جداگانه و به ترتیب تاریخ، تا تخصیص یک سند قدیمی به فاکتور قدیمی برود.
  const ordered = docs.slice().sort((a, b) => String(a.doc.date || '').localeCompare(String(b.doc.date || '')));

  for (const entry of ordered) {
    const open = await partyInvoices(partyType, partyId, { onlyOpen: true });
    if (!open.length) break;
    const docRate =
      num(entry.doc.ratePerBaseGram) ||
      (num(entry.doc.valueGrams) > 0 ? num(entry.doc.valueIRR) / num(entry.doc.valueGrams) : 0);
    const { splits } = planFifo(open, Math.min(entry.unallocatedGrams, budgetGrams), { rate: docRate });
    if (!splits.length) break;
    budgetGrams = roundGrams(budgetGrams - splits.reduce((s, x) => s + num(x.amountGrams), 0));

    const records = buildAllocationRecords({
      docType: map.payType,
      docId: entry.doc.id,
      docNumber: entry.doc.number,
      partyType,
      partyId,
      date: entry.doc.date,
      splits,
      auto: true,
      now,
    });
    const sync = await prepareTargetSync({ partyType, partyId, added: records, now });

    await runTransaction(ALLOCATION_WRITE_STORES, 'readwrite', (tx) => {
      const store = tx.objectStore('allocations');
      for (const a of records) store.add(a);
      writeTargetSync(tx, sync);
      tx.objectStore('auditLog').add({
        id: generateId(),
        entity: 'allocations',
        entityId: entry.doc.id,
        action: 'create',
        before: null,
        after: records,
        timestamp: now,
      });
    });

    created.push(...records);
    totalAllocated = roundIRR(totalAllocated + records.reduce((s, a) => s + a.amountIRR, 0));
    totalAllocatedGrams = roundGrams(totalAllocatedGrams + records.reduce((s, a) => s + a.amountGrams, 0));
    if (budgetGrams <= GRAM_EPS) break;
  }

  return { allocated: totalAllocated, allocatedGrams: totalAllocatedGrams, records: created };
}

/**
 * تخصیص‌های مربوط به یک فاکتورِ در حال ابطال را باطل می‌کند.
 * مبلغ آزادشده خودبه‌خود «علی‌الحساب» می‌شود — پول به طرف حساب برنمی‌گردد، فقط
 * دیگر بابت فاکتوری که وجود ندارد حساب نمی‌شود.
 * فقط رکوردها را برمی‌گرداند؛ نوشتن با تراکنشِ خودِ سرویس فاکتور انجام می‌شود.
 */
export async function prepareTargetVoid(targetId, { now = null } = {}) {
  const stamp = now || nowIso();
  const active = await allocationsForTarget(targetId);
  return active.map((a) => ({ ...a, status: 'voided', voidedAt: stamp, updatedAt: stamp }));
}

/** تخصیص‌های یک سند تسویه‌ی در حال ابطال. */
export async function prepareDocVoid(docId, { now = null } = {}) {
  const stamp = now || nowIso();
  const active = await allocationsForDoc(docId);
  return active.map((a) => ({ ...a, status: 'voided', voidedAt: stamp, updatedAt: stamp }));
}
