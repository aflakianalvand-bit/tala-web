// postings.js — لایه‌ی «نوشتن» در دفاتر (Gold Ledger / Money Ledger) — معرفی‌شده در Phase 6
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل مکمل services/ledger.js است:
//   ledger.js   → فقط خواندن و اشتقاق مانده (Phase 4)
//   postings.js → فقط ساختن رکوردهای Transaction/Ledger و نوشتن اتمیک آن‌ها
//
// چرا جدا؟ چون خواندن در همه‌جای برنامه لازم است، اما نوشتن فقط از داخل
// سرویس‌های تجاری (purchases, sales, payments, ...) و همیشه داخل یک
// IndexedDB Transaction واحد مجاز است (ARCHITECTURE.md §8 — اتمیک‌بودن).
//
// این فایل هیچ‌وقت خودش runTransaction باز نمی‌کند. توابع آن یک «طرح نوشتن»
// (Plan) می‌سازند و سرویس تجاری آن طرح را داخل تراکنش خودش می‌نویسد. دلیل:
// یک عملیات تجاری (مثل «اصلاح خرید» = لغو سند قدیمی + ثبت سند جدید) باید
// در **یک** تراکنش انجام شود، نه چند تراکنش پشت‌سرهم که ممکن است نیمه‌کاره بماند.
// ═══════════════════════════════════════════════════════════════════════════

import { GRAM_EPS as GRAM_EPS_750 } from './units.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';

/** Storeهایی که هر عملیات دفتری به آن‌ها نیاز دارد (برای باز کردن runTransaction). */
export const LEDGER_STORES = ['transactions', 'goldLedger', 'moneyLedger'];

/** خطای نقض تراز (Σdebit ≠ Σcredit) — پیش از هر نوشتنی پرتاب می‌شود. */
export class UnbalancedPostingError extends Error {
  constructor(debit, credit, unit = 'ریال') {
    super(`تراز دفتر برقرار نیست: بدهکار ${debit} در برابر بستانکار ${credit} (${unit}).`);
    this.name = 'UnbalancedPostingError';
    this.debit = debit;
    this.credit = credit;
    this.unit = unit;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** یک طرح خالی: ظرف رکوردهایی که قرار است نوشته شوند. */
export function newPlan() {
  return { transactions: [], goldEntries: [], moneyEntries: [], reversedTransactionIds: [] };
}

/**
 * یک Transaction جدید می‌سازد و به طرح اضافه می‌کند.
 * Transaction پوسته‌ی نازک و تغییرناپذیر رویداد است (ARCHITECTURE.md §11).
 */
export function addTransaction(plan, { type, sourceType, sourceId, date, isReversal = false, reversalOf = null }) {
  const record = {
    id: generateId(),
    type,
    sourceType,
    sourceId,
    date,
    createdAt: nowIso(),
    isReversal: !!isReversal,
    reversalOf: reversalOf || null,
    reversedBy: null,
  };
  plan.transactions.push(record);
  return record;
}

/**
 * یک رکورد Gold Ledger.
 * `weightGrams` همیشه مثبت است؛ جهت از `direction` می‌آید (DATABASE_SCHEMA §3.9).
 */
export function addGoldEntry(plan, { transactionId, direction, reason, accountRef, goldType, karat, productId = null, weightGrams, date }) {
  if (direction !== 'IN' && direction !== 'OUT') {
    throw new Error(`جهت رکورد دفتر طلا نامعتبر است: ${direction}`);
  }
  const w = num(weightGrams);
  if (w <= 0) throw new Error('وزن رکورد دفتر طلا باید بزرگ‌تر از صفر باشد.');

  const record = {
    id: generateId(),
    transactionId,
    direction,
    reason,
    accountRef,
    goldType,
    karat: num(karat),
    productId: productId || null,
    weightGrams: w,
    date,
  };
  plan.goldEntries.push(record);
  return record;
}

/**
 * یک رکورد Money Ledger (فقط یکی از debit/credit غیرصفر است).
 *
 * (Phase 19) هر رکورد **دو مقدار** دارد: مبلغ ریالی و وزن معادل «گرم ۷۵۰».
 * واحد رسمی مانده‌ی طرف حساب از این فاز گرم است؛ ریال کنارش می‌ماند چون صندوق،
 * بانک و کارتخوان واقعاً ریال دارند. یک سند **رسیدی بدون فی** فقط مقدار گرمی
 * دارد و مقدار ریالی‌اش صفر است — و این دقیقاً همان چیزی است که «فی الزامی
 * نباشد» یعنی: نه اینکه ریالِ نامعلوم را صفر وانمود کنیم، بلکه اینکه اصلاً
 * واحد حساب، ریال نباشد.
 */
export function addMoneyEntry(plan, {
  transactionId,
  reason,
  accountRef,
  debit = 0,
  credit = 0,
  debitGrams = 0,
  creditGrams = 0,
  date,
}) {
  const d = num(debit);
  const c = num(credit);
  const dg = num(debitGrams);
  const cg = num(creditGrams);
  if (d < 0 || c < 0 || dg < 0 || cg < 0) throw new Error('مبلغ بدهکار/بستانکار نمی‌تواند منفی باشد.');
  if (d > 0 && c > 0) throw new Error('یک رکورد دفتر وجه نمی‌تواند هم‌زمان بدهکار و بستانکار باشد.');
  if (dg > 0 && cg > 0) throw new Error('یک رکورد دفتر وجه نمی‌تواند هم‌زمان بدهکار و بستانکار طلا باشد.');
  if (d > 0 && cg > 0) throw new Error('جهت ریالی و جهت طلایی یک رکورد دفتر باید یکی باشد.');
  if (c > 0 && dg > 0) throw new Error('جهت ریالی و جهت طلایی یک رکورد دفتر باید یکی باشد.');
  if (d === 0 && c === 0 && dg === 0 && cg === 0) {
    throw new Error('رکورد دفتر وجه با مبلغ و وزن صفر ثبت نمی‌شود.');
  }

  const record = {
    id: generateId(),
    transactionId,
    reason,
    accountRef,
    debit: d,
    credit: c,
    debitGrams: dg,
    creditGrams: cg,
    date,
  };
  plan.moneyEntries.push(record);
  return record;
}

/**
 * تراز آزمایشی طرح را **پیش از نوشتن** بررسی می‌کند (ACCOUNTING_RULES §7).
 * این بررسی عمداً قبل از باز شدن IndexedDB Transaction انجام می‌شود تا یک طرح
 * ناتراز هرگز حتی به‌صورت موقت وارد دیتابیس نشود.
 */
export function assertBalanced(plan) {
  let debit = 0;
  let credit = 0;
  let debitGrams = 0;
  let creditGrams = 0;
  for (const e of plan.moneyEntries) {
    debit += num(e.debit);
    credit += num(e.credit);
    debitGrams += num(e.debitGrams);
    creditGrams += num(e.creditGrams);
  }
  if (Math.abs(debit - credit) >= 0.5) throw new UnbalancedPostingError(debit, credit, 'ریال');
  // (Phase 19) تراز دوم: واحد رسمی مانده. تلورانس نیمِ آخرین رقم معنادار (۰٫۰۰۵ گرم).
  if (Math.abs(debitGrams - creditGrams) >= GRAM_EPS_750) {
    throw new UnbalancedPostingError(debitGrams, creditGrams, 'گرم ۷۵۰');
  }
  return { debit, credit, debitGrams, creditGrams };
}

/**
 * طرح «معکوس» یک مجموعه رکورد موجود را می‌سازد (ACCOUNTING_RULES §6).
 * برای هر Transaction اصلی یک Transaction جدید با isReversal=true ساخته می‌شود که
 * دقیقاً همان رکوردهای دفتر را با جهت معکوس تکرار می‌کند. رکورد اصلی هرگز حذف
 * یا ویرایش نمی‌شود؛ فقط فیلد reversedBy آن پر می‌گردد.
 *
 * @param {object} plan طرحی که رکوردهای معکوس به آن اضافه می‌شوند
 * @param {Array} transactions تراکنش‌های اصلی
 * @param {Array} goldEntries رکوردهای طلای اصلی (همه‌ی تراکنش‌ها)
 * @param {Array} moneyEntries رکوردهای وجه اصلی
 * @param {string} date تاریخ ثبت سند اصلاحی
 */
export function addReversal(plan, { transactions, goldEntries, moneyEntries, date }) {
  for (const original of transactions) {
    if (original.reversedBy) {
      throw new Error('این تراکنش قبلاً یک بار خنثی (Reversal) شده است.');
    }
    const reversal = addTransaction(plan, {
      type: original.type,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      date: date || original.date,
      isReversal: true,
      reversalOf: original.id,
    });
    plan.reversedTransactionIds.push({ originalId: original.id, reversalId: reversal.id });

    for (const g of goldEntries.filter((x) => x.transactionId === original.id)) {
      addGoldEntry(plan, {
        transactionId: reversal.id,
        direction: g.direction === 'IN' ? 'OUT' : 'IN',
        reason: g.reason,
        accountRef: g.accountRef,
        goldType: g.goldType,
        karat: g.karat,
        productId: g.productId,
        weightGrams: g.weightGrams,
        date: date || g.date,
      });
    }

    for (const m of moneyEntries.filter((x) => x.transactionId === original.id)) {
      addMoneyEntry(plan, {
        transactionId: reversal.id,
        reason: m.reason,
        accountRef: m.accountRef,
        debit: num(m.credit),
        credit: num(m.debit),
        debitGrams: num(m.creditGrams),
        creditGrams: num(m.debitGrams),
        date: date || m.date,
      });
    }
  }
  return plan;
}

/**
 * طرح را داخل یک IndexedDB Transaction **که قبلاً توسط سرویس تجاری باز شده** می‌نویسد.
 * هیچ await ی اینجا انجام نمی‌شود — همه‌ی درخواست‌ها هم‌زمان روی همان tx صف می‌شوند،
 * وگرنه تراکنش IndexedDB به‌صورت خودکار بسته می‌شود.
 *
 * @param {IDBTransaction} tx تراکنشی که حداقل شامل LEDGER_STORES است
 * @param {object} plan خروجی newPlan() پس از پر شدن
 * @param {Map<string,object>} originalTransactions نگاشت id → رکورد تراکنش اصلی (برای ثبت reversedBy)
 */
export function writePlan(tx, plan, originalTransactions = new Map()) {
  const txStore = tx.objectStore('transactions');
  const goldStore = tx.objectStore('goldLedger');
  const moneyStore = tx.objectStore('moneyLedger');

  for (const t of plan.transactions) txStore.add(t);
  for (const g of plan.goldEntries) goldStore.add(g);
  for (const m of plan.moneyEntries) moneyStore.add(m);

  // ثبت ارجاع معکوس روی تراکنش اصلی (تنها فیلد قابل نوشتن روی یک تراکنش ثبت‌شده).
  for (const { originalId, reversalId } of plan.reversedTransactionIds) {
    const original = originalTransactions.get(originalId);
    if (original) txStore.put({ ...original, reversedBy: reversalId });
  }
}
