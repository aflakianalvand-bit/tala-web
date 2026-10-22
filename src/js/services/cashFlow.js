// cashFlow.js — واریز و برداشت مستقیم صندوق/بانک/کارتخوان (Phase 9)
//
// ═══════════════════════════════════════════════════════════════════════════
// دامنه‌ی این فایل با تصمیم صریح Phase 9 مشخص شد: «واریز/برداشت **بدون طرف حساب**».
// یعنی پولی که وارد یا خارج می‌شود ولی طرف مقابلش مشتری یا تأمین‌کننده نیست:
// آورده سرمایه، برداشت شخصی، هزینه، درآمد متفرقه و مانده ابتدای دوره.
// تسویه با مشتری/تأمین‌کننده عمداً اینجا نیست و دست‌نخورده به Phase 11 می‌رود.
//
// مسئله‌ی حسابداری که این فایل حل می‌کند:
// یک واریز به صندوق فقط یک طرف بدهکار دارد (صندوق زیاد شد). طرف بستانکار کجاست؟
// اگر رهایش کنیم، تراز آزمایشی (ACCOUNTING_RULES §7) در همان اولین واریز می‌شکند.
// بنابراین نوع طرف حساب جدیدی به دفتر اضافه شد: `accountRef.kind = 'other'` که
// `id` آن کلید یکی از دسته‌های زیر است. این یک Store جدید نیست — فقط یک مقدار
// جدید در فیلد موجود `accountRef` است، پس `DB_VERSION` را تغییر نداد.
//
// سند این عملیات در همان Storeهای موجود ثبت می‌شود:
//   واریز  → `receipts` با `partyType='other'`
//   برداشت → `payments` با `partyType='other'`
// دلیل: ماهیت این‌ها دقیقاً «سند دریافت/پرداخت» است و ساختن Store سوم یعنی سه
// جای مستقل برای شمردن یک چیز (هر گزارش نقدی Phase 14 باید هر سه را جمع می‌زد).
// ═══════════════════════════════════════════════════════════════════════════

import { get, getAll, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { nextDocumentNumber } from './docNumber.js';
import { checkWithdrawable, InsufficientBalanceError, IRR_EPS } from './accounts.js';
import {
  newPlan,
  addTransaction,
  addMoneyEntry,
  addReversal,
  assertBalanced,
  writePlan,
} from './postings.js';

/**
 * دسته‌های طرف مقابل برای واریز/برداشت بدون طرف حساب.
 * `direction` تعیین می‌کند دسته در فرم واریز دیده شود، در فرم برداشت، یا هر دو.
 * این فهرست عمداً در کد است و نه در دیتابیس: هر دسته یک **معنای حسابداری** دارد
 * (سرمایه در برابر هزینه در برابر درآمد) که گزارش‌های Phase 14 روی آن حساب می‌کنند؛
 * دسته‌ی آزادِ کاربرساخته این تفکیک را بی‌معنا می‌کرد. برای موارد خاص، دسته‌ی
 * «سایر» به‌همراه فیلد توضیحات وجود دارد.
 */
export const CASH_CATEGORIES = [
  { key: 'opening', label: 'مانده ابتدای دوره', direction: 'in' },
  { key: 'capital', label: 'آورده سرمایه', direction: 'in' },
  { key: 'otherIncome', label: 'درآمد متفرقه', direction: 'in' },
  { key: 'expense', label: 'هزینه', direction: 'out' },
  { key: 'drawing', label: 'برداشت شخصی', direction: 'out' },
  { key: 'other', label: 'سایر', direction: 'both' },
  // (Phase 10) طرف مقابلِ ریالیِ اسناد انبار. `direction: 'none'` یعنی در فرم واریز/برداشت
  // وجه دیده نمی‌شوند — این دسته‌ها فقط با ثبت «اصلاح موجودی» یا «ذوب» ساخته می‌شوند
  // (services/inventoryDocs.js). اینجا تعریف شده‌اند چون گزارش هزینه/درآمد Phase 14 باید
  // همه‌ی طرف‌های `other` را از یک فهرست بشناسد، نه از دو فهرست موازی.
  { key: 'inventoryGain', label: 'اضافی انبار', direction: 'none' },
  { key: 'inventoryLoss', label: 'کسری انبار', direction: 'none' },
  { key: 'meltLoss', label: 'افت ذوب', direction: 'none' },
  // (Phase 11) طرف مقابلِ «تخفیف تسویه». دو دسته‌ی جدا و نه یک دسته، چون از نظر
  // حسابداری دو چیز متفاوت‌اند: تخفیفی که ما به مشتری می‌دهیم **هزینه** است و
  // تخفیفی که تأمین‌کننده به ما می‌دهد **درآمد**. یک دسته‌ی مشترک، گزارش سود
  // Phase 14 را وادار می‌کرد علامت را از روی نوع طرف حساب حدس بزند.
  // `direction: 'none'` یعنی در فرم واریز/برداشت وجه دیده نمی‌شوند — فقط با ثبت
  // سند تسویه ساخته می‌شوند (services/settlements.js).
  { key: 'settlementDiscountGiven', label: 'تخفیف تسویه (اعطایی)', direction: 'none' },
  { key: 'settlementDiscountTaken', label: 'تخفیف تسویه (دریافتی)', direction: 'none' },
];

export const CASH_CATEGORY_LABELS = Object.fromEntries(
  CASH_CATEGORIES.map((c) => [c.key, c.label])
);

/** دسته‌های مجاز برای یک جهت ('in' = واریز، 'out' = برداشت). */
export function categoriesFor(direction) {
  return CASH_CATEGORIES.filter((c) => c.direction === direction || c.direction === 'both');
}

/** Storeهایی که یک عملیات کامل واریز/برداشت به آن‌ها می‌نویسد — همه در یک تراکنش. */
const WRITE_STORES = ['receipts', 'payments', 'transactions', 'goldLedger', 'moneyLedger', 'auditLog'];

export class CashFlowValidationError extends Error {
  constructor(fieldErrors) {
    super('اطلاعات سند واریز/برداشت نامعتبر است.');
    this.name = 'CashFlowValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class CashFlowStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CashFlowStateError';
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function storeFor(direction) {
  return direction === 'in' ? 'receipts' : 'payments';
}

// ───────────────────────── آماده‌سازی (فقط خواندن) ─────────────────────────

function normalizeInput(raw = {}) {
  return {
    date: raw.date || nowIso(),
    accountId: raw.accountId || null,
    categoryKey: raw.categoryKey || null,
    amountIRR: num(raw.amountIRR),
    description: String(raw.description ?? '').trim(),
  };
}

/**
 * ساخت کامل سند + طرح دفتری، پیش از باز شدن هر تراکنش.
 * @param {'in'|'out'} direction
 */
async function prepare(direction, rawInput, { allowNegative = false } = {}) {
  const input = normalizeInput(rawInput);

  // مبلغ واریز/برداشت **گِرد نمی‌شود**. گِردکردن ریالی (PRICING_RULES §5) برای مبالغ
  // *محاسبه‌شده* است (قیمت قلم فاکتور)؛ اینجا مبلغ یک جابه‌جایی واقعی وجه است که باید
  // دقیقاً با فیش بانکی/شمارش صندوق بخواند. گِردکردن آن یعنی ایجاد مغایرت از هیچ.
  const amountIRR = input.amountIRR;

  const errors = {};

  if (!(amountIRR > 0)) errors.amountIRR = 'مبلغ باید بزرگ‌تر از صفر باشد.';
  if (input.description.length > 500) errors.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
  if (Number.isNaN(new Date(input.date).getTime())) errors.date = 'تاریخ سند نامعتبر است.';

  const allowedCategories = categoriesFor(direction).map((c) => c.key);
  if (!input.categoryKey) {
    errors.categoryKey = direction === 'in' ? 'دسته‌ی واریز را انتخاب کنید.' : 'دسته‌ی برداشت را انتخاب کنید.';
  } else if (!allowedCategories.includes(input.categoryKey)) {
    errors.categoryKey = 'دسته‌ی انتخاب‌شده برای این عملیات مجاز نیست.';
  }

  let account = null;
  if (!input.accountId) {
    errors.accountId = 'حساب را انتخاب کنید.';
  } else {
    account = await get('accounts', input.accountId);
    if (!account || account.deletedAt) errors.accountId = 'حساب انتخاب‌شده یافت نشد یا حذف شده است.';
    else if (account.active === false) errors.accountId = 'حساب انتخاب‌شده غیرفعال است.';
  }

  if (Object.keys(errors).length > 0) throw new CashFlowValidationError(errors);

  // ── هشدار موجودی منفی (فقط برداشت؛ بلاک نمی‌کند، تأیید می‌خواهد) ──
  let shortage = null;
  if (direction === 'out') {
    shortage = await checkWithdrawable(input.accountId, amountIRR);
    if (shortage && !allowNegative) throw new InsufficientBalanceError([shortage]);
  }

  // ── ساخت رکوردها ──
  const now = nowIso();
  const store = storeFor(direction);
  const docId = generateId();
  const number = await nextDocumentNumber(store, input.date);

  const plan = newPlan();
  const transaction = addTransaction(plan, {
    type: direction === 'in' ? 'cash_deposit' : 'cash_withdrawal',
    sourceType: direction === 'in' ? 'receipt' : 'payment',
    sourceId: docId,
    date: input.date,
  });

  const accountRef = { kind: 'account', id: input.accountId };
  const categoryRef = { kind: 'other', id: input.categoryKey };

  if (direction === 'in') {
    // پول وارد حساب شد (بدهکار)، در برابر دسته‌ی مبدأ (بستانکار).
    addMoneyEntry(plan, { transactionId: transaction.id, reason: 'receive', accountRef, debit: amountIRR, date: input.date });
    addMoneyEntry(plan, { transactionId: transaction.id, reason: 'receive', accountRef: categoryRef, credit: amountIRR, date: input.date });
  } else {
    addMoneyEntry(plan, { transactionId: transaction.id, reason: 'pay', accountRef: categoryRef, debit: amountIRR, date: input.date });
    addMoneyEntry(plan, { transactionId: transaction.id, reason: 'pay', accountRef, credit: amountIRR, date: input.date });
  }

  assertBalanced(plan);

  const record = {
    id: docId,
    number,
    partyType: 'other',
    partyId: input.categoryKey,
    method: 'cash',
    amountIRR,
    valueIRR: amountIRR,
    accountId: input.accountId,
    weightGrams: null,
    karat: null,
    goldType: null,
    productId: null,
    ratePerGram: null,
    relatedDueDateId: null,
    date: input.date,
    description: input.description,
    transactionIds: [transaction.id],
    status: 'confirmed',
    createdAt: now,
    voidedAt: null,
  };

  return { store, record, plan, shortage, account };
}

// ─────────────────────────────── عملیات اصلی ───────────────────────────────

/**
 * واریز به حساب (بدون طرف حساب) — کل عملیات در یک IndexedDB Transaction.
 * @param {object} input `{date, accountId, categoryKey, amountIRR, description}`
 */
export async function createDeposit(input) {
  return commit('in', input, {});
}

/**
 * برداشت از حساب (بدون طرف حساب).
 * @param {object} options `allowNegative: true` پس از تأیید صریح کاربر روی هشدار موجودی.
 */
export async function createWithdrawal(input, options = {}) {
  return commit('out', input, options);
}

async function commit(direction, input, options) {
  const { store, record, plan, shortage } = await prepare(direction, input, options);
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore(store).add(record);
    writePlan(tx, plan);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: store,
      entityId: record.id,
      action: 'create',
      before: null,
      after: record,
      timestamp,
    });
  });

  return { record, shortage };
}

/**
 * لغو یک سند واریز/برداشت: Reversal کامل دفاتر + وضعیت `voided`.
 * سند و تراکنش اصلی هرگز حذف نمی‌شوند (ACCOUNTING_RULES §6).
 */
export async function voidCashFlow(store, id, { note = '' } = {}) {
  if (store !== 'receipts' && store !== 'payments') {
    throw new CashFlowStateError('نوع سند نامعتبر است.');
  }

  const record = await get(store, id);
  if (!record) throw new CashFlowStateError('سند مورد نظر یافت نشد.');
  if (record.partyType !== 'other') {
    throw new CashFlowStateError('این سند یک تسویه با طرف حساب است و از صفحه‌ی همان طرف حساب لغو می‌شود.');
  }
  if (record.status === 'voided') return record; // Idempotent

  const transactions = [];
  const goldEntries = [];
  const moneyEntries = [];
  for (const txId of record.transactionIds || []) {
    const transaction = await get('transactions', txId);
    if (!transaction) continue;
    if (transaction.reversedBy) {
      throw new CashFlowStateError('این سند قبلاً یک بار خنثی شده است؛ لغو دوباره مجاز نیست.');
    }
    transactions.push(transaction);
    goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
    moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
  }

  const now = nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: now });
  assertBalanced(plan);

  const voided = {
    ...record,
    status: 'voided',
    voidedAt: now,
    voidNote: note || record.voidNote || '',
    transactionIds: [...(record.transactionIds || []), ...plan.transactions.map((t) => t.id)],
  };

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore(store).put(voided);
    writePlan(tx, plan, new Map(transactions.map((t) => [t.id, t])));
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: store,
      entityId: voided.id,
      action: 'void',
      before: record,
      after: voided,
      timestamp: now,
    });
  });

  return voided;
}

// ──────────────────────────────── خواندن ────────────────────────────────

/**
 * فهرست اسناد واریز/برداشتِ بدون طرف حساب.
 * اسناد تسویه‌ی مشتری/تأمین‌کننده (partyType='customer'|'supplier') عمداً فیلتر می‌شوند —
 * آن‌ها متعلق به صفحه‌ی طرف حساب هستند، نه صفحه‌ی حساب‌ها.
 */
export async function listCashFlows({ direction = 'all', accountId = null, status = 'confirmed' } = {}) {
  const stores = direction === 'in' ? ['receipts'] : direction === 'out' ? ['payments'] : ['receipts', 'payments'];
  const rows = [];

  for (const store of stores) {
    const all = await getAll(store);
    for (const record of all) {
      if (record.partyType !== 'other') continue;
      if (status !== 'all' && record.status !== status) continue;
      if (accountId && record.accountId !== accountId) continue;
      rows.push({
        ...record,
        store,
        direction: store === 'receipts' ? 'in' : 'out',
        categoryLabel: CASH_CATEGORY_LABELS[record.partyId] || record.partyId,
      });
    }
  }

  return rows.sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate !== 0) return byDate;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

/**
 * جمع ورود/خروج هر دسته — پایه‌ی گزارش «هزینه و درآمد» Phase 14.
 * اعداد از **دفتر** می‌آیند نه از جمع اسناد، تا اگر روزی سندی بدون رکورد دفتری
 * ثبت شود (که نباید بشود) این ناسازگاری دیده شود.
 */
export async function categoryTotals() {
  const entries = await getAll('moneyLedger');
  const totals = new Map();

  for (const entry of entries) {
    if (entry?.accountRef?.kind !== 'other') continue;
    const key = entry.accountRef.id;
    const bucket = totals.get(key) || { key, label: CASH_CATEGORY_LABELS[key] || key, inIRR: 0, outIRR: 0 };
    // بستانکارِ دسته = پولی که از این دسته وارد کسب‌وکار شده (سرمایه/درآمد).
    // بدهکارِ دسته = پولی که به این دسته خارج شده (هزینه/برداشت).
    bucket.inIRR += num(entry.credit);
    bucket.outIRR += num(entry.debit);
    totals.set(key, bucket);
  }

  return CASH_CATEGORIES.map(
    (c) => totals.get(c.key) || { key: c.key, label: c.label, inIRR: 0, outIRR: 0 }
  ).filter((t) => Math.abs(t.inIRR) >= IRR_EPS || Math.abs(t.outIRR) >= IRR_EPS);
}
