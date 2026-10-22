// settlements.js — موتور دریافت و پرداخت مستقل (Phase 11)
//
// ═══════════════════════════════════════════════════════════════════════════
// تفاوت این فایل با تسویه‌ی داخل فاکتور (Phase 6/7):
// در خرید و فروش، تسویه **هم‌زمان با خود سند** ثبت می‌شود و همیشه بابت همان سند
// است. این فایل تسویه‌ی **بعدی** را می‌سازد: پولی که روزها بعد بابت یک یا چند
// فاکتور باز پرداخت/دریافت می‌شود، یا اصلاً بابت فاکتور مشخصی نیست (علی‌الحساب).
//
// ─── ساختار یک سند تسویه ───
// یک عملیات تسویه می‌تواند چند «خط» داشته باشد (تصمیم صریح: پرداخت ترکیبی):
//     ۵ میلیون نقد + ۲ گرم طلا + ۵۰۰ هزار تخفیف
// هر خط یک رکورد مستقل در `receipts`/`payments` با شماره‌ی سند خودش و یک
// Transaction مستقل می‌شود — دقیقاً همان الگوی Phase 6/7، نه یک ساختار موازی.
// خطوط یک عملیات با `batchId` به هم گره می‌خورند تا ابطال، یک واحد باشد.
//
// چرا هر خط یک رکورد و نه یک رکورد با آرایه‌ی خطوط: «گردش صندوق» و «گردش انبار»
// باید هر جابه‌جایی را جدا ببینند، و رکورد `receipts` از Phase 1 تک‌روشی طراحی
// شده است. یک رکورد چندروشی یعنی هر گزارش نقدی باید داخل آرایه بگردد.
//
// ─── چهار تصمیم کسب‌وکاری Phase 11 (پرسیده شد، حدس زده نشد) ───
//   ۱. تخصیص هنگام ثبت **فقط خودکار FIFO** است — کاربر سهم فاکتورها را انتخاب
//      نمی‌کند؛ قدیمی‌ترین بدهی اول تسویه می‌شود.
//   ۲. مازاد یا بدونِ فاکتورِ باز → **علی‌الحساب** (مانده بستانکار). بلاک نمی‌شود.
//   ۳. **تخفیف تسویه** یک خط مستقل است: بدهی را می‌بندد بدون آنکه پولی جابه‌جا شود.
//   ۴. تخصیص بعداً **مستقل از سند** قابل ویرایش است (services/allocations.js).
//
// ─── اصل ثابت ───
// هیچ عددی مستقیم تغییر نمی‌کند. مانده‌ی طرف حساب از دفتر می‌آید، مانده‌ی فاکتور
// از تخصیص‌ها، و موجودی طلا از دفتر طلا. این فایل فقط **رویداد** ثبت می‌کند.
// ═══════════════════════════════════════════════════════════════════════════

import { get, getAll, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { nextDocumentNumbers } from './docNumber.js';
import { inventoryRefId } from './ledger.js';
import { unitsStamp } from './units.js';
import { checkAvailable, assertPlanInventory } from './inventory.js';
import { checkWithdrawable, InsufficientBalanceError, IRR_EPS } from './accounts.js';
import { normalizeSettlement, validateSettlement, settlementValue } from './settlement.js';
import { CASH_CATEGORY_LABELS } from './cashFlow.js';
import { getPricingConfig } from './priceRates.js';
import { registerLabsInTx, labNamesOf, LAB_WRITE_STORES } from './labs.js';
import {
  PARTY_MAP,
  ALLOCATION_WRITE_STORES,
  roundIRR,
  partyInvoices,
  planFifo,
  buildAllocationRecords,
  roundGrams,
  prepareTargetSync,
  writeTargetSync,
  prepareDocVoid,
  allocationsForDoc,
  normalDirectionOf,
  settlementDirectionOf,
  isReverseSettlement,
  settlementStoreOf,
  partySettlementDocs,
} from './allocations.js';
import {
  newPlan,
  addTransaction,
  addGoldEntry,
  addMoneyEntry,
  addReversal,
  assertBalanced,
  writePlan,
} from './postings.js';

/** روش‌های تسویه. سه روش «نقد/کارتخوان/بانک» همگی `cash` هستند و با `accountId` از هم جدا می‌شوند. */
export const SETTLEMENT_LINE_METHODS = ['cash', 'gold', 'discount'];

/** دسته‌ی دفتریِ خط تخفیف، بر اساس اینکه تخفیف را می‌دهیم یا می‌گیریم. */
export const DISCOUNT_CATEGORY = {
  customer: 'settlementDiscountGiven',
  supplier: 'settlementDiscountTaken',
};

/** Storeهایی که یک عملیات کامل تسویه به آن‌ها می‌نویسد — همه در یک تراکنش. */
const WRITE_STORES = Array.from(
  new Set([
    'receipts',
    'payments',
    'transactions',
    'goldLedger',
    'moneyLedger',
    ...ALLOCATION_WRITE_STORES,
    // Phase 23: نام آزمایشگاهِ تازه در همان تراکنش سند به فهرست اضافه می‌شود.
    ...LAB_WRITE_STORES,
  ])
);

// ────────────────────────────────── خطاها ──────────────────────────────────

// (Phase 19) واحد رسمی مانده‌ی طرف حساب: گرم ۷۵۰.
import {
  goldSettlementPartsOf,
  baseGramsOf,
  effectiveRate as effectiveDocRate,
  roundBaseGrams,
  isZeroGrams,
  gramsOfIrr,
  GRAM_EPS as BASE_GRAM_EPS,
  unitsForConfig,
} from './goldTotals.js';

/**
 * (Phase 27) پیش‌نمایش جمع‌های فرم تسویه — پیش از این همین فرمول داخل SettlementForm.js بود
 * (گارد معماری: فرمول مالی فقط در services). خالص و بدون دسترسی به پایگاه‌داده؛ اعدادش همان
 * است که createSettlement با آن ثبت می‌کند (baseGramsOf / gramsOfIrr / effectiveDocRate / planFifo).
 *
 * @param {object} input
 * @param {Array} input.lines خط‌های فرم `{method, weightGrams, karat, ratePerGram, amountIRR}`
 * @param {number|string} input.discountIRR
 * @param {number|string} input.ratePerBaseGram فیِ واردشده در فرم
 * @param {Array} input.openRows فاکتورهای باز (`partyInvoices(..., {onlyOpen:true})`)
 * @param {object} [input.pricingConfig]
 */
export function previewSettlementTotals({ lines = [], discountIRR = 0, ratePerBaseGram = 0, openRows = [], pricingConfig = {} } = {}) {
  const lineValue = (line) => (line.method === 'gold' ? num(line.weightGrams) * num(line.ratePerGram) : num(line.amountIRR));
  // مقدار گرمی هر خط: طلا مستقیم، نقد فقط از مسیر فی (Phase 19).
  const lineGrams = (line, rate) => {
    if (line.method === 'gold') return baseGramsOf(num(line.weightGrams), num(line.karat));
    const g = gramsOfIrr(num(line.amountIRR), rate);
    return g === null ? 0 : g;
  };
  const rate = effectiveDocRate({ ratePerBaseGram: num(ratePerBaseGram) }, pricingConfig || {});
  const linesTotal = lines.reduce((s, l) => s + lineValue(l), 0);
  const discount = num(discountIRR);
  const total = roundIRR(linesTotal + discount);

  const discountGrams = discount > 0 ? gramsOfIrr(discount, rate) || 0 : 0;
  const totalGrams = roundBaseGrams(lines.reduce((s, l) => s + lineGrams(l, rate), 0) + discountGrams);
  const { splits } = planFifo(openRows, totalGrams, { rate });
  const allocatedGrams = roundBaseGrams(splits.reduce((s, x) => s + x.amountGrams, 0));
  // آیا سند بخش ریالی دارد که بدون فی قابل تبدیل نیست؟
  const needsRate = rate <= 0 && (discount > 0 || lines.some((l) => l.method !== 'gold' && num(l.amountIRR) > 0));
  return {
    rate,
    needsRate,
    linesTotal: roundIRR(linesTotal),
    discount,
    total,
    totalGrams,
    splits,
    allocatedGrams,
    unallocatedGrams: roundBaseGrams(totalGrams - allocatedGrams),
    outstandingGrams: roundBaseGrams(openRows.reduce((s, r) => s + r.outstandingGrams, 0)),
  };
}

export class SettlementValidationError extends Error {
  constructor({ fields = {}, lines = {} } = {}) {
    super('اطلاعات سند تسویه نامعتبر است.');
    this.name = 'SettlementValidationError';
    this.fieldErrors = fields;
    this.lineErrors = lines;
  }
  get isEmpty() {
    return Object.keys(this.fieldErrors).length === 0 && Object.keys(this.lineErrors).length === 0;
  }
}

/** کمبود موجودی طلا هنگام پرداخت با طلا — همان سیاست Phase 6: هشدار + تأیید، نه بلاک. */
export class SettlementGoldShortageError extends Error {
  constructor(shortages) {
    super('موجودی طلا برای این پرداخت کافی نیست.');
    this.name = 'SettlementGoldShortageError';
    this.shortages = shortages;
  }
}

export class SettlementStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SettlementStateError';
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────── نرمال‌سازی ورودی ───────────────────────────

function normalizeInput(raw = {}) {
  return {
    partyType: raw.partyType === 'supplier' ? 'supplier' : raw.partyType === 'customer' ? 'customer' : null,
    partyId: raw.partyId || null,
    // Phase 22: جهت مستقل از نوع طرف حساب ('in' ورود به ما، 'out' خروج از ما).
    direction: raw.direction === 'in' || raw.direction === 'out' ? raw.direction : null,
    date: raw.date ? new Date(raw.date).toISOString() : nowIso(),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map(normalizeSettlement),
    discountIRR: num(raw.discountIRR),
    // (Phase 19) «فیِ سند»: ریال هر گرم طلای ۷۵۰ (همان ۱۸ عیار).
    ratePerBaseGram: num(raw.ratePerBaseGram),
    discountNote: String(raw.discountNote ?? '').trim(),
    description: String(raw.description ?? '').trim(),
  };
}

/** واژه‌ی دامنه برای پیام‌های خطا. */
function labelFor(direction) {
  return direction === 'out' ? 'پرداخت' : 'دریافت';
}

// ──────────────────────────── آماده‌سازی (فقط خواندن) ────────────────────────────

/**
 * تمام خواندن‌ها، اعتبارسنجی‌ها و ساخت رکوردها — پیش از باز شدن هر تراکنش.
 * الگوی prepare/commit کل کدبیس: اگر هر چیزی ایراد داشته باشد، هیچ‌چیز نوشته نمی‌شود.
 */
async function prepareCreate(rawInput, { allowNegativeGold = false, allowNegativeCash = false } = {}) {
  const input = normalizeInput(rawInput);
  const pricingConfigForRate = await getPricingConfig();
  const fields = {};
  const lineErrors = {};

  if (!input.partyType) fields.partyType = 'نوع طرف حساب نامعتبر است.';
  if (Number.isNaN(new Date(input.date).getTime())) fields.date = 'تاریخ سند نامعتبر است.';
  if (input.description.length > 500) fields.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';

  const map = input.partyType ? PARTY_MAP[input.partyType] : null;
  if (!input.direction) input.direction = normalDirectionOf(input.partyType);
  const reverse = input.direction !== normalDirectionOf(input.partyType);
  const label = labelFor(input.direction);
  const units = unitsForConfig(pricingConfigForRate);
  if (reverse && input.discountIRR > IRR_EPS) {
    fields.discountIRR = 'تخفیف تسویه فقط در جهت عادی (دریافت از مشتری / پرداخت به تأمین‌کننده) معنا دارد.';
  }

  let party = null;
  if (!input.partyId) {
    fields.partyId = `${input.partyType === 'supplier' ? 'تأمین‌کننده' : 'مشتری'} را انتخاب کنید.`;
  } else if (map) {
    party = await get(input.partyType === 'supplier' ? 'suppliers' : 'customers', input.partyId);
    if (!party || party.deletedAt) fields.partyId = 'طرف حساب انتخاب‌شده یافت نشد یا حذف شده است.';
  }

  if (input.discountIRR < 0) fields.discountIRR = 'مبلغ تخفیف نمی‌تواند منفی باشد.';

  // ── اعتبارسنجی خطوط ──
  input.lines.forEach((line, i) => {
    const e = validateSettlement(line, label);
    if (Object.keys(e).length) lineErrors[i] = e;
  });

  if (!input.lines.length && input.discountIRR <= IRR_EPS) {
    fields.lines = `حداقل یک خط ${label} یا یک مبلغ تخفیف لازم است.`;
  }

  if (Object.keys(fields).length || Object.keys(lineErrors).length) {
    throw new SettlementValidationError({ fields, lines: lineErrors });
  }

  // ── ارزش هر خط ──
  // ارزش هر خط: ریالی (برای صندوق) و گرمی (واحد رسمی مانده‌ی طرف حساب).
  const docRate = effectiveDocRate(input, pricingConfigForRate);
  const lines = input.lines.map((line) => {
    const valueIRR = settlementValue(line, 0);
    const parts = goldSettlementPartsOf({ ...line, valueIRR }, docRate, units);
    return { ...line, valueIRR, valueGrams: parts.totalGrams, needsRate: parts.needsRate };
  });
  const discountGrams = input.discountIRR > IRR_EPS ? gramsOfIrr(input.discountIRR, docRate, units) : 0;
  if (lines.some((l) => l.needsRate) || discountGrams === null) {
    throw new SettlementValidationError({
      fields: {
        ratePerBaseGram:
          'این سند بخش نقدی یا تخفیف ریالی دارد؛ برای تبدیل آن به گرم، «فیِ سند» را وارد کنید.',
      },
    });
  }

  // ── بررسی وجود و فعال بودن حساب‌های نقدی ──
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.method !== 'cash') continue;
    const account = await get('accounts', line.accountId);
    if (!account || account.deletedAt) {
      lineErrors[i] = { ...(lineErrors[i] || {}), accountId: 'حساب انتخاب‌شده یافت نشد یا حذف شده است.' };
    } else if (account.active === false) {
      lineErrors[i] = { ...(lineErrors[i] || {}), accountId: 'حساب انتخاب‌شده غیرفعال است.' };
    }
  }
  if (Object.keys(lineErrors).length) throw new SettlementValidationError({ lines: lineErrors });

  // ── وضعیت بدهی فعلی طرف حساب (پایه‌ی تخصیص و سقف تخفیف) ──
  // سند معکوس هیچ فاکتوری نمی‌بندد (allocations.js، «جهت سند تسویه»).
  const openRows = reverse ? [] : await partyInvoices(input.partyType, input.partyId, { onlyOpen: true });
  const totalOutstanding = roundIRR(openRows.reduce((s, r) => s + r.outstandingIRR, 0));
  const totalOutstandingGrams = roundGrams(openRows.reduce((s, r) => s + r.outstandingGrams, 0));

  // تخفیف فقط بدهیِ موجود را می‌بخشد. تخفیفِ بیشتر از بدهی یعنی ساختن طلب از هیچ.
  // (Phase 19) سقف به واحد رسمی سنجیده می‌شود.
  if (discountGrams > totalOutstandingGrams + BASE_GRAM_EPS) {
    throw new SettlementValidationError({
      fields: {
        discountIRR: `تخفیف نمی‌تواند از مانده‌ی باز طرف حساب (${totalOutstandingGrams} گرم ۷۵۰) بیشتر باشد.`,
      },
    });
  }

  // ── هشدارهای موجودی (بلاک نمی‌کنند؛ تأیید صریح می‌خواهند — سیاست Phase 6/9) ──
  const goldShortages = [];
  const cashShortages = [];

  if (input.direction === 'out') {
    // خروج (پرداخت به تأمین‌کننده یا پس دادن به مشتری): طلا از انبار و پول از حساب خارج می‌شود.
    const goldNeeded = new Map();
    for (const line of lines) {
      if (line.method !== 'gold') continue;
      const refId = inventoryRefId(line);
      goldNeeded.set(refId, num(goldNeeded.get(refId)) + num(line.weightGrams));
    }
    for (const [refId, grams] of goldNeeded) {
      const shortage = await checkAvailable(refId, grams);
      if (shortage) goldShortages.push(shortage);
    }

    const cashNeeded = new Map();
    for (const line of lines) {
      if (line.method !== 'cash') continue;
      cashNeeded.set(line.accountId, num(cashNeeded.get(line.accountId)) + num(line.valueIRR));
    }
    for (const [accountId, amount] of cashNeeded) {
      const shortage = await checkWithdrawable(accountId, amount);
      if (shortage) cashShortages.push(shortage);
    }
  }

  if (goldShortages.length && !allowNegativeGold) throw new SettlementGoldShortageError(goldShortages);
  if (cashShortages.length && !allowNegativeCash) throw new InsufficientBalanceError(cashShortages);

  // ── ساخت رکوردهای سند ──
  const now = nowIso();
  const batchId = generateId();
  const store = settlementStoreOf(input.direction);
  const docType = input.direction === 'out' ? 'payment' : 'receipt';
  const hasDiscount = input.discountIRR > IRR_EPS;
  const docCount = lines.length + (hasDiscount ? 1 : 0);
  const numbers = await nextDocumentNumbers(store, input.date, docCount);

  const docs = lines.map((line, i) => ({
    id: generateId(),
    number: numbers[i],
    ...unitsStamp(units.mode),
    direction: input.direction,
    partyType: input.partyType,
    partyId: input.partyId,
    partyNameSnapshot: party?.name || '',
    method: line.method,
    amountIRR: line.method === 'cash' ? line.valueIRR : null,
    accountId: line.method === 'cash' ? line.accountId : null,
    weightGrams: line.method === 'gold' ? line.weightGrams : null,
    karat: line.method === 'gold' ? line.karat : null,
    goldType: line.method === 'gold' ? line.goldType : null,
    productId: line.method === 'gold' ? line.productId : null,
    ratePerGram: line.method === 'gold' ? line.ratePerGram : null,
    /** Phase 23: Snapshot نام آزمایشگاه (فقط آبشده/متفرقه). */
    labName: line.method === 'gold' ? line.labName || null : null,
    valueIRR: line.valueIRR,
    /** (Phase 19) واحد رسمی: گرم ۷۵۰. */
    valueGrams: line.valueGrams,
    ratePerBaseGram: docRate,
    relatedDueDateId: null,
    relatedPurchaseId: null,
    relatedSaleId: null,
    source: 'settlement',
    batchId,
    date: input.date,
    description: line.description || input.description,
    transactionIds: [],
    status: 'confirmed',
    createdAt: now,
    voidedAt: null,
  }));

  if (hasDiscount) {
    docs.push({
      id: generateId(),
      number: numbers[docCount - 1],
      ...unitsStamp(units.mode),
      direction: input.direction,
      partyType: input.partyType,
      partyId: input.partyId,
      partyNameSnapshot: party?.name || '',
      method: 'discount',
      amountIRR: input.discountIRR,
      accountId: null,
      weightGrams: null,
      karat: null,
      goldType: null,
      productId: null,
      ratePerGram: null,
      valueIRR: input.discountIRR,
      valueGrams: discountGrams,
      ratePerBaseGram: docRate,
      discountCategory: DISCOUNT_CATEGORY[input.partyType],
      relatedDueDateId: null,
      relatedPurchaseId: null,
      relatedSaleId: null,
      source: 'settlement',
      batchId,
      date: input.date,
      description: input.discountNote || input.description,
      transactionIds: [],
      status: 'confirmed',
      createdAt: now,
      voidedAt: null,
    });
  }

  const batchDocIds = docs.map((d) => d.id);
  for (const d of docs) d.batchDocIds = batchDocIds;

  // ── طرح دفاتر ──
  const plan = newPlan();
  const partyRef = { kind: input.partyType, id: input.partyId };

  for (const doc of docs) {
    if (doc.method === 'cash') {
      const tx = addTransaction(plan, {
        type: input.direction === 'in' ? 'receipt_cash' : 'payment_cash',
        sourceType: docType,
        sourceId: doc.id,
        date: doc.date,
      });
      doc.transactionIds = [tx.id];
      const accountRef = { kind: 'account', id: doc.accountId };
      if (input.direction === 'in') {
        // پول وارد حساب شد؛ طرف حساب بستانکار شد (بدهی مشتری کم / طلب تأمین‌کننده زیاد).
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'receive', accountRef, debit: doc.valueIRR, debitGrams: doc.valueGrams, date: doc.date });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'receive', accountRef: partyRef, credit: doc.valueIRR, creditGrams: doc.valueGrams, date: doc.date });
      } else {
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'pay', accountRef: partyRef, debit: doc.valueIRR, debitGrams: doc.valueGrams, date: doc.date });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'pay', accountRef, credit: doc.valueIRR, creditGrams: doc.valueGrams, date: doc.date });
      }
    } else if (doc.method === 'gold') {
      const tx = addTransaction(plan, {
        type: input.direction === 'in' ? 'receipt_gold' : 'payment_gold',
        sourceType: docType,
        sourceId: doc.id,
        date: doc.date,
      });
      doc.transactionIds = [tx.id];
      const refId = inventoryRefId(doc);
      const inventoryRef = { kind: 'inventory', id: refId };
      if (input.direction === 'in') {
        // طرف حساب طلا داد: طلا وارد انبار، طرف حساب بستانکار.
        addGoldEntry(plan, {
          transactionId: tx.id,
          direction: 'IN',
          reason: 'receipt_gold',
          accountRef: inventoryRef,
          goldType: doc.goldType,
          karat: doc.karat,
          productId: doc.productId,
          weightGrams: doc.weightGrams,
          date: doc.date,
        });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'receive', accountRef: inventoryRef, debit: doc.valueIRR, debitGrams: doc.valueGrams, date: doc.date });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'receive', accountRef: partyRef, credit: doc.valueIRR, creditGrams: doc.valueGrams, date: doc.date });
      } else {
        addGoldEntry(plan, {
          transactionId: tx.id,
          direction: 'OUT',
          reason: 'payment_gold',
          accountRef: inventoryRef,
          goldType: doc.goldType,
          karat: doc.karat,
          productId: doc.productId,
          weightGrams: doc.weightGrams,
          date: doc.date,
        });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'pay', accountRef: partyRef, debit: doc.valueIRR, debitGrams: doc.valueGrams, date: doc.date });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'pay', accountRef: inventoryRef, credit: doc.valueIRR, creditGrams: doc.valueGrams, date: doc.date });
      }
    } else {
      // ── خط تخفیف تسویه ──
      // هیچ پولی جابه‌جا نمی‌شود، ولی بدهی واقعاً از بین می‌رود؛ پس طرف مقابلش یک
      // دسته‌ی هزینه/درآمد است. بدون این طرف، تراز آزمایشی (ACCOUNTING_RULES §7)
      // در همان اولین تخفیف می‌شکست.
      const tx = addTransaction(plan, {
        type: 'settlement_discount',
        sourceType: docType,
        sourceId: doc.id,
        date: doc.date,
      });
      doc.transactionIds = [tx.id];
      const categoryRef = { kind: 'other', id: doc.discountCategory };
      if (input.partyType === 'customer') {
        // تخفیف اعطایی = هزینه‌ی ما.
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'settlement', accountRef: categoryRef, debit: doc.valueIRR, debitGrams: doc.valueGrams, date: doc.date });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'settlement', accountRef: partyRef, credit: doc.valueIRR, creditGrams: doc.valueGrams, date: doc.date });
      } else {
        // تخفیف دریافتی = درآمد ما.
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'settlement', accountRef: partyRef, debit: doc.valueIRR, debitGrams: doc.valueGrams, date: doc.date });
        addMoneyEntry(plan, { transactionId: tx.id, reason: 'settlement', accountRef: categoryRef, credit: doc.valueIRR, creditGrams: doc.valueGrams, date: doc.date });
      }
    }
  }

  assertBalanced(plan);

  // ── تخصیص خودکار FIFO ──
  // تخفیف اول تخصیص می‌یابد و بعد وجه/طلا؟ نه: هر سند سهم خودش را می‌گیرد، ولی
  // ترتیبِ سراسری همان FIFO فاکتورهاست. یک استخر مشترک ساخته می‌شود و به ترتیب
  // فاکتورها پر می‌شود؛ سپس سهم هر سند از آن استخر به همان ترتیب برداشته می‌شود.
  const totalSettled = roundIRR(docs.reduce((s, d) => s + num(d.valueIRR), 0));
  const totalSettledGrams = roundGrams(docs.reduce((s, d) => s + num(d.valueGrams), 0));
  const { splits } = planFifo(openRows, totalSettledGrams, { rate: docRate });
  const allocations = splitAcrossDocs(docs, splits, {
    docType,
    partyType: input.partyType,
    partyId: input.partyId,
    date: input.date,
    now,
    rate: docRate,
  });
  const allocatedIRR = roundIRR(allocations.reduce((s, a) => s + a.amountIRR, 0));
  const allocatedGrams = roundGrams(allocations.reduce((s, a) => s + a.amountGrams, 0));
  const unallocatedIRR = roundIRR(totalSettled - allocatedIRR);
  const unallocatedGrams = roundGrams(totalSettledGrams - allocatedGrams);

  const sync = await prepareTargetSync({
    partyType: input.partyType,
    partyId: input.partyId,
    added: allocations,
    now,
  });

  return {
    store,
    docs,
    plan,
    allocations,
    sync,
    totals: {
      totalSettledIRR: totalSettled,
      allocatedIRR,
      unallocatedIRR: unallocatedIRR <= IRR_EPS ? 0 : unallocatedIRR,
      discountIRR: hasDiscount ? input.discountIRR : 0,
      outstandingBefore: totalOutstanding,
      outstandingAfter: roundIRR(Math.max(0, totalOutstanding - allocatedIRR)),
      // ── واحد رسمی: گرم ۷۵۰ ──
      ratePerBaseGram: docRate,
      totalSettledGrams,
      allocatedGrams,
      unallocatedGrams: unallocatedGrams <= BASE_GRAM_EPS ? 0 : unallocatedGrams,
      discountGrams: hasDiscount ? discountGrams : 0,
      outstandingBeforeGrams: totalOutstandingGrams,
      outstandingAfterGrams: roundGrams(Math.max(0, totalOutstandingGrams - allocatedGrams)),
    },
    goldShortages,
    cashShortages,
    batchId,
    direction: input.direction,
    reverse,
  };
}

/**
 * سهم هر سند از تخصیص‌های محاسبه‌شده.
 * چرا لازم است: FIFO روی **کل مبلغ عملیات** حساب می‌شود (یک پرداخت ترکیبی یک
 * تسویه است)، ولی رکورد تخصیص باید به یک سند مشخص گره بخورد تا «ویرایش تخصیص»
 * و «ابطال سند» بدانند کدام رکوردها را جابه‌جا/باطل کنند.
 * الگوریتم: اسناد و فاکتورها هر دو به ترتیب پیمایش می‌شوند و هر بار کمینه‌ی
 * ظرفیت باقی‌مانده‌ی سند و فاکتور برداشته می‌شود.
 */
function splitAcrossDocs(docs, splits, { docType, partyType, partyId, date, now, rate = 0 }) {
  const records = [];
  let docIndex = 0;
  let docRest = docs.length ? roundGrams(num(docs[0].valueGrams)) : 0;

  for (const split of splits) {
    let rest = roundGrams(split.amountGrams);
    while (rest > BASE_GRAM_EPS && docIndex < docs.length) {
      if (docRest <= BASE_GRAM_EPS) {
        docIndex += 1;
        if (docIndex >= docs.length) break;
        docRest = roundGrams(num(docs[docIndex].valueGrams));
        continue;
      }
      const take = roundGrams(Math.min(docRest, rest));
      records.push(
        ...buildAllocationRecords({
          docType,
          docId: docs[docIndex].id,
          docNumber: docs[docIndex].number,
          partyType,
          partyId,
          date,
          splits: [
            {
              targetId: split.targetId,
              targetType: split.targetType,
              number: split.number,
              amountGrams: take,
              amountIRR: rate > 0 ? Math.round(take * rate) : 0,
            },
          ],
          auto: true,
          now,
        })
      );
      docRest = roundGrams(docRest - take);
      rest = roundGrams(rest - take);
    }
  }

  return records;
}

// ─────────────────────────────── عملیات اصلی ───────────────────────────────

/**
 * ثبت یک سند تسویه (دریافت از مشتری یا پرداخت به تأمین‌کننده) — کل عملیات در **یک**
 * IndexedDB Transaction: اسناد، تراکنش‌ها، رکوردهای دفتر، تخصیص‌ها و همگام‌سازی
 * وضعیت فاکتور/سررسید. اگر هر کدام شکست بخورد، هیچ‌کدام نوشته نمی‌شوند.
 *
 * @param {object} input `{partyType, partyId, date, lines:[{method,...}], discountIRR, discountNote, description}`
 * @param {object} options `allowNegativeGold` / `allowNegativeCash` پس از تأیید صریح کاربر روی هشدار.
 */
export async function createSettlement(input, options = {}) {
  const prepared = await prepareCreate(input, options);
  const { store, docs, plan, allocations, sync, totals, batchId } = prepared;
  const now = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    const docStore = tx.objectStore(store);
    for (const doc of docs) docStore.add(doc);
    writePlan(tx, plan);
    const allocStore = tx.objectStore('allocations');
    for (const a of allocations) allocStore.add(a);
    writeTargetSync(tx, sync);
    registerLabsInTx(tx, labNamesOf(docs), now);
    const audit = tx.objectStore('auditLog');
    for (const doc of docs) {
      audit.add({
        id: generateId(),
        entity: store,
        entityId: doc.id,
        action: 'create',
        before: null,
        after: doc,
        timestamp: now,
      });
    }
  });

  return {
    batchId,
    docs,
    allocations,
    totals,
    goldShortages: prepared.goldShortages,
    cashShortages: prepared.cashShortages,
  };
}

/**
 * ابطال یک سند تسویه. اگر سند بخشی از یک عملیات ترکیبی باشد، **کل عملیات** باطل
 * می‌شود — چون «۵ میلیون نقد + ۲ گرم طلا» یک تسویه بود، نه دو تسویه‌ی مستقل، و
 * ابطال نیمی از آن یک وضعیت مالی می‌ساخت که کاربر هرگز ثبتش نکرده بود.
 *
 * سند و تراکنش اصلی هرگز حذف نمی‌شوند (ACCOUNTING_RULES §6): یک Reversal کامل
 * نوشته می‌شود و تخصیص‌ها باطل می‌گردند، پس فاکتورها دوباره «باز» می‌شوند.
 */
export async function voidSettlement(docId, { note = '', allowNegative = false } = {}) {
  let store = 'receipts';
  let record = await get('receipts', docId);
  if (!record) {
    record = await get('payments', docId);
    store = 'payments';
  }
  if (!record) throw new SettlementStateError('سند تسویه یافت نشد.');
  if (record.source !== 'settlement') {
    throw new SettlementStateError(
      'این سند هم‌زمان با یک فاکتور ثبت شده است؛ برای ابطال آن، خودِ فاکتور را لغو کنید.'
    );
  }
  if (record.status === 'voided') return { docs: [record] }; // Idempotent

  const siblings = [];
  for (const id of record.batchDocIds || [record.id]) {
    const doc = id === record.id ? record : await get(store, id);
    if (doc && doc.status !== 'voided') siblings.push(doc);
  }

  const transactions = [];
  const goldEntries = [];
  const moneyEntries = [];
  for (const doc of siblings) {
    for (const txId of doc.transactionIds || []) {
      const transaction = await get('transactions', txId);
      if (!transaction) continue;
      if (transaction.reversedBy) {
        throw new SettlementStateError('این سند قبلاً یک بار خنثی شده است؛ ابطال دوباره مجاز نیست.');
      }
      transactions.push(transaction);
      goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
      moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
    }
  }

  const now = nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: now });
  assertBalanced(plan);
  // Phase 17: ابطال «دریافت طلا از مشتری» همان طلا را از انبار خارج می‌کند.
  await assertPlanInventory(plan, { allowNegative, operation: 'ابطال این سند تسویه' });

  const voidedAllocations = [];
  for (const doc of siblings) {
    voidedAllocations.push(...(await prepareDocVoid(doc.id, { now })));
  }

  const voidedDocs = siblings.map((doc) => ({
    ...doc,
    status: 'voided',
    voidedAt: now,
    voidNote: note || doc.voidNote || '',
    transactionIds: [
      ...(doc.transactionIds || []),
      ...plan.transactions
        .filter((t) => t.sourceId === doc.id)
        .map((t) => t.id),
    ],
  }));

  const sync = await prepareTargetSync({
    partyType: record.partyType,
    partyId: record.partyId,
    voidedIds: voidedAllocations.map((a) => a.id),
    now,
  });

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    const docStore = tx.objectStore(store);
    for (const doc of voidedDocs) docStore.put(doc);
    writePlan(tx, plan, new Map(transactions.map((t) => [t.id, t])));
    const allocStore = tx.objectStore('allocations');
    for (const a of voidedAllocations) allocStore.put(a);
    writeTargetSync(tx, sync);
    const audit = tx.objectStore('auditLog');
    for (const doc of voidedDocs) {
      audit.add({
        id: generateId(),
        entity: store,
        entityId: doc.id,
        action: 'void',
        before: siblings.find((s) => s.id === doc.id) || null,
        after: doc,
        timestamp: now,
      });
    }
  });

  return { docs: voidedDocs, allocations: voidedAllocations };
}

// ──────────────────────────────── خواندن ────────────────────────────────

/** فهرست اسناد تسویه‌ی مستقل (نه اسناد داخل فاکتور، نه واریز/برداشت بدون طرف حساب). */
export async function listSettlements({ partyType = 'all', partyId = null, status = 'confirmed' } = {}) {
  const rows = [];
  const push = (record, store) => {
    if (record.source !== 'settlement') return;
    if (status !== 'all' && record.status !== status) return;
    if (partyType !== 'all' && record.partyType !== partyType) return;
    rows.push({ ...record, store, direction: settlementDirectionOf(record), reverse: isReverseSettlement(record) });
  };

  if (partyId && partyType !== 'all') {
    // Phase 22: هر طرف حساب ممکن است در هر دو Store سند داشته باشد (جهت معکوس).
    for (const { doc, store } of await partySettlementDocs(partyType, partyId)) push(doc, store);
  } else {
    for (const store of ['receipts', 'payments']) {
      for (const record of await getAll(store)) push(record, store);
    }
  }

  return rows.sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate !== 0) return byDate;
    return String(b.number || '').localeCompare(String(a.number || ''));
  });
}

/** جزئیات کامل یک سند تسویه: خطوط هم‌گروه + تخصیص‌ها + فاکتورهای مقصد. */
export async function getSettlement(docId) {
  let store = 'receipts';
  let record = await get('receipts', docId);
  if (!record) {
    record = await get('payments', docId);
    store = 'payments';
  }
  if (!record) return null;

  const batch = [];
  for (const id of record.batchDocIds || [record.id]) {
    const doc = id === record.id ? record : await get(store, id);
    if (doc) batch.push(doc);
  }

  const allocations = [];
  for (const doc of batch) allocations.push(...(await allocationsForDoc(doc.id)));

  const targets = new Map();
  for (const a of allocations) {
    if (targets.has(a.targetId)) continue;
    const invoiceStore = a.targetType === 'sale' ? 'sales' : 'purchases';
    targets.set(a.targetId, await get(invoiceStore, a.targetId));
  }

  const totalSettledIRR = roundIRR(batch.filter((d) => d.status !== 'voided').reduce((s, d) => s + num(d.valueIRR), 0));
  const allocatedIRR = roundIRR(allocations.reduce((s, a) => s + num(a.amountIRR), 0));

  return {
    store,
    record,
    batch,
    allocations,
    targets,
    totalSettledIRR,
    allocatedIRR,
    unallocatedIRR: roundIRR(totalSettledIRR - allocatedIRR),
    discountCategoryLabel: record.discountCategory ? CASH_CATEGORY_LABELS[record.discountCategory] : null,
  };
}
