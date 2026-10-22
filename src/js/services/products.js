// products.js — لایه سرویس تجاری کالا (Phase 3)
//
// قانون کلیدی معماری (رجوع به ARCHITECTURE.md §3): UI هرگز مستقیماً روی Store «products» یا
// «auditLog» نمی‌نویسد؛ همیشه از طریق توابع همین فایل عبور می‌کند تا:
//   ۱) کد کالا همیشه به‌صورت خودکار و یکتا تولید شود،
//   ۲) هر create/update/soft-delete/restore به‌صورت اتمیک یک رکورد auditLog هم بسازد
//      (تاریخچه تغییرات — DATABASE_SCHEMA.md §3.14)،
//   ۳) اعتبارسنجی ورودی یک‌جا و بدون تکرار در فرم‌های مختلف انجام شود.
//
// این فایل هرگز موجودی طلا (goldLedger) را تغییر نمی‌دهد — طبق دستور صریح Phase 3:
// «اطلاعات کالا مستقیماً موجودی را تغییر ندهد». اتصال به موجودی واقعی از Phase 10 برقرار می‌شود.

import { isValidFineness, isValidScaleWeight, FINENESS_ERROR, WEIGHT_DECIMALS_ERROR } from './units.js';
import { getAll, get, getByIndex } from '../db/repo.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';

export const PRODUCT_TYPES = ['manufactured', 'melted', 'misc'];
export const WAGE_TYPES = ['percent', 'perGram'];
export const UNITS = ['piece', 'gram'];

const CODE_PREFIX = { manufactured: 'SAKH', melted: 'AB', misc: 'MOT' };

/** خطای اعتبارسنجی با نگاشت field → پیام، برای نمایش دقیق کنار هر فیلد در فرم (طبق UI_GUIDELINES §3). */
export class ProductValidationError extends Error {
  constructor(fieldErrors) {
    super('اطلاعات کالا نامعتبر است.');
    this.name = 'ProductValidationError';
    this.fieldErrors = fieldErrors;
  }
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validate(input) {
  const errors = {};

  if (!input.name) errors.name = 'نام کالا الزامی است.';

  if (!PRODUCT_TYPES.includes(input.type)) {
    errors.type = 'نوع طلا نامعتبر است.';
  }

  // Phase 22: عیار هزاری (۷۵۰، ۹۹۹، …)، عدد صحیح ۱ تا ۱۰۰۰.
  if (!isValidFineness(input.karat)) {
    errors.karat = FINENESS_ERROR;
  }

  if (!isFiniteNumber(input.weightGrams) || input.weightGrams <= 0) {
    errors.weightGrams = 'وزن باید عددی بزرگ‌تر از صفر باشد (گرم).';
  } else if (!isValidScaleWeight(input.weightGrams)) {
    errors.weightGrams = WEIGHT_DECIMALS_ERROR;
  }

  if (!UNITS.includes(input.unit)) {
    errors.unit = 'واحد نامعتبر است.';
  }

  if (input.type === 'manufactured') {
    if (!WAGE_TYPES.includes(input.wageType)) {
      errors.wageType = 'نوع اجرت را انتخاب کنید.';
    }
    if (!isFiniteNumber(input.wageValue) || input.wageValue < 0) {
      errors.wageValue = 'اجرت نمی‌تواند منفی باشد.';
    }
    if (!isFiniteNumber(input.profitPercent) || input.profitPercent < 0) {
      errors.profitPercent = 'سود نمی‌تواند منفی باشد.';
    }
    if (!isFiniteNumber(input.taxPercent) || input.taxPercent < 0) {
      errors.taxPercent = 'مالیات نمی‌تواند منفی باشد.';
    }
  }

  if (input.priceToday !== null && (!isFiniteNumber(input.priceToday) || input.priceToday < 0)) {
    errors.priceToday = 'قیمت روز نمی‌تواند منفی باشد.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ProductValidationError(errors);
  }
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

/** کد خودکار بعدی برای یک نوع طلا را تولید می‌کند (شامل اسکن کالاهای حذف‌شده‌ی نرم برای جلوگیری از تکرار). */
export async function nextProductCode(type) {
  const prefix = CODE_PREFIX[type];
  if (!prefix) throw new Error('نوع کالا برای تولید کد نامعتبر است.');
  const all = await getAll('products');
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const p of all) {
    const m = re.exec(p.code || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${pad4(max + 1)}`;
}

/**
 * ورودی خام فرم را به شکل نهایی/تمیز‌شده‌ی رکورد کالا تبدیل می‌کند.
 * فیلدهای اجرت/سود/مالیات برای انواع غیر از «ساخته‌شده» همیشه صفر/null اجباری می‌شوند (BUSINESS_RULES §8).
 */
function normalizeInput(input) {
  const isManufactured = input.type === 'manufactured';
  const priceToday =
    input.priceToday === '' || input.priceToday === undefined || input.priceToday === null
      ? null
      : Number(input.priceToday);

  return {
    name: String(input.name ?? '').trim(),
    type: input.type,
    karat: Number(input.karat),
    weightGrams: Number(input.weightGrams),
    unit: input.unit,
    wageType: isManufactured ? input.wageType || 'percent' : null,
    wageValue: isManufactured ? Number(input.wageValue) || 0 : 0,
    profitPercent: isManufactured ? Number(input.profitPercent) || 0 : 0,
    taxPercent: isManufactured ? Number(input.taxPercent) || 0 : 0,
    priceToday: Number.isNaN(priceToday) ? null : priceToday,
    description: String(input.description ?? '').trim(),
    active: !!input.active,
  };
}

/** نوشتن اتمیک روی «products» + یک رکورد «auditLog» در همان IndexedDB Transaction (بدون شکاف بین این دو). */
function writeWithAudit({ action, entityId, before, after }) {
  return runTransaction(['products', 'auditLog'], 'readwrite', (tx) => {
    const store = tx.objectStore('products');
    if (before === null) {
      store.add(after);
    } else {
      store.put(after);
    }
    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'products',
      entityId,
      action,
      before,
      after,
      timestamp: nowIso(),
    });
  });
}

/**
 * فهرست کالاها با پشتیبانی جستجو/فیلتر (در حافظه، روی خروجی getAll — تعداد کالای یک فروشگاه
 * طلافروشی معمولاً کوچک است، نیازی به Index اختصاصی جستجو نیست).
 * status: 'active' (پیش‌فرض، فقط فعال و حذف‌نشده) | 'inactive' | 'deleted' | 'all'
 */
export async function listProducts({ search = '', type = 'all', status = 'active' } = {}) {
  const all = await getAll('products');
  const term = search.trim().toLowerCase();

  return all
    .filter((p) => {
      if (status === 'active' && (p.deletedAt || !p.active)) return false;
      if (status === 'inactive' && (p.deletedAt || p.active)) return false;
      if (status === 'deleted' && !p.deletedAt) return false;
      if (type !== 'all' && p.type !== type) return false;
      if (term) {
        const haystack = `${p.code} ${p.name}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getProduct(id) {
  return get('products', id);
}

export async function createProduct(input) {
  const normalized = normalizeInput(input);
  validate(normalized);

  const code = await nextProductCode(normalized.type);
  const now = nowIso();
  const product = {
    id: generateId(),
    code,
    ...normalized,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await writeWithAudit({ action: 'create', entityId: product.id, before: null, after: product });
  return product;
}

export async function updateProduct(id, input) {
  const existing = await get('products', id);
  if (!existing) throw new Error('کالای مورد نظر یافت نشد.');

  const normalized = normalizeInput(input);
  validate(normalized);

  const updated = {
    ...existing,
    ...normalized,
    id: existing.id,
    code: existing.code, // کد پس از ایجاد هرگز تغییر نمی‌کند (DATABASE_SCHEMA §3.1.1)
    createdAt: existing.createdAt,
    deletedAt: existing.deletedAt,
    updatedAt: nowIso(),
  };

  await writeWithAudit({ action: 'update', entityId: id, before: existing, after: updated });
  return updated;
}

/** Soft Delete: هرگز رکورد را حذف فیزیکی نمی‌کند، فقط deletedAt را ثبت و active را false می‌کند. */
export async function softDeleteProduct(id) {
  const existing = await get('products', id);
  if (!existing) throw new Error('کالای مورد نظر یافت نشد.');
  if (existing.deletedAt) return existing; // از قبل حذف شده — Idempotent

  const updated = { ...existing, active: false, deletedAt: nowIso(), updatedAt: nowIso() };
  await writeWithAudit({ action: 'void', entityId: id, before: existing, after: updated });
  return updated;
}

/** بازیابی کالای حذف‌شده‌ی نرم. */
export async function restoreProduct(id) {
  const existing = await get('products', id);
  if (!existing) throw new Error('کالای مورد نظر یافت نشد.');
  if (!existing.deletedAt) return existing; // از قبل فعال است — Idempotent

  const updated = { ...existing, active: true, deletedAt: null, updatedAt: nowIso() };
  await writeWithAudit({ action: 'update', entityId: id, before: existing, after: updated });
  return updated;
}

/** تاریخچه کامل تغییرات یک کالا (جدیدترین اول)، از روی auditLog. */
export async function getProductHistory(id) {
  const entries = await getByIndex('auditLog', 'entityId', id);
  return entries
    .filter((e) => e.entity === 'products')
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}
