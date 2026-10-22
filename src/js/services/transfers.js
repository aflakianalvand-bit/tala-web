// transfers.js — انتقال بین حساب‌ها (Phase 9)
//
// ═══════════════════════════════════════════════════════════════════════════
// خواسته‌ی صریح Phase 9: انتقال باید Double-entry و Atomic باشد. یعنی
//
//     صندوق نقدی → بانک
//
// هرگز نباید به دو عملیات جدا («خروج از صندوق» و بعد «ورود به بانک») تبدیل شود.
// اگر بین این دو، تراکنش شکست بخورد، پول ناپدید شده است. بنابراین هر انتقال
// **یک** Transaction با **دو** رکورد دفتر است که در **یک** IndexedDB Transaction
// نوشته می‌شوند (ARCHITECTURE §8). `assertBalanced()` هم پیش از باز شدن تراکنش
// بررسی می‌کند که Σبدهکار = Σبستانکار باشد.
//
// دامنه (تصمیم صریح Phase 9): **فقط انتقال هم‌واحد**
//   • وجه → وجه   (صندوق/بانک/کارتخوان به یکدیگر)
//   • طلا → طلا   (فقط با همان نوع و همان عیار)
// انتقال ریال↔طلا عمداً مجاز نیست: آن معامله «فروش/خرید طلا» است نه انتقال، و ثبت
// آن به‌عنوان انتقال باعث می‌شد سود/زیانش در هیچ گزارشی دیده نشود. تغییر عیار یا
// نوع طلا هم انتقال نیست؛ عملیات «ذوب/تبدیل» است که جای خودش را دارد
// (INVENTORY_RULES §4، با reason='melt').
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
import { roundWeight } from './pricing.js';
import { getPricingConfig } from './priceRates.js';
import {
  inventoryRefId,
  inventoryBalances,
  inventoryGramsOf,
  moneyBalanceOf,
} from './ledger.js';
import {
  checkWithdrawable,
  InsufficientBalanceError,
  ACCOUNT_TYPE_LABELS,
  GOLD_ACCOUNT_TYPE_LABELS,
  IRR_EPS,
  GRAM_EPS,
} from './accounts.js';
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

export const TRANSFER_KINDS = ['money', 'gold'];
export const TRANSFER_STATUSES = ['confirmed', 'voided'];

/** Storeهایی که یک عملیات کامل انتقال به آن‌ها می‌نویسد — همه در یک تراکنش. */
const WRITE_STORES = ['transfers', 'transactions', 'goldLedger', 'moneyLedger', 'auditLog'];

// ────────────────────────────────── خطاها ──────────────────────────────────

export class TransferValidationError extends Error {
  constructor(fieldErrors) {
    super('اطلاعات سند انتقال نامعتبر است.');
    this.name = 'TransferValidationError';
    this.fieldErrors = fieldErrors;
  }
}

export class TransferStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransferStateError';
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────────── نرمال‌سازی ───────────────────────────────

function normalizeInput(raw = {}) {
  const kind = TRANSFER_KINDS.includes(raw.kind) ? raw.kind : null;
  const base = {
    kind,
    date: raw.date || nowIso(),
    description: String(raw.description ?? '').trim(),
  };

  if (kind === 'gold') {
    return {
      ...base,
      fromRefId: raw.fromRefId || null,
      // مقصد می‌تواند سطلی باشد که هنوز وجود ندارد (مثلاً اولین بار که یک قلم
      // ساخته‌شده به موجودی عمومی همان نوع/عیار منتقل می‌شود)؛ بنابراین به‌جای
      // یک refId آماده، مشخصات سطل مقصد گرفته می‌شود و refId از همان تابع
      // مرجع inventoryRefId() ساخته می‌شود — نه با رشته‌سازی دستی.
      to: {
        goldType: raw.to?.goldType ?? null,
        karat: num(raw.to?.karat),
        productId: raw.to?.productId || null,
      },
      weightGrams: num(raw.weightGrams),
      fromAccountId: null,
      toAccountId: null,
      amountIRR: 0,
    };
  }

  return {
    ...base,
    fromAccountId: raw.fromAccountId || null,
    toAccountId: raw.toAccountId || null,
    amountIRR: num(raw.amountIRR),
    fromRefId: null,
    to: null,
    weightGrams: 0,
  };
}

// ────────────────────── آماده‌سازی انتقال وجه (فقط خواندن) ──────────────────────

async function prepareMoneyTransfer(input, { allowNegative = false }) {
  const errors = {};

  if (!(input.amountIRR > 0)) errors.amountIRR = 'مبلغ انتقال باید بزرگ‌تر از صفر باشد.';
  if (Number.isNaN(new Date(input.date).getTime())) errors.date = 'تاریخ سند نامعتبر است.';
  if (input.description.length > 500) errors.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';

  const [fromAccount, toAccount] = await Promise.all([
    input.fromAccountId ? get('accounts', input.fromAccountId) : null,
    input.toAccountId ? get('accounts', input.toAccountId) : null,
  ]);

  if (!input.fromAccountId) errors.fromAccountId = 'حساب مبدأ را انتخاب کنید.';
  else if (!fromAccount || fromAccount.deletedAt) errors.fromAccountId = 'حساب مبدأ یافت نشد یا حذف شده است.';
  else if (fromAccount.active === false) errors.fromAccountId = 'حساب مبدأ غیرفعال است.';

  if (!input.toAccountId) errors.toAccountId = 'حساب مقصد را انتخاب کنید.';
  else if (!toAccount || toAccount.deletedAt) errors.toAccountId = 'حساب مقصد یافت نشد یا حذف شده است.';
  else if (toAccount.active === false) errors.toAccountId = 'حساب مقصد غیرفعال است.';

  if (input.fromAccountId && input.fromAccountId === input.toAccountId) {
    errors.toAccountId = 'حساب مبدأ و مقصد نمی‌توانند یکی باشند.';
  }

  if (Object.keys(errors).length > 0) throw new TransferValidationError(errors);

  // ── هشدار موجودی منفی (بلاک نمی‌کند، تأیید می‌خواهد) ──
  const shortage = await checkWithdrawable(input.fromAccountId, input.amountIRR);
  if (shortage && !allowNegative) throw new InsufficientBalanceError([shortage]);

  const transferId = generateId();
  const number = await nextDocumentNumber('transfers', input.date);
  const now = nowIso();

  const plan = newPlan();
  const transaction = addTransaction(plan, {
    type: 'transfer',
    sourceType: 'transfer',
    sourceId: transferId,
    date: input.date,
  });

  // قلب Double-entry: خروج از مبدأ و ورود به مقصد، هر دو روی یک Transaction.
  addMoneyEntry(plan, {
    transactionId: transaction.id,
    reason: 'transfer',
    accountRef: { kind: 'account', id: input.fromAccountId },
    credit: input.amountIRR,
    date: input.date,
  });
  addMoneyEntry(plan, {
    transactionId: transaction.id,
    reason: 'transfer',
    accountRef: { kind: 'account', id: input.toAccountId },
    debit: input.amountIRR,
    date: input.date,
  });

  assertBalanced(plan);

  const record = {
    id: transferId,
    number,
    ...unitsStamp(),
    kind: 'money',
    date: input.date,
    from: { kind: 'account', id: input.fromAccountId },
    to: { kind: 'account', id: input.toAccountId },
    fromName: fromAccount.name,
    toName: toAccount.name,
    amountIRR: input.amountIRR,
    weightGrams: null,
    goldType: null,
    karat: null,
    movedValueIRR: null,
    description: input.description,
    status: 'confirmed',
    transactionIds: [transaction.id],
    createdAt: now,
    updatedAt: now,
    voidedAt: null,
    voidNote: '',
  };

  return { record, plan, shortages: shortage ? [shortage] : [] };
}

// ────────────────────── آماده‌سازی انتقال طلا (فقط خواندن) ──────────────────────

async function prepareGoldTransfer(input, { allowNegative = false }) {
  const errors = {};

  if (Number.isNaN(new Date(input.date).getTime())) errors.date = 'تاریخ سند نامعتبر است.';
  if (input.description.length > 500) errors.description = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';

  const buckets = await inventoryBalances();
  const source = input.fromRefId ? buckets.get(input.fromRefId) : null;

  if (!input.fromRefId) errors.fromRefId = 'حساب طلای مبدأ را انتخاب کنید.';
  else if (!source) errors.fromRefId = 'حساب طلای مبدأ در گردش انبار یافت نشد.';

  if (!input.to?.goldType) errors.to = 'حساب طلای مقصد را انتخاب کنید.';
  if (!isValidFineness(input.to?.karat)) errors.to = `عیار مقصد: ${FINENESS_ERROR}`;

  // پیکربندی گِردکردن وزن، همان قاعده‌ی خرید/فروش (PRICING_RULES §4، تصمیم Phase 8:
  // وزن گِردشده مبنای *هم* قیمت و *هم* موجودی است). اگر انتقال از این قاعده پیروی
  // نکند، وزن‌های نامضرب در انبار انباشته می‌شوند و موجودی سطل هرگز دقیقاً صفر نمی‌شود.
  const config = await getPricingConfig();
  const weightGrams = roundWeight(input.weightGrams, config);
  if (!(weightGrams > 0)) errors.weightGrams = 'وزن انتقال باید بزرگ‌تر از صفر باشد.';
  else if (!isValidScaleWeight(input.weightGrams)) errors.weightGrams = WEIGHT_DECIMALS_ERROR;

  const toRefId =
    !errors.to && input.to?.goldType
      ? inventoryRefId({ goldType: input.to.goldType, karat: input.to.karat, productId: input.to.productId })
      : null;

  // ── قاعده‌ی هم‌واحد بودن ──
  if (source && !errors.to) {
    if (source.goldType !== input.to.goldType) {
      errors.to =
        `انتقال فقط بین طلای هم‌نوع مجاز است ` +
        `(مبدأ: ${GOLD_ACCOUNT_TYPE_LABELS[source.goldType] || source.goldType}). ` +
        `تغییر نوع طلا یک عملیات «ذوب/تبدیل» است، نه انتقال.`;
    } else if (Number(source.karat) !== Number(input.to.karat)) {
      errors.to = `انتقال فقط بین طلای هم‌عیار مجاز است (عیار مبدأ: ${source.karat}).`;
    } else if (toRefId === input.fromRefId) {
      errors.to = 'حساب طلای مبدأ و مقصد نمی‌توانند یکی باشند.';
    }
  }

  if (input.to?.productId) {
    const product = await get('products', input.to.productId);
    if (!product || product.deletedAt) errors.to = 'کالای مقصد یافت نشد یا حذف شده است.';
    else if (product.type !== input.to.goldType) errors.to = 'نوع طلای مقصد با نوع کالای انتخاب‌شده یکسان نیست.';
  }

  if (Object.keys(errors).length > 0) throw new TransferValidationError(errors);

  // ── هشدار موجودی منفی طلا ──
  const available = source.grams;
  const shortages = [];
  if (available - weightGrams < -GRAM_EPS) {
    shortages.push({
      refId: input.fromRefId,
      goldType: source.goldType,
      karat: source.karat,
      productId: source.productId,
      available,
      requested: weightGrams,
      shortfall: weightGrams - available,
    });
  }
  if (shortages.length && !allowNegative) throw new InsufficientBalanceError(shortages);

  // ── جابه‌جایی ارزش دفتری سطل ──
  // اگر فقط گرم‌ها جابه‌جا شوند، ارزش ریالی طلای منتقل‌شده در سطل مبدأ جا می‌ماند و
  // سطلِ خالی‌شده تا ابد یک مانده‌ی ریالی بی‌صاحب نگه می‌دارد. بنابراین ارزش دفتری
  // به **نسبت وزن** با طلا حرکت می‌کند. نتیجه‌ی مهم و آزموده‌شده: انتقال کل موجودی
  // یک سطل، مانده‌ی ریالی آن را هم دقیقاً صفر می‌کند.
  const sourceBook = await moneyBalanceOf('inventory', input.fromRefId);
  let movedValueIRR = 0;
  if (Math.abs(available) > GRAM_EPS && Math.abs(sourceBook.balance) >= IRR_EPS) {
    const ratio = Math.abs(weightGrams - available) < GRAM_EPS ? 1 : weightGrams / available;
    movedValueIRR = Math.round(sourceBook.balance * ratio);
  }

  const transferId = generateId();
  const number = await nextDocumentNumber('transfers', input.date);
  const now = nowIso();

  const plan = newPlan();
  const transaction = addTransaction(plan, {
    type: 'transfer',
    sourceType: 'transfer',
    sourceId: transferId,
    date: input.date,
  });

  addGoldEntry(plan, {
    transactionId: transaction.id,
    direction: 'OUT',
    reason: 'transfer',
    accountRef: { kind: 'inventory', id: input.fromRefId },
    goldType: source.goldType,
    karat: source.karat,
    productId: source.productId,
    weightGrams,
    date: input.date,
  });
  addGoldEntry(plan, {
    transactionId: transaction.id,
    direction: 'IN',
    reason: 'transfer',
    accountRef: { kind: 'inventory', id: toRefId },
    goldType: input.to.goldType,
    karat: input.to.karat,
    productId: input.to.productId,
    weightGrams,
    date: input.date,
  });

  if (Math.abs(movedValueIRR) >= IRR_EPS) {
    // اگر ارزش دفتری سطل منفی باشد (ممکن است — ACCOUNTING_RULES §3.4)، جهت دو رکورد
    // برعکس می‌شود تا همان بدهی دفتری منتقل شود، نه اینکه از هیچ دارایی ساخته شود.
    const value = Math.abs(movedValueIRR);
    const positive = movedValueIRR > 0;
    addMoneyEntry(plan, {
      transactionId: transaction.id,
      reason: 'transfer',
      accountRef: { kind: 'inventory', id: input.fromRefId },
      credit: positive ? value : 0,
      debit: positive ? 0 : value,
      date: input.date,
    });
    addMoneyEntry(plan, {
      transactionId: transaction.id,
      reason: 'transfer',
      accountRef: { kind: 'inventory', id: toRefId },
      debit: positive ? value : 0,
      credit: positive ? 0 : value,
      date: input.date,
    });
  }

  assertBalanced(plan);

  const record = {
    id: transferId,
    number,
    ...unitsStamp(),
    kind: 'gold',
    date: input.date,
    from: { kind: 'inventory', id: input.fromRefId },
    to: { kind: 'inventory', id: toRefId },
    fromName: input.fromRefId,
    toName: toRefId,
    amountIRR: null,
    weightGrams,
    goldType: source.goldType,
    karat: source.karat,
    toProductId: input.to.productId || null,
    movedValueIRR,
    description: input.description,
    status: 'confirmed',
    transactionIds: [transaction.id],
    createdAt: now,
    updatedAt: now,
    voidedAt: null,
    voidNote: '',
  };

  return { record, plan, shortages };
}

// ─────────────────────────────── عملیات اصلی ───────────────────────────────

/**
 * ثبت سند انتقال — کل عملیات در یک IndexedDB Transaction.
 *
 * @param {object} input
 *   وجه: `{kind:'money', date, fromAccountId, toAccountId, amountIRR, description}`
 *   طلا: `{kind:'gold', date, fromRefId, to:{goldType,karat,productId}, weightGrams, description}`
 * @param {object} options `allowNegative: true` پس از تأیید صریح کاربر روی هشدار موجودی.
 */
export async function createTransfer(rawInput, options = {}) {
  const input = normalizeInput(rawInput);
  if (!input.kind) throw new TransferValidationError({ kind: 'نوع انتقال نامعتبر است.' });

  const prepared =
    input.kind === 'money'
      ? await prepareMoneyTransfer(input, options)
      : await prepareGoldTransfer(input, options);

  const { record, plan, shortages } = prepared;
  const timestamp = nowIso();

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('transfers').add(record);
    writePlan(tx, plan);
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'transfers',
      entityId: record.id,
      action: 'create',
      before: null,
      after: record,
      timestamp,
    });
  });

  return { transfer: record, shortages };
}

/**
 * لغو سند انتقال: Reversal کامل دفاتر + وضعیت `voided`.
 * سند و تراکنش اصلی هرگز حذف نمی‌شوند (ACCOUNTING_RULES §6).
 */
export async function voidTransfer(id, { note = '', allowNegative = false } = {}) {
  const record = await get('transfers', id);
  if (!record) throw new TransferStateError('سند انتقال مورد نظر یافت نشد.');
  if (record.status === 'voided') return record; // Idempotent

  const transactions = [];
  const goldEntries = [];
  const moneyEntries = [];
  for (const txId of record.transactionIds || []) {
    const transaction = await get('transactions', txId);
    if (!transaction) continue;
    if (transaction.reversedBy) {
      throw new TransferStateError('این سند قبلاً یک بار خنثی شده است؛ لغو دوباره مجاز نیست.');
    }
    transactions.push(transaction);
    goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
    moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
  }

  const now = nowIso();
  const plan = newPlan();
  addReversal(plan, { transactions, goldEntries, moneyEntries, date: now });
  assertBalanced(plan);
  // Phase 17: ابطال انتقال، طلا را از سطل مقصد برمی‌گرداند؛ اگر مصرف شده باشد منفی می‌شود.
  await assertPlanInventory(plan, { allowNegative, operation: 'ابطال این انتقال' });

  const voided = {
    ...record,
    status: 'voided',
    voidedAt: now,
    voidNote: note || record.voidNote || '',
    updatedAt: now,
    transactionIds: [...(record.transactionIds || []), ...plan.transactions.map((t) => t.id)],
  };

  await runTransaction(WRITE_STORES, 'readwrite', (tx) => {
    tx.objectStore('transfers').put(voided);
    writePlan(tx, plan, new Map(transactions.map((t) => [t.id, t])));
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'transfers',
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

/** نام قابل نمایش دو سر یک انتقال (حساب وجهی از رکورد، حساب طلایی از سطل انبار). */
async function decorateNames(rows) {
  const [accounts, products] = await Promise.all([getAll('accounts'), getAll('products')]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const productById = new Map(products.map((p) => [p.id, p]));

  const goldName = (refId, doc) => {
    if (!refId) return '—';
    refId = inventoryRefOfDoc(doc, refId); // Phase 22: سند قدیمی ⇒ شناسه‌ی سطل v10
    if (refId.startsWith('product:')) {
      const product = productById.get(refId.slice('product:'.length));
      return product ? `${product.name} (${product.code})` : refId;
    }
    const [goldType, karat] = refId.split(':');
    return `${GOLD_ACCOUNT_TYPE_LABELS[goldType] || goldType} — عیار ${karat}`;
  };

  return rows.map((row) => {
    const name = (ref) =>
      ref?.kind === 'account'
        ? accountById.get(ref.id)?.name || 'حساب حذف‌شده'
        : goldName(ref?.id, row);
    return {
      ...row,
      fromLabel: name(row.from),
      toLabel: name(row.to),
      fromTypeLabel:
        row.from?.kind === 'account'
          ? ACCOUNT_TYPE_LABELS[accountById.get(row.from.id)?.type] || ''
          : 'انبار طلا',
    };
  });
}

/**
 * فهرست اسناد انتقال با فیلتر.
 * @param {object} options `kind` ('all'|'money'|'gold')، `status`، `accountId` (هر سمت)، `search`
 */
export async function listTransfers({ kind = 'all', status = 'all', accountId = null, search = '' } = {}) {
  const all = await getAll('transfers');
  const term = String(search || '').trim().toLowerCase();

  const filtered = all.filter((t) => {
    if (kind !== 'all' && t.kind !== kind) return false;
    if (status !== 'all' && t.status !== status) return false;
    if (
      accountId &&
      t.from?.id !== accountId &&
      t.to?.id !== accountId &&
      inventoryRefOfDoc(t, t.from?.id) !== accountId &&
      inventoryRefOfDoc(t, t.to?.id) !== accountId
    ) {
      return false;
    }
    return true;
  });

  const decorated = await decorateNames(filtered);

  return decorated
    .filter((t) => {
      if (!term) return true;
      return `${t.number} ${t.fromLabel} ${t.toLabel} ${t.description}`.toLowerCase().includes(term);
    })
    .sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate !== 0) return byDate;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

/** جزئیات یک سند انتقال، همراه رکوردهای واقعی دفتر که ساخته است. */
export async function getTransferSummary(id) {
  const transfer = await get('transfers', id);
  if (!transfer) throw new TransferStateError('سند انتقال مورد نظر یافت نشد.');

  const [decorated] = await decorateNames([transfer]);

  const goldEntries = [];
  const moneyEntries = [];
  const transactions = [];
  for (const txId of transfer.transactionIds || []) {
    const transaction = await get('transactions', txId);
    if (transaction) transactions.push(transaction);
    goldEntries.push(...(await getByIndex('goldLedger', 'transactionId', txId)));
    moneyEntries.push(...(await getByIndex('moneyLedger', 'transactionId', txId)));
  }

  const history = (await getByIndex('auditLog', 'entityId', id))
    .filter((e) => e.entity === 'transfers')
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

  // مانده‌ی فعلی دو سر انتقال — همیشه از دفتر خوانده می‌شود، نه از سند.
  const balanceOf = async (ref) => {
    if (!ref) return null;
    if (ref.kind === 'account') return (await moneyBalanceOf('account', ref.id)).balance;
    return (await inventoryGramsOf(ref.id)).grams;
  };

  return {
    transfer: decorated,
    transactions,
    goldEntries,
    moneyEntries,
    history,
    fromBalance: await balanceOf(transfer.from),
    toBalance: await balanceOf(transfer.to),
  };
}

/** شاخص‌های نوار خلاصه‌ی فهرست انتقال‌ها. */
export function summarizeTransfers(rows) {
  const active = rows.filter((t) => t.status !== 'voided');
  return {
    count: active.length,
    moneyTotalIRR: active.filter((t) => t.kind === 'money').reduce((s, t) => s + num(t.amountIRR), 0),
    goldTotalGrams: active.filter((t) => t.kind === 'gold').reduce((s, t) => s + num(t.weightGrams), 0),
    voidedCount: rows.length - active.length,
  };
}
