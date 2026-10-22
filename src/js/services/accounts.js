// accounts.js — موتور حساب‌ها و صندوق‌ها (Phase 9)
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل در Phase 6 به‌صورت حداقلی ساخته شد (فقط سه حساب پیش‌فرض تا سند خرید
// بتواند به آن‌ها ارجاع دهد). Phase 9 آن را به موتور کامل تبدیل می‌کند:
// ایجاد/ویرایش/حذف نرم حساب، مانده‌ی مشتق‌شده، گردش حساب و «حساب‌های طلایی».
//
// دو اصل حاکم بر این فایل:
//
// ۱) **هیچ مانده‌ای روی رکورد حساب ذخیره نمی‌شود.** رکورد `accounts` فقط هویت
//    حساب است (نام، نوع، وضعیت). موجودی همیشه در لحظه از `moneyLedger` مشتق
//    می‌شود — دستور پروژه §20 و ACCOUNTING_RULES §3.
//
// ۲) **حساب‌های طلایی (آبشده / متفرقه / ساخته‌شده) رکورد جدید نمی‌سازند.**
//    تصمیم قطعی‌شده‌ی Phase 9: «حساب طلا» یک **نما** روی همان سطل‌های موجودی
//    انبار در `goldLedger` است. اگر حساب طلا دفتر مستقل خودش را می‌گرفت، برای
//    یک گرم طلا دو عدد مستقل می‌داشتیم (یکی در انبار، یکی در حساب) که دیر یا زود
//    واگرا می‌شدند — دقیقاً همان چیزی که دستور پروژه §20 ممنوع کرده است.
//    نتیجه: صفحه‌ی حساب‌ها طلا را نشان می‌دهد، ولی منبع حقیقت همچنان انبار است و
//    این تصمیم هیچ Migration ای لازم نداشت.
// ═══════════════════════════════════════════════════════════════════════════

import { getAll, get, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import {
  moneyBalanceOf,
  moneyBalanceMap,
  moneyStatement,
  inventoryBalances,
  inventoryGramsOf,
  inventoryStatement,
} from './ledger.js';

/** انواع حساب وجهی — رکورد واقعی در Store `accounts`. */
export const ACCOUNT_TYPES = ['cashbox', 'bank', 'pos'];

export const ACCOUNT_TYPE_LABELS = {
  cashbox: 'صندوق نقدی',
  bank: 'حساب بانکی',
  pos: 'کارتخوان',
};

/**
 * انواع حساب طلایی — رکورد ندارند و از سطل‌های انبار مشتق می‌شوند (توضیح بالای فایل).
 * ترتیب همان ترتیب نمایش در صفحه‌ی حساب‌هاست.
 */
export const GOLD_ACCOUNT_TYPES = ['melted', 'misc', 'manufactured'];

export const GOLD_ACCOUNT_TYPE_LABELS = {
  melted: 'طلای آبشده',
  misc: 'طلای متفرقه',
  manufactured: 'طلای ساخته‌شده',
};

const DEFAULT_ACCOUNTS = [
  { name: 'صندوق نقدی', type: 'cashbox' },
  { name: 'حساب بانکی', type: 'bank' },
  { name: 'کارتخوان', type: 'pos' },
];

/** تلورانس مقایسه‌ی مبالغ ریالی (نیم ریال) و وزن (یک هزارم گرم) — همان مقادیر ماژول خرید/فروش. */
export const IRR_EPS = 0.5;
export const GRAM_EPS = 0.0005;

// ────────────────────────────────── خطاها ──────────────────────────────────

/** خطای اعتبارسنجی با نگاشت field → پیام (UI_GUIDELINES §3). */
export class AccountValidationError extends Error {
  constructor(fieldErrors) {
    super('اطلاعات حساب نامعتبر است.');
    this.name = 'AccountValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** حذف حسابی که هنوز اثر مالی باز دارد. */
export class AccountDeleteBlockedError extends Error {
  constructor(reasons) {
    super(reasons.join(' '));
    this.name = 'AccountDeleteBlockedError';
    this.reasons = reasons;
  }
}

/** عملیات روی حسابی که وضعیتش اجازه نمی‌دهد (نبودن، غیرفعال بودن، حذف‌شده). */
export class AccountStateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccountStateError';
  }
}

/**
 * موجودی حساب برای این برداشت/انتقال کافی نیست.
 *
 * تصمیم Phase 9 (پاسخ صریح کاربر): **بلاک نمی‌کنیم**، هشدار می‌دهیم و تأیید صریح
 * می‌گیریم — همان الگوی «پرداخت با طلا» در Phase 6. دلیل: ثبتِ با تأخیرِ یک رویداد
 * واقعی (پول دیروز از صندوق خارج شده و امروز ثبت می‌شود) نباید غیرممکن شود.
 * سرویس این خطا را پرتاب می‌کند و UI پس از تأیید کاربر دوباره با
 * `allowNegative: true` صدا می‌زند.
 */
export class InsufficientBalanceError extends Error {
  constructor(shortages) {
    super('موجودی حساب برای این عملیات کافی نیست.');
    this.name = 'InsufficientBalanceError';
    this.shortages = shortages;
  }
}

// ─────────────────────────── نرمال‌سازی و اعتبارسنجی ───────────────────────────

function normalizeInput(input = {}) {
  return {
    name: String(input.name ?? '').trim().replace(/\s+/g, ' '),
    type: input.type,
    notes: String(input.notes ?? '').trim(),
    active: input.active === undefined ? true : !!input.active,
  };
}

/** کلید مقایسه‌ی نام برای تشخیص تکراری بودن (فاصله و بزرگی/کوچکی حروف بی‌اثر). */
function nameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

async function validate(normalized, { excludeId = null } = {}) {
  const errors = {};

  if (!normalized.name) {
    errors.name = 'نام حساب الزامی است.';
  } else if (normalized.name.length > 60) {
    errors.name = 'نام حساب نباید بیش از ۶۰ نویسه باشد.';
  }

  if (!ACCOUNT_TYPES.includes(normalized.type)) {
    errors.type = 'نوع حساب نامعتبر است.';
  }

  if (normalized.notes.length > 500) {
    errors.notes = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
  }

  if (typeof normalized.active !== 'boolean') {
    errors.active = 'وضعیت حساب نامعتبر است.';
  }

  // نام حساب باید یکتا باشد. برخلاف کد مشتری/کالا این یکتایی در سطح سرویس تضمین
  // می‌شود نه Index، چون نام قابل ویرایش است و Index یکتا روی یک فیلد قابل ویرایش،
  // ویرایش‌های موقتاً متعارض را غیرقابل‌بازیابی می‌کند. دلیل کاربردی: دو «صندوق نقدی»
  // هم‌نام در فرم انتقال قابل تشخیص نیستند.
  if (!errors.name) {
    const all = await getAll('accounts');
    const clash = all.find(
      (a) => !a.deletedAt && a.id !== excludeId && nameKey(a.name) === nameKey(normalized.name)
    );
    if (clash) errors.name = 'حسابی با همین نام از قبل وجود دارد.';
  }

  if (Object.keys(errors).length > 0) throw new AccountValidationError(errors);
}

// ─────────────────────── نوشتن اتمیک همراه Audit ───────────────────────

/** نوشتن روی `accounts` + رکورد `auditLog` در **همان** IndexedDB Transaction. */
function writeWithAudit({ action, entityId, before, after }) {
  return runTransaction(['accounts', 'auditLog'], 'readwrite', (tx) => {
    const store = tx.objectStore('accounts');
    if (before === null) store.add(after);
    else store.put(after);

    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'accounts',
      entityId,
      action,
      before,
      after,
      timestamp: nowIso(),
    });
  });
}

// ──────────────────────────────── CRUD ────────────────────────────────

export async function getAccount(id) {
  return get('accounts', id);
}

/**
 * اگر هیچ حسابی وجود نداشته باشد، سه حساب پیش‌فرض را می‌سازد.
 * Idempotent است: اگر کاربر حساب‌ها را قبلاً ساخته یا تغییر داده باشد، دست نمی‌زند.
 */
export async function ensureDefaultAccounts() {
  const existing = await getAll('accounts');
  if (existing.length > 0) return existing;

  const now = nowIso();
  const records = DEFAULT_ACCOUNTS.map((a) => ({
    id: generateId(),
    name: a.name,
    type: a.type,
    notes: '',
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }));

  await runTransaction(['accounts', 'auditLog'], 'readwrite', (tx) => {
    const store = tx.objectStore('accounts');
    const audit = tx.objectStore('auditLog');
    for (const record of records) {
      store.add(record);
      audit.add({
        id: generateId(),
        entity: 'accounts',
        entityId: record.id,
        action: 'create',
        before: null,
        after: record,
        timestamp: now,
      });
    }
  });

  return records;
}

export async function createAccount(input) {
  const normalized = normalizeInput(input);
  await validate(normalized);

  const now = nowIso();
  const record = {
    id: generateId(),
    name: normalized.name,
    type: normalized.type,
    notes: normalized.notes,
    active: normalized.active,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await writeWithAudit({ action: 'create', entityId: record.id, before: null, after: record });
  return record;
}

/**
 * ویرایش حساب — فقط هویت (نام/نوع/توضیحات/وضعیت). هیچ عدد مالی‌ای اینجا تغییر نمی‌کند.
 *
 * تغییر **نوع** حساب مجاز است چون نوع فقط برچسب دسته‌بندی است و در هیچ فرمول مالی
 * استفاده نمی‌شود (رکوردهای دفتر به `id` ارجاع می‌دهند، نه به نوع).
 */
export async function updateAccount(id, input) {
  const existing = await get('accounts', id);
  if (!existing) throw new AccountStateError('حساب مورد نظر یافت نشد.');
  if (existing.deletedAt) throw new AccountStateError('حساب حذف‌شده قابل ویرایش نیست؛ ابتدا آن را بازگردانید.');

  const normalized = normalizeInput(input);
  await validate(normalized, { excludeId: id });

  const updated = {
    ...existing,
    name: normalized.name,
    type: normalized.type,
    notes: normalized.notes,
    active: normalized.active,
    updatedAt: nowIso(),
  };

  await writeWithAudit({ action: 'update', entityId: id, before: existing, after: updated });
  return updated;
}

/**
 * بررسی مجاز بودن حذف نرم.
 * قانون: حسابی که مانده‌ی غیرصفر دارد حذف نمی‌شود — حذف آن یعنی گم‌شدن پولی که
 * هنوز جایی هست. حسابِ با تاریخچه ولی مانده‌ی صفر قابل حذف است، چون رکوردهای دفتر
 * دست‌نخورده باقی می‌مانند و گردش گذشته همچنان قابل مشاهده است.
 */
export async function checkAccountDeletable(id) {
  const money = await moneyBalanceOf('account', id);
  const reasons = [];
  if (Math.abs(money.balance) >= IRR_EPS) reasons.push('مانده این حساب صفر نیست.');
  return { deletable: reasons.length === 0, reasons, balance: money.balance };
}

/** Soft Delete — حذف فیزیکی هرگز انجام نمی‌شود (Audit Trail و یکپارچگی اسناد گذشته). */
export async function softDeleteAccount(id, { force = false } = {}) {
  const existing = await get('accounts', id);
  if (!existing) throw new AccountStateError('حساب مورد نظر یافت نشد.');
  if (existing.deletedAt) return existing; // Idempotent

  if (!force) {
    const guard = await checkAccountDeletable(id);
    if (!guard.deletable) throw new AccountDeleteBlockedError(guard.reasons);
  }

  const updated = { ...existing, active: false, deletedAt: nowIso(), updatedAt: nowIso() };
  await writeWithAudit({ action: 'void', entityId: id, before: existing, after: updated });
  return updated;
}

export async function restoreAccount(id) {
  const existing = await get('accounts', id);
  if (!existing) throw new AccountStateError('حساب مورد نظر یافت نشد.');
  if (!existing.deletedAt) return existing; // Idempotent

  const updated = { ...existing, active: true, deletedAt: null, updatedAt: nowIso() };
  await writeWithAudit({ action: 'update', entityId: id, before: existing, after: updated });
  return updated;
}

/** تاریخچه کامل تغییرات یک حساب (جدیدترین اول). */
export async function getAccountHistory(id) {
  const entries = await getByIndex('auditLog', 'entityId', id);
  return entries
    .filter((e) => e.entity === 'accounts')
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

// ───────────────────────────── فهرست + مانده ─────────────────────────────

/**
 * فهرست حساب‌های وجهی همراه مانده‌ی **مشتق‌شده**.
 * مانده‌ی همه‌ی حساب‌ها با یک بار خواندن دفتر گرفته می‌شود (نه یک کوئری به ازای هر حساب).
 *
 * @param {object} options
 * @param {string} options.search جستجو در نام/نوع
 * @param {string} options.status 'active' (پیش‌فرض) | 'inactive' | 'deleted' | 'all'
 */
export async function listAccounts({ search = '', status = 'active', includeInactive = false } = {}) {
  const effectiveStatus = includeInactive && status === 'active' ? 'all' : status;

  const [all, balances] = await Promise.all([getAll('accounts'), moneyBalanceMap('account')]);
  const term = String(search || '').trim().toLowerCase();

  return all
    .map((a) => ({ ...a, balance: balances.get(a.id) || 0 }))
    .filter((a) => {
      if (effectiveStatus === 'active' && (a.deletedAt || !a.active)) return false;
      if (effectiveStatus === 'inactive' && (a.deletedAt || a.active)) return false;
      if (effectiveStatus === 'deleted' && !a.deletedAt) return false;
      if (effectiveStatus === 'all' && a.deletedAt) return false;

      if (term) {
        const haystack = `${a.name} ${ACCOUNT_TYPE_LABELS[a.type] || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const byType = ACCOUNT_TYPES.indexOf(a.type) - ACCOUNT_TYPES.indexOf(b.type);
      if (byType !== 0) return byType;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
}

/** فهرست حساب‌های قابل انتخاب در فرم‌های پرداخت/دریافت (فعال و حذف‌نشده). */
export async function listSelectableAccounts() {
  return listAccounts({ status: 'active' });
}

/** مانده‌ی یک حساب — همیشه مشتق از دفتر. */
export async function accountBalance(id) {
  const { balance } = await moneyBalanceOf('account', id);
  return balance;
}

/** جمع موجودی همه‌ی حساب‌های وجهیِ فعال — «موجودی صندوق» داشبورد Phase 13. */
export async function totalCashBalance() {
  const rows = await listAccounts({ status: 'active' });
  return rows.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
}

// ─────────────────────── حساب‌های طلایی (نما روی انبار) ───────────────────────

/**
 * شناسه‌ی «حساب طلایی» همان `refId` سطل انبار است (`melted:18`، `product:<id>`، …).
 * هیچ رکوردی ساخته نمی‌شود؛ فهرست از روی گردش واقعی `goldLedger` بازسازی می‌شود.
 *
 * @param {object} options
 * @param {boolean} options.includeEmpty سطل‌هایی که موجودی‌شان صفر شده هم بیایند
 */
export async function listGoldAccounts({ includeEmpty = false, goldType = 'all' } = {}) {
  const [buckets, products] = await Promise.all([inventoryBalances(), getAll('products')]);
  const productById = new Map(products.map((p) => [p.id, p]));

  const rows = [];
  for (const bucket of buckets.values()) {
    if (!includeEmpty && Math.abs(bucket.grams) < GRAM_EPS) continue;
    if (goldType !== 'all' && bucket.goldType !== goldType) continue;

    const product = bucket.productId ? productById.get(bucket.productId) : null;
    rows.push({
      refId: bucket.refId,
      goldType: bucket.goldType,
      karat: bucket.karat,
      productId: bucket.productId,
      productName: product ? product.name : null,
      productCode: product ? product.code : null,
      grams: bucket.grams,
      name: product
        ? `${product.name} (${product.code})`
        : `${GOLD_ACCOUNT_TYPE_LABELS[bucket.goldType] || bucket.goldType} — عیار ${bucket.karat}`,
    });
  }

  return rows.sort((a, b) => {
    const byType = GOLD_ACCOUNT_TYPES.indexOf(a.goldType) - GOLD_ACCOUNT_TYPES.indexOf(b.goldType);
    if (byType !== 0) return byType;
    if (a.karat !== b.karat) return a.karat - b.karat;
    return String(a.name).localeCompare(String(b.name), 'fa');
  });
}

/** جمع موجودی طلا به تفکیک نوع (گرم) — نمای «حساب» روی انبار. */
export async function goldAccountTotals() {
  const rows = await listGoldAccounts({ includeEmpty: true });
  const totals = Object.fromEntries(GOLD_ACCOUNT_TYPES.map((t) => [t, 0]));
  for (const row of rows) {
    if (totals[row.goldType] === undefined) totals[row.goldType] = 0;
    totals[row.goldType] += row.grams;
  }
  return totals;
}

// ────────────────────────────── جزئیات حساب ──────────────────────────────

/**
 * تمام داده‌های صفحه‌ی جزئیات یک حساب وجهی، در یک بار خواندن.
 * مانده‌ی پایانی `statement` همیشه دقیقاً برابر `balance` است (هر دو از یک منبع می‌آیند).
 */
export async function getAccountSummary(id) {
  const account = await get('accounts', id);
  if (!account) throw new AccountStateError('حساب مورد نظر یافت نشد.');

  const [money, statement, history, allTransfers] = await Promise.all([
    moneyBalanceOf('account', id),
    moneyStatement('account', id),
    getAccountHistory(id),
    getAll('transfers'),
  ]);

  const transfers = allTransfers
    .filter((t) => t.status !== 'voided' && (t.from?.id === id || t.to?.id === id))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  return {
    account,
    balance: money.balance,
    balanceParts: { debit: money.debit, credit: money.credit },
    statement: statement.rows,
    closing: statement.closing,
    transfers,
    history,
  };
}

/**
 * جزئیات یک «حساب طلایی» — که در واقع یک سطل انبار است.
 * موجودی و گردش مستقیماً از `goldLedger` می‌آیند؛ هیچ عددی ذخیره نشده است.
 */
export async function getGoldAccountSummary(refId) {
  const [inv, statement, buckets, products] = await Promise.all([
    inventoryGramsOf(refId),
    inventoryStatement(refId),
    inventoryBalances(),
    getAll('products'),
  ]);

  const bucket = buckets.get(refId);
  if (!bucket) throw new AccountStateError('حساب طلایی مورد نظر یافت نشد.');

  const product = bucket.productId ? products.find((p) => p.id === bucket.productId) : null;
  const costIRR = await moneyBalanceOf('inventory', refId);

  return {
    refId,
    goldType: bucket.goldType,
    karat: bucket.karat,
    productId: bucket.productId,
    productName: product ? product.name : null,
    name: product
      ? `${product.name} (${product.code})`
      : `${GOLD_ACCOUNT_TYPE_LABELS[bucket.goldType] || bucket.goldType} — عیار ${bucket.karat}`,
    grams: inv.grams,
    inGrams: inv.inGrams,
    outGrams: inv.outGrams,
    /**
     * مانده‌ی ریالی این سطل. توجه (ACCOUNTING_RULES §3.4): چون هنگام فروش، کل مبلغ
     * فروش از سطل بستانکار می‌شود، این عدد **بهای تمام‌شده‌ی دقیق نیست** و فقط
     * ارزش دفتری سطل است. گزارش سود Phase 14 نباید به آن تکیه کند.
     */
    bookValueIRR: costIRR.balance,
    statement: statement.rows,
    closing: statement.closing,
  };
}

/**
 * بررسی کفایت موجودی یک حساب وجهی برای خروج مبلغ مشخص.
 * خروجی `null` یعنی مشکلی نیست؛ در غیر این صورت شیء کمبود برای نمایش در هشدار.
 */
export async function checkWithdrawable(accountId, amountIRR, { extraOutflow = 0 } = {}) {
  const account = await get('accounts', accountId);
  const balance = await accountBalance(accountId);
  const after = balance - Number(amountIRR || 0) - Number(extraOutflow || 0);
  if (after >= -IRR_EPS) return null;
  return {
    accountId,
    accountName: account ? account.name : accountId,
    available: balance,
    requested: Number(amountIRR || 0) + Number(extraOutflow || 0),
    shortfall: -after,
  };
}
