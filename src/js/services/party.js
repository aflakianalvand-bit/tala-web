// party.js — سرویس عمومی «طرف حساب» (Party): پایه‌ی مشترک مشتری و تأمین‌کننده
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل وجود دارد (تصمیم معماری Phase 5):
// مشتری (Phase 4) و تأمین‌کننده (Phase 5) از نظر ساختار داده و رفتار تقریباً یکسان‌اند:
// همان فیلدها، همان کد خودکار، همان Soft Delete، همان Audit، و مهم‌تر از همه
// همان اصل «مانده فقط از Ledger مشتق می‌شود». تنها تفاوت‌های واقعی:
//   ۱) نام Store و پیشوند کد،
//   ۲) سند تجاری مرتبط (sales برای مشتری، purchases برای تأمین‌کننده)،
//   ۳) سند تسویه (receipts برای مشتری، payments برای تأمین‌کننده)،
//   ۴) جهت علامت مانده — که از قبل در services/ledger.js متمرکز شده است.
// کپی‌کردن ۳۰۰ خط منطق مالی برای تأمین‌کننده یعنی دو نسخه از قوانین بحرانی که
// می‌توانند در آینده از هم واگرا شوند. بنابراین منطق یک‌بار اینجا نوشته شده و
// customers.js / suppliers.js فقط پیکربندی نازک روی آن هستند.
// (ARCHITECTURE.md §4 — «از تکرار منطق جلوگیری کن»)
// ═══════════════════════════════════════════════════════════════════════════
//
// این فایل هرگز هیچ عدد مالی‌ای ذخیره نمی‌کند. هیچ فیلد مانده/بدهی/طلب روی رکورد
// طرف حساب نوشته نمی‌شود؛ تمام اعداد در لحظه از services/ledger.js می‌آیند.

import { GRAM_EPS as GRAM_EPS_750 } from './units.js';
import { getAll, get, getByIndex } from '../db/repo.js';
import { listDueItems } from './dueDates.js';
import { runTransaction } from '../db/db.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import {
  moneyBalanceOf,
  gramsBalanceOf,
  gramsBalanceMap,
  gramsStatement,
  goldBalanceOf,
  moneyBalanceMap,
  goldBalanceMap,
  moneyStatement,
  goldStatement,
} from './ledger.js';
// (Phase 11) مانده‌ی هر فاکتور دیگر از فیلد `remainingIRR` سند خوانده نمی‌شود؛ آن فیلد
// Snapshot لحظه‌ی ثبت است و تسویه‌های بعدی را نمی‌بیند. منبع حقیقت partyInvoices است.
import {
  partyInvoices,
  unallocatedOf,
  partySettlementDocs,
  settlementDirectionOf,
  isReverseSettlement,
} from './allocations.js';

// ─────────────────────────── نرمال‌سازی و اعتبارسنجی ───────────────────────────

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی را به لاتین تبدیل و کاراکترهای جداکننده را حذف می‌کند. */
export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[\s\-()]/g, '');
  if (s.startsWith('+98')) s = `0${s.slice(3)}`;
  else if (s.startsWith('0098')) s = `0${s.slice(4)}`;
  return s;
}

/** الگوی موبایل ایران. موبایل اختیاری است؛ ولی اگر وارد شود باید معتبر باشد. */
const MOBILE_RE = /^09\d{9}$/;

/** خطای اعتبارسنجی با نگاشت field → پیام، برای نمایش دقیق کنار هر فیلد فرم (UI_GUIDELINES §3). */
export class PartyValidationError extends Error {
  constructor(fieldErrors, label = 'طرف حساب') {
    super(`اطلاعات ${label} نامعتبر است.`);
    this.name = 'PartyValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/** خطای مسدودسازی حذف: طرف حسابی که هنوز اثر مالی باز دارد حذف نمی‌شود. */
export class PartyDeleteBlockedError extends Error {
  constructor(reasons) {
    super(reasons.join(' '));
    this.name = 'PartyDeleteBlockedError';
    this.reasons = reasons;
  }
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

/**
 * سرویس یک نوع طرف حساب را می‌سازد.
 *
 * @param {object} config
 * @param {string} config.store        نام Object Store ('customers' | 'suppliers')
 * @param {string} config.kind         نوع طرف در Ledger ('customer' | 'supplier')
 * @param {string} config.codePrefix   پیشوند کد خودکار ('CU' | 'SU')
 * @param {string} config.docStore     Store سند تجاری ('sales' | 'purchases')
 * @param {string} config.docIndex     نام Index ارجاع به طرف ('customerId' | 'supplierId')
 * @param {string} config.payStore     Store سند تسویه ('receipts' | 'payments')
 * @param {string} config.label        برچسب فارسی برای پیام‌های خطا ('مشتری' | 'تأمین‌کننده')
 */
export function createPartyService(config) {
  const { store, kind, codePrefix, docStore, docIndex, payStore, label } = config;

  // ───────────────────────────── اعتبارسنجی ─────────────────────────────

  function validate(input) {
    const errors = {};

    if (!input.name) {
      errors.name = `نام ${label} الزامی است.`;
    } else if (input.name.length > 100) {
      errors.name = `نام ${label} نباید بیش از ۱۰۰ نویسه باشد.`;
    }

    if (input.phone && !MOBILE_RE.test(input.phone)) {
      errors.phone = 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۱۲۳۴۵۶۷).';
    }

    if (input.notes && input.notes.length > 500) {
      errors.notes = 'توضیحات نباید بیش از ۵۰۰ نویسه باشد.';
    }

    if (typeof input.active !== 'boolean') {
      errors.active = `وضعیت ${label} نامعتبر است.`;
    }

    if (Object.keys(errors).length > 0) throw new PartyValidationError(errors, label);
  }

  function normalizeInput(input) {
    return {
      name: String(input.name ?? '').trim().replace(/\s+/g, ' '),
      phone: normalizePhone(input.phone),
      notes: String(input.notes ?? '').trim(),
      active: input.active === undefined ? true : !!input.active,
    };
  }

  // ────────────────────────────── کد خودکار ──────────────────────────────

  /**
   * کد خودکار بعدی: `PREFIX-NNNN`.
   * تمام رکوردها **شامل حذف‌شده‌های نرم** اسکن می‌شوند تا کدی هرگز دوباره استفاده نشود
   * (همان الگوریتم کالا — DATABASE_SCHEMA §3.1.1 / §3.2.1).
   */
  async function nextCode() {
    const all = await getAll(store);
    const re = new RegExp(`^${codePrefix}-(\\d+)$`);
    let max = 0;
    for (const p of all) {
      const m = re.exec(p.code || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${codePrefix}-${pad4(max + 1)}`;
  }

  // ─────────────────────── نوشتن اتمیک همراه Audit ───────────────────────

  /** نوشتن روی Store اصلی + رکورد auditLog در **همان** IndexedDB Transaction. */
  function writeWithAudit({ action, entityId, before, after }) {
    return runTransaction([store, 'auditLog'], 'readwrite', (tx) => {
      const objectStore = tx.objectStore(store);
      if (before === null) objectStore.add(after);
      else objectStore.put(after);

      tx.objectStore('auditLog').add({
        id: generateId(),
        entity: store,
        entityId,
        action,
        before,
        after,
        timestamp: nowIso(),
      });
    });
  }

  // ─────────────────────────────── CRUD ───────────────────────────────

  async function getOne(id) {
    return get(store, id);
  }

  async function create(input) {
    const normalized = normalizeInput(input);
    validate(normalized);

    const code = await nextCode();
    const now = nowIso();
    const record = {
      id: generateId(),
      code,
      ...normalized,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await writeWithAudit({ action: 'create', entityId: record.id, before: null, after: record });
    return record;
  }

  async function update(id, input) {
    const existing = await get(store, id);
    if (!existing) throw new Error(`${label} مورد نظر یافت نشد.`);

    const normalized = normalizeInput(input);
    validate(normalized);

    const updated = {
      ...existing,
      ...normalized,
      id: existing.id,
      code: existing.code, // کد پس از ایجاد هرگز تغییر نمی‌کند
      createdAt: existing.createdAt,
      deletedAt: existing.deletedAt,
      updatedAt: nowIso(),
    };

    await writeWithAudit({ action: 'update', entityId: id, before: existing, after: updated });
    return updated;
  }

  /** اسناد تجاری معتبر (نه باطل‌شده، نه حذف‌شده) یک طرف حساب. */
  function validDocs(docs) {
    return docs.filter((d) => d.status !== 'voided' && !d.deletedAt);
  }

  /**
   * بررسی می‌کند حذف نرم مجاز است یا نه.
   * قانون: طرف حسابی که هنوز مانده ریالی/طلایی غیرصفر یا سند باز دارد حذف نمی‌شود،
   * چون اسناد مالی به او ارجاع دارند و حذف باعث گم‌شدن ردپای بدهی می‌شود.
   *
   * (Phase 28 — یافته‌ی ممیزی MEDIUM) از Phase 19 مانده‌ی **رسمی** گرم ۷۵۰ است، ولی این محافظ فقط ریال و
   * طلای فیزیکی را می‌سنجید؛ شخصی که فقط سند بی‌فی (مانده‌ی گرمی بدون ریال) داشت بدون `force` حذف می‌شد.
   */
  async function checkDeletable(id) {
    const [money, grams, gold, docs] = await Promise.all([
      moneyBalanceOf(kind, id),
      gramsBalanceOf(kind, id),
      goldBalanceOf(kind, id),
      getByIndex(docStore, docIndex, id),
    ]);

    const reasons = [];
    if (Math.abs(grams.grams) >= GRAM_EPS_750) reasons.push(`مانده حساب این ${label} (گرم ۷۵۰) صفر نیست.`);
    if (Math.abs(money.balance) >= 0.5) reasons.push(`مانده حساب ریالی این ${label} صفر نیست.`);
    if (Math.abs(gold.grams) >= 0.001) reasons.push(`مانده طلای این ${label} صفر نیست.`);
    const open = docs.filter((d) => d.status === 'open' && !d.deletedAt);
    if (open.length) reasons.push(`این ${label} ${open.length} فاکتور باز دارد.`);

    return { deletable: reasons.length === 0, reasons };
  }

  /** Soft Delete — حذف فیزیکی هرگز انجام نمی‌شود (Audit Trail و یکپارچگی اسناد گذشته). */
  async function softDelete(id, { force = false } = {}) {
    const existing = await get(store, id);
    if (!existing) throw new Error(`${label} مورد نظر یافت نشد.`);
    if (existing.deletedAt) return existing; // Idempotent

    if (!force) {
      const guard = await checkDeletable(id);
      if (!guard.deletable) throw new PartyDeleteBlockedError(guard.reasons);
    }

    const updated = { ...existing, active: false, deletedAt: nowIso(), updatedAt: nowIso() };
    await writeWithAudit({ action: 'void', entityId: id, before: existing, after: updated });
    return updated;
  }

  async function restore(id) {
    const existing = await get(store, id);
    if (!existing) throw new Error(`${label} مورد نظر یافت نشد.`);
    if (!existing.deletedAt) return existing; // Idempotent

    const updated = { ...existing, active: true, deletedAt: null, updatedAt: nowIso() };
    await writeWithAudit({ action: 'update', entityId: id, before: existing, after: updated });
    return updated;
  }

  /** تاریخچه کامل تغییرات (جدیدترین اول) از auditLog. */
  async function getHistory(id) {
    const entries = await getByIndex('auditLog', 'entityId', id);
    return entries
      .filter((e) => e.entity === store)
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  /** رکوردهای دارای همین موبایل (برای هشدار تکراری بودن — مسدودکننده نیست). */
  async function findByPhone(phone, { excludeId = null } = {}) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    const matches = await getByIndex(store, 'phone', normalized);
    return matches.filter((p) => !p.deletedAt && p.id !== excludeId);
  }

  // ────────────────────────── فهرست + شاخص‌ها ──────────────────────────

  /**
   * فهرست با جستجو/فیلتر + شاخص‌های **مشتق**:
   *   balance و goldGrams (از Ledger)، purchaseCount / lastPurchaseAt / openInvoiceCount (از اسناد).
   * هیچ‌کدام روی رکورد ذخیره نشده‌اند.
   *
   * status: 'active' (پیش‌فرض) | 'inactive' | 'deleted' | 'positive' | 'negative' | 'all'
   *   'positive' = مانده > ۰ ، 'negative' = مانده < ۰ (تفسیر فارسی هر کدام به نوع طرف بستگی
   *   دارد و در لایه‌ی UI انجام می‌شود — رجوع به pages/party/partyLabels.js).
   *   نام‌های قدیمی 'debtor'/'creditor' (Phase 4) به‌عنوان معادل پذیرفته می‌شوند.
   */
  async function list({ search = '', status = 'active' } = {}) {
    const normalizedStatus =
      status === 'debtor' ? 'positive' : status === 'creditor' ? 'negative' : status;

    const [all, balances, gramBalances, goldBalances, allDocs] = await Promise.all([
      getAll(store),
      moneyBalanceMap(kind),
      gramsBalanceMap(kind),
      goldBalanceMap(kind),
      getAll(docStore),
    ]);

    // گروه‌بندی یک‌باره‌ی اسناد بر اساس طرف حساب (به‌جای یک کوئری به ازای هر رکورد).
    const docsByParty = new Map();
    for (const d of validDocs(allDocs)) {
      const partyId = d[docIndex];
      const bucket = docsByParty.get(partyId) || [];
      bucket.push(d);
      docsByParty.set(partyId, bucket);
    }

    const term = search.trim().toLowerCase();
    const termPhone = normalizePhone(search);

    const rows = all.map((p) => {
      const docs = docsByParty.get(p.id) || [];
      const dates = docs.map((d) => d.date).filter(Boolean).sort();
      return {
        ...p,
        balance: balances.get(p.id) || 0,
        /** (Phase 19) مانده‌ی رسمی: گرم ۷۵۰. */
        balanceGrams: gramBalances.get(p.id) || 0,
        goldGrams: goldBalances.get(p.id) || 0,
        purchaseCount: docs.length,
        lastPurchaseAt: dates.length ? dates[dates.length - 1] : null,
        openInvoiceCount: docs.filter((d) => d.status === 'open').length,
      };
    });

    return rows
      .filter((p) => {
        if (normalizedStatus === 'active' && (p.deletedAt || !p.active)) return false;
        if (normalizedStatus === 'inactive' && (p.deletedAt || p.active)) return false;
        if (normalizedStatus === 'deleted' && !p.deletedAt) return false;
        if (normalizedStatus === 'positive' && (p.deletedAt || p.balanceGrams <= 0)) return false;
        if (normalizedStatus === 'negative' && (p.deletedAt || p.balanceGrams >= 0)) return false;

        if (term) {
          const haystack = `${p.code} ${p.name}`.toLowerCase();
          const phoneHit = termPhone.length >= 3 && (p.phone || '').includes(termPhone);
          if (!haystack.includes(term) && !phoneHit) return false;
        }
        return true;
      })
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  // ───────────────────────── جزئیات (تب‌های صفحه) ─────────────────────────

  /**
   * تمام داده‌های صفحه جزئیات، در یک بار خواندن.
   * تب‌های سند/تسویه/سررسید مستقیماً از Storeهای واقعی خوانده می‌شوند؛ تا قبل از
   * Phase 6/7/11/12 که این اسناد ساخته شوند خالی‌اند و پس از آن خودکار پر می‌شوند.
   */
  async function getSummary(id) {
    const party = await get(store, id);
    if (!party) throw new Error(`${label} مورد نظر یافت نشد.`);

    const [money, grams, gold, statement, gramsStmt, goldStmt, docs, pays, dueDates] = await Promise.all([
      moneyBalanceOf(kind, id),
      // (Phase 19) واحد رسمی مانده‌ی طرف حساب: گرم ۷۵۰.
      gramsBalanceOf(kind, id),
      goldBalanceOf(kind, id),
      moneyStatement(kind, id),
      gramsStatement(kind, id),
      goldStatement(kind, id),
      getByIndex(docStore, docIndex, id),
      // Phase 22: اسناد تسویه از هر دو Store (جهت معکوس در Store مقابل است).
      partySettlementDocs(kind, id).then((rows) => rows.map((r) => r.doc)),
      getByIndex('dueDates', 'party', [kind, id]),
    ]);

    // (Phase 11) مانده‌ی مشتق‌شده‌ی هر فاکتور + مبلغ علی‌الحساب طرف حساب.
    const [invoiceRows, unallocated, dueItems] = await Promise.all([
      partyInvoices(kind, id),
      unallocatedOf(kind, id),
      // (Phase 12) سررسیدها با مانده و وضعیت زمانیِ مشتق‌شده (آینده/نزدیک/امروز/گذشته/تسویه‌شده).
      listDueItems({ partyType: kind, partyId: id, includeSettled: true, includeVoided: true }),
    ]);
    const outstandingById = new Map(invoiceRows.map((r) => [r.targetId, r]));

    const documents = validDocs(docs)
      .map((d) => {
        const row = outstandingById.get(d.id);
        return {
          ...d,
          /** مانده‌ی امروزِ فاکتور — مشتق‌شده، نه فیلد ذخیره‌شده‌ی `remainingIRR`. */
          outstandingIRR: row ? row.outstandingIRR : 0,
          allocatedIRR: row ? row.allocatedIRR : 0,
          /** مانده‌ی امروزِ فاکتور به واحد رسمی (گرم ۷۵۰). */
          outstandingGrams: row ? row.outstandingGrams : 0,
          allocatedGrams: row ? row.allocatedGrams : 0,
          totalGrams: row ? row.totalGrams : Number(d.grandTotalGrams) || 0,
          derivedStatus: row ? row.derivedStatus : d.status,
        };
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const allocatedByDoc = new Map();
    const allocatedGramsByDoc = new Map();
    for (const row of invoiceRows) {
      for (const a of row.allocations) {
        allocatedByDoc.set(a.docId, (allocatedByDoc.get(a.docId) || 0) + Number(a.amountIRR || 0));
        allocatedGramsByDoc.set(a.docId, (allocatedGramsByDoc.get(a.docId) || 0) + Number(a.amountGrams || 0));
      }
    }

    const payments = pays
      .filter((p) => p.status !== 'voided')
      .map((p) => ({
        ...p,
        direction: settlementDirectionOf(p),
        reverse: isReverseSettlement(p),
        allocatedIRR: allocatedByDoc.get(p.id) || 0,
        unallocatedIRR: Number(p.valueIRR || 0) - (allocatedByDoc.get(p.id) || 0),
        allocatedGrams: allocatedGramsByDoc.get(p.id) || 0,
        unallocatedGrams: Number(p.valueGrams || 0) - (allocatedGramsByDoc.get(p.id) || 0),
      }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    const openDocuments = documents.filter((d) => d.outstandingGrams > GRAM_EPS_750);

    return {
      party,
      balance: money.balance,
      balanceParts: { debit: money.debit, credit: money.credit },
      /** (Phase 19) مانده‌ی رسمی به گرم ۷۵۰ — عدد اصلی صفحه‌ی طرف حساب. */
      balanceGrams: grams.grams,
      balanceGramsParts: { debit: grams.debit, credit: grams.credit },
      goldGrams: gold.grams,
      statement: statement.rows,
      gramsStatement: gramsStmt.rows,
      goldStatement: goldStmt.rows,
      documents,
      payments,
      openDocuments,
      /** مجموع مانده اسناد باز — فقط نمایشی؛ منبع حقیقتِ بدهی همچنان Ledger است. */
      openDocumentsTotal: openDocuments.reduce((sum, d) => sum + (Number(d.outstandingIRR) || 0), 0),
      openDocumentsTotalGrams: openDocuments.reduce((sum, d) => sum + (Number(d.outstandingGrams) || 0), 0),
      /** (Phase 11) مبلغ تسویه‌شده‌ای که هنوز بابت فاکتور مشخصی حساب نشده است. */
      unallocatedIRR: unallocated.totalIRR,
      unallocatedGrams: unallocated.totalGrams,
      unallocatedDocs: unallocated.docs,
      invoiceRows,
      dueDates: dueDates
        .filter((d) => d.status !== 'paid')
        .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))),
      allDueDates: dueDates
        .slice()
        .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))),
      dueItems,
      purchaseCount: documents.length,
      lastPurchaseAt: documents.length ? documents[0].date : null,
    };
  }

  return {
    config,
    nextCode,
    getOne,
    create,
    update,
    softDelete,
    restore,
    checkDeletable,
    getHistory,
    findByPhone,
    list,
    getSummary,
  };
}
