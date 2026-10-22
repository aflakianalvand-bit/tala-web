// labs.js — فهرست آزمایشگاه‌ها و نام آزمایشگاه روی اسناد طلای آبشده/متفرقه — Phase 23
//
// ═══════════════════════════════════════════════════════════════════════════
// قواعد کسب‌وکار (BUSINESS_RULES §11.4 و §11.9):
//   • «آزمایشگاه» یک فیلد **متنی اختیاری** روی خطِ طلای آبشده/متفرقه است (نه ساخته‌شده).
//   • نامِ ثبت‌شده در سند **Snapshot** است (`labName`)؛ ویرایش نام در فهرست، سند قبلی
//     را تغییر نمی‌دهد.
//   • تایپ نامی که در فهرست نیست خطا نیست: **در همان تراکنش ثبت سند** به فهرست اضافه
//     می‌شود. اگر سند ثبت نشود، نام هم اضافه نمی‌شود (اتمیک).
//   • حذف = غیرفعال‌سازی. نام غیرفعال از پیشنهادها پنهان می‌شود؛ اگر کاربر دوباره
//     همان نام را تایپ کند، دوباره فعال می‌شود (رکورد تکراری ساخته نمی‌شود).
//   • آزمایشگاه جزو شناسه‌ی سطل انبار نیست (INVENTORY_RULES §۱۲.۴).
//
// ─── چرا فهرست داخل `settings` و نه یک Object Store جدا ───
// یک Store جدید یعنی DB v11، و مهم‌تر: `checksumOf` فایل پشتیبان روی فهرست Storeها
// حساب می‌شود؛ افزودن Store، اثر انگشت **همه‌ی فایل‌های پشتیبان قبلی** را «دستکاری‌شده»
// نشان می‌داد. فهرست آزمایشگاه چند ده ردیف است، با پشتیبان/بازگردانی همراه رکورد
// تنظیمات می‌رود و هیچ مهاجرتی نمی‌خواهد. هر تغییرش در `auditLog` ثبت می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { getSettings, SETTINGS_ID } from './settings.js';

/** نوع‌های طلایی که آزمایشگاه برایشان معنا دارد. */
export const LAB_GOLD_TYPES = ['melted', 'misc'];
export const LAB_NAME_MAX = 60;
export const LAB_NAME_ERROR = `نام آزمایشگاه حداکثر ${LAB_NAME_MAX} نویسه است.`;

export class LabValidationError extends Error {
  constructor(message, field = 'name') {
    super(message);
    this.name = 'LabValidationError';
    this.fieldErrors = { [field]: message };
  }
}

/** آیا فیلد آزمایشگاه برای این نوع طلا نمایش/ذخیره می‌شود. */
export function labApplies(goldType) {
  return LAB_GOLD_TYPES.includes(goldType);
}

/**
 * نام تمیز برای ذخیره: فاصله‌های اضافه، نویسه‌های نامرئی و «ي/ك» عربی (صفحه‌کلید
 * ویندوز/اندروید) یکسان می‌شوند. بدون این، «آزمایشگاه علي» و «آزمایشگاه علی» دو
 * آزمایشگاه جدا می‌شدند.
 */
export function normalizeLabName(value) {
  return String(value ?? '')
    .replace(/[​‎‏‪-‮﻿]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

/** کلید مقایسه‌ی نام‌ها (بدون تفاوت نیم‌فاصله/فاصله و حروف بزرگ لاتین). */
export function labKey(value) {
  return normalizeLabName(value).replace(/‌/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

/** نام آزمایشگاه یک خط طلا پس از نرمال‌سازی؛ برای ساخته‌شده همیشه `null`. */
export function labNameFor(goldType, raw) {
  if (!labApplies(goldType)) return null;
  const name = normalizeLabName(raw);
  return name || null;
}

/** اعتبارسنجی نام آزمایشگاه یک خط (خالی مجاز است). */
export function labNameError(name) {
  return name && name.length > LAB_NAME_MAX ? LAB_NAME_ERROR : null;
}

function labsOf(settings) {
  return Array.isArray(settings?.labs) ? settings.labs : [];
}

function sortLabs(list) {
  return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));
}

/** فهرست آزمایشگاه‌ها (پیش‌فرض فقط فعال‌ها)، مرتب بر اساس نام. */
export async function listLabs({ includeInactive = false } = {}) {
  const list = labsOf(await getSettings());
  return sortLabs(includeInactive ? list : list.filter((l) => l.active !== false));
}

/** نام‌های پیشنهادی فیلد آزمایشگاه (فقط فعال‌ها). */
export async function labSuggestions() {
  return (await listLabs()).map((l) => l.name);
}

// ─────────────────────── نوشتن (همه در یک تراکنش با auditLog) ───────────────────────

/**
 * خواندن-تغییر-نوشتن رکورد تنظیمات **داخل** یک تراکنش باز. چون خواندن و نوشتن در
 * همان تراکنش است، هیچ فیلد دیگری از تنظیمات (که شاید هم‌زمان ذخیره شده) بازنویسی
 * نمی‌شود.
 */
function mutateLabsInTx(tx, mutate, now) {
  const store = tx.objectStore('settings');
  const audit = tx.objectStore('auditLog');
  const req = store.get(SETTINGS_ID);
  req.onsuccess = () => {
    const current = req.result || { id: SETTINGS_ID };
    const labs = labsOf(current).map((l) => ({ ...l }));
    const changes = mutate(labs);
    if (!changes.length) return;
    store.put({ ...current, id: SETTINGS_ID, labs, updatedAt: now });
    for (const c of changes) {
      audit.add({
        id: generateId(),
        entity: 'labs',
        entityId: c.after.id,
        action: c.action,
        before: c.before,
        after: c.after,
        timestamp: now,
      });
    }
  };
}

/**
 * ثبت نام‌های آزمایشگاهِ یک سند در فهرست — **داخل تراکنش همان سند** صدا زده می‌شود.
 * نام موجود دست نمی‌خورد؛ نام غیرفعال دوباره فعال می‌شود؛ نام تازه اضافه می‌شود.
 * Storeهای لازم در تراکنش: `settings` و `auditLog` (LAB_WRITE_STORES).
 */
export function registerLabsInTx(tx, names = [], now = nowIso()) {
  const clean = [];
  const seen = new Set();
  for (const raw of names) {
    const name = normalizeLabName(raw);
    if (!name || seen.has(labKey(name))) continue;
    seen.add(labKey(name));
    clean.push(name);
  }
  if (!clean.length) return;
  mutateLabsInTx(
    tx,
    (labs) => {
      const changes = [];
      for (const name of clean) {
        const existing = labs.find((l) => labKey(l.name) === labKey(name));
        if (existing) {
          if (existing.active === false) {
            const before = { ...existing };
            existing.active = true;
            existing.updatedAt = now;
            changes.push({ action: 'update', before, after: { ...existing } });
          }
          continue;
        }
        const lab = { id: generateId(), name, active: true, createdAt: now, updatedAt: now };
        labs.push(lab);
        changes.push({ action: 'create', before: null, after: { ...lab } });
      }
      return changes;
    },
    now
  );
}

export const LAB_WRITE_STORES = ['settings', 'auditLog'];

/** نام‌های آزمایشگاهِ مجموعه‌ای از خطوط/اقلام (برای ثبت در فهرست). */
export function labNamesOf(...lists) {
  const out = [];
  for (const list of lists) for (const item of list || []) if (item?.labName) out.push(item.labName);
  return out;
}

function validateName(raw) {
  const name = normalizeLabName(raw);
  if (!name) throw new LabValidationError('نام آزمایشگاه را وارد کنید.');
  if (name.length > LAB_NAME_MAX) throw new LabValidationError(LAB_NAME_ERROR);
  return name;
}

/** افزودن دستی از صفحه‌ی مدیریت فهرست. نام تکراری خطاست (اینجا کاربر صریحاً «افزودن» زده). */
export async function addLab(rawName) {
  const name = validateName(rawName);
  const existing = labsOf(await getSettings()).find((l) => labKey(l.name) === labKey(name));
  if (existing) {
    throw new LabValidationError(
      existing.active === false
        ? 'این آزمایشگاه در فهرست هست ولی غیرفعال است؛ آن را فعال کنید.'
        : 'این آزمایشگاه قبلاً در فهرست هست.'
    );
  }
  const now = nowIso();
  let created = null;
  await runTransaction(LAB_WRITE_STORES, 'readwrite', (tx) => {
    mutateLabsInTx(
      tx,
      (labs) => {
        if (labs.some((l) => labKey(l.name) === labKey(name))) return [];
        created = { id: generateId(), name, active: true, createdAt: now, updatedAt: now };
        labs.push(created);
        return [{ action: 'create', before: null, after: { ...created } }];
      },
      now
    );
  });
  return created;
}

async function updateLab(id, patchFn) {
  const labs = labsOf(await getSettings());
  const lab = labs.find((l) => l.id === id);
  if (!lab) throw new LabValidationError('آزمایشگاه یافت نشد.');
  const now = nowIso();
  let updated = null;
  await runTransaction(LAB_WRITE_STORES, 'readwrite', (tx) => {
    mutateLabsInTx(
      tx,
      (list) => {
        const target = list.find((l) => l.id === id);
        if (!target) return [];
        const before = { ...target };
        patchFn(target, list);
        if (JSON.stringify(before) === JSON.stringify(target)) return [];
        target.updatedAt = now;
        updated = { ...target };
        return [{ action: 'update', before, after: updated }];
      },
      now
    );
  });
  return updated || lab;
}

/** ویرایش نام — اسناد قبلی Snapshot خودشان را نگه می‌دارند. */
export async function renameLab(id, rawName) {
  const name = validateName(rawName);
  const labs = labsOf(await getSettings());
  if (labs.some((l) => l.id !== id && labKey(l.name) === labKey(name))) {
    throw new LabValidationError('آزمایشگاه دیگری با همین نام در فهرست هست.');
  }
  return updateLab(id, (target) => {
    target.name = name;
  });
}

/** غیرفعال/فعال‌سازی (به‌جای حذف). */
export async function setLabActive(id, active) {
  return updateLab(id, (target) => {
    target.active = Boolean(active);
  });
}
