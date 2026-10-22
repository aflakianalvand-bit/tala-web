// dueDates.js — موتور سررسید و هشدار (Phase 12)
//
// ═══════════════════════════════════════════════════════════════════════════
// مسئله‌ای که این فایل حل می‌کند:
//
//   «هر سررسید یکی از این وضعیت‌ها را دارد: آینده، نزدیک، امروز، سررسید گذشته،
//    تسویه‌شده — و سه هشدار: N روز مانده، روز سررسید، سررسید گذشته.»
//
// ─── چرا هیچ‌کدام از این وضعیت‌ها ذخیره نمی‌شود (مهم‌ترین نکته‌ی این فایل) ───
// «آینده/نزدیک/امروز/گذشته» تابعی از **تاریخ امروز** است. اگر آن را روی رکورد
// می‌نوشتیم، رکوردی که دیروز «نزدیک» بود امروز بی‌سروصدا غلط می‌شد و برای درست
// ماندنش یک کار زمان‌بندی‌شده لازم بود که روی iPhone (PWA آفلاین) تضمینی ندارد.
// پس وضعیت زمانی همیشه **در لحظه‌ی خواندن** از سه ورودی ساخته می‌شود:
//
//   ۱. تاریخ سررسید (dueDates.dueDate)
//   ۲. مانده‌ی امروزِ فاکتور — از invoiceOutstanding() (Phase 11)، نه dueDates.amountIRR
//   ۳. تاریخ امروز و تنظیم «چند روز قبل هشدار بده» (settings.dueDateAlertDaysAhead)
//
// «تسویه‌شده» هم از مانده‌ی مشتق‌شده می‌آید، نه از فیلد status: فیلد status یک
// نمای ذخیره‌شده برای Index است (ACCOUNTING_RULES §8.7) و تست‌ها هم‌خوانی آن را
// تضمین می‌کنند، ولی تصمیم نهایی این فایل همیشه با مانده‌ی بازمحاسبه‌شده است.
//
// ─── مقایسه‌ی «روز»، نه «لحظه» ───
// سررسید با ساعت ۱۲:۰۰ محلی ذخیره می‌شود (utils/date.js → fromDateInputValue).
// اگر اختلاف را با میلی‌ثانیه می‌شمردیم، ساعت ۱۳:۰۰ روز سررسید «گذشته» حساب می‌شد.
// بنابراین هر دو تاریخ به «شماره‌ی روز تقویمی محلی» تبدیل می‌شوند و فقط آن مقایسه
// می‌شود — مستقل از ساعت و از تغییر ساعت تابستانی.
//
// ─── یک بدهی هرگز بی‌صدا پنهان نمی‌شود ───
// تاریخ سررسید نامعتبر (داده‌ی خراب/قدیمی) به‌جای «امروز» یا حذف از فهرست،
// «سررسید گذشته» با علامت invalidDate طبقه‌بندی می‌شود تا کاربر آن را ببیند.
// ═══════════════════════════════════════════════════════════════════════════

import { get, getAll, getByIndex } from '../db/repo.js';
import { invoiceOutstanding, invoiceOutstandingGrams, roundIRR, roundGrams } from './allocations.js';
// (Phase 19) واحد رسمی سررسید: گرم ۷۵۰.
import { GRAM_EPS as BASE_GRAM_EPS } from './goldTotals.js';
import { IRR_EPS } from './accounts.js';

/** وضعیت‌های زمانیِ مشتق‌شده (هیچ‌کدام در دیتابیس نوشته نمی‌شود). */
export const DUE_STATES = ['overdue', 'today', 'near', 'future', 'settled', 'voided'];

/** وضعیت‌هایی که هشدار می‌سازند (به ترتیب فوریت). */
export const ALERT_STATES = ['overdue', 'today', 'near'];

/** پیش‌فرض «چند روز قبل از سررسید هشدار بده» — مطابق دستور Phase 12. */
export const DEFAULT_ALERT_DAYS = 3;
/** سقف منطقی تنظیم؛ عدد بزرگ‌تر عملاً همه‌ی سررسیدها را «نزدیک» می‌کند. */
export const MAX_ALERT_DAYS = 90;

const STATE_ORDER = Object.fromEntries(DUE_STATES.map((s, i) => [s, i]));

/** جهت سررسید: فروش = دریافتنی از مشتری، خرید = پرداختنی به تأمین‌کننده. */
export const SOURCE_MAP = {
  sale: { store: 'sales', direction: 'receivable', partyStore: 'customers' },
  purchase: { store: 'purchases', direction: 'payable', partyStore: 'suppliers' },
};

const DAY_MS = 86400000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─────────────────────────── تنظیمات ───────────────────────────

/**
 * مقدار «چند روز قبل هشدار بده» را امن می‌کند: عدد صحیح بین ۰ و MAX_ALERT_DAYS.
 * صفر یعنی وضعیت «نزدیک» غیرفعال است (فقط امروز و گذشته هشدار دارند).
 */
export function normalizeAlertDays(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_ALERT_DAYS;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_ALERT_DAYS;
  return Math.min(MAX_ALERT_DAYS, Math.floor(n));
}

/** تنظیم مؤثر هشدار از settings (با پیش‌فرض امن اگر کاربر هنوز تنظیمات را ذخیره نکرده). */
export async function getAlertDays() {
  const settings = await get('settings', 'main');
  return normalizeAlertDays(settings?.dueDateAlertDaysAhead);
}

// ─────────────────────────── محاسبه‌ی روز ───────────────────────────

/** Date | ISO → Date معتبر یا null (برخلاف toDate هرگز «الان» را جایگزین نمی‌کند). */
function parseDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** شماره‌ی روز تقویمی محلی (مستقل از ساعت و DST). */
export function calendarDayIndex(value) {
  const d = parseDate(value);
  if (!d) return null;
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/**
 * چند روز تا سررسید مانده است: مثبت = آینده، صفر = امروز، منفی = گذشته.
 * null اگر تاریخ سررسید نامعتبر باشد.
 */
export function daysUntil(dueDate, today = new Date()) {
  const due = calendarDayIndex(dueDate);
  const now = calendarDayIndex(today) ?? calendarDayIndex(new Date());
  if (due === null) return null;
  return due - now;
}

// ─────────────────────────── طبقه‌بندی (تابع خالص) ───────────────────────────

/**
 * طبقه‌بندی یک سررسید — **تنها** قاعده‌ی وضعیت زمانی در کل برنامه.
 *
 * @param {object}  args
 * @param {string}  args.dueDate       تاریخ سررسید (ISO)
 * @param {number}  args.remainingIRR  مانده‌ی امروزِ فاکتور (مشتق‌شده)
 * @param {boolean} [args.voided]      سند یا سررسید باطل شده است
 * @param {Date}    [args.today]
 * @param {number}  [args.nearDays]    چند روز قبل «نزدیک» شود
 * @returns {{state: string, days: number|null, alert: boolean, invalidDate: boolean}}
 */
export function classifyDue({
  dueDate,
  remainingIRR,
  remainingGrams,
  voided = false,
  today = new Date(),
  nearDays = DEFAULT_ALERT_DAYS,
}) {
  const days = daysUntil(dueDate, today);
  const invalidDate = days === null;
  const base = { days, invalidDate };

  if (voided) return { ...base, state: 'voided', alert: false };
  // (Phase 19) «تسویه‌شده» با واحد رسمی سنجیده می‌شود؛ سند رسیدیِ بدون فی اصلاً
  // مبلغ ریالی ندارد و با معیار ریالی همیشه «تسویه‌شده» دیده می‌شد.
  const settled =
    remainingGrams === undefined ? num(remainingIRR) < IRR_EPS : num(remainingGrams) < BASE_GRAM_EPS;
  if (settled) return { ...base, state: 'settled', alert: false };

  const window = normalizeAlertDays(nearDays);
  let state;
  if (invalidDate || days < 0) state = 'overdue';
  else if (days === 0) state = 'today';
  else if (days <= window) state = 'near';
  else state = 'future';

  return { ...base, state, alert: ALERT_STATES.includes(state) };
}

/** ترتیب نمایش: فوری‌ترین اول؛ در هر گروه نزدیک‌ترین تاریخ اول؛ سپس شماره‌ی سند. */
export function compareDueItems(a, b) {
  const byState = (STATE_ORDER[a.state] ?? 99) - (STATE_ORDER[b.state] ?? 99);
  if (byState !== 0) return byState;
  const da = a.days ?? -Infinity;
  const db = b.days ?? -Infinity;
  if (da !== db) return da - db;
  return String(a.docNumber || '').localeCompare(String(b.docNumber || ''));
}

// ─────────────────────────── بارگذاری از دیتابیس ───────────────────────────

/**
 * رکوردهای خام سررسید را از مناسب‌ترین Index می‌خواند.
 * برای هشدارها فقط `pending`/`partial` خوانده می‌شود (مسیر داغ داشبورد)؛ این امن است
 * چون نمای status با هر تخصیص/برگشت در همان تراکنش همگام می‌شود و تست‌ها آن را
 * تضمین می‌کنند.
 */
async function loadRawDueDates({ partyType, partyId, includeSettled, includeVoided }) {
  if (partyType && partyId) return getByIndex('dueDates', 'party', [partyType, partyId]);
  if (includeSettled || includeVoided) return getAll('dueDates');
  const [pending, partial] = await Promise.all([
    getByIndex('dueDates', 'status', 'pending'),
    getByIndex('dueDates', 'status', 'partial'),
  ]);
  return [...pending, ...partial];
}

/**
 * تمام سررسیدها، غنی‌شده با سند، طرف حساب، مانده‌ی مشتق‌شده و وضعیت زمانی.
 *
 * @param {object} [opts]
 * @param {Date}    [opts.today]
 * @param {number}  [opts.nearDays]        پیش‌فرض: از settings
 * @param {boolean} [opts.includeSettled]  سررسیدهای تسویه‌شده هم برگردند
 * @param {boolean} [opts.includeVoided]   سررسیدهای باطل‌شده هم برگردند
 * @param {string}  [opts.partyType]       'customer' | 'supplier'
 * @param {string}  [opts.partyId]
 */
export async function listDueItems(opts = {}) {
  const today = opts.today || new Date();
  const nearDays = opts.nearDays === undefined ? await getAlertDays() : normalizeAlertDays(opts.nearDays);
  const includeSettled = !!opts.includeSettled;
  const includeVoided = !!opts.includeVoided;

  const raw = await loadRawDueDates({ ...opts, includeSettled, includeVoided });
  const candidates = raw.filter((r) => SOURCE_MAP[r.sourceType] && (includeVoided || r.status !== 'voided'));

  const partyCache = new Map();
  async function partyName(store, id) {
    const key = `${store}:${id}`;
    if (!partyCache.has(key)) partyCache.set(key, get(store, id).then((p) => p?.name || '—'));
    return partyCache.get(key);
  }

  const items = await Promise.all(
    candidates.map(async (record) => {
      const map = SOURCE_MAP[record.sourceType];
      const [source, allocations, name] = await Promise.all([
        get(map.store, record.sourceId),
        getByIndex('allocations', 'targetId', record.sourceId),
        partyName(map.partyStore, record.partyId),
      ]);
      const active = allocations.filter((a) => a.status === 'active');
      const voided = record.status === 'voided' || !source || source.status === 'voided';
      const outstanding = voided ? 0 : invoiceOutstanding(source, active);
      const remainingIRR = Math.max(0, roundIRR(outstanding));
      const outstandingGrams = voided ? 0 : invoiceOutstandingGrams(source, active);
      const remainingGrams = Math.max(0, roundGrams(outstandingGrams));
      const amountIRR = num(record.amountIRR);
      const amountGrams = num(record.amountGrams);
      const cls = classifyDue({
        dueDate: record.dueDate,
        remainingIRR,
        remainingGrams,
        voided,
        today,
        nearDays,
      });

      return {
        id: record.id,
        dueDateId: record.id,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        direction: map.direction,
        docNumber: source?.number || '—',
        docDate: source?.date || null,
        partyType: record.partyType,
        partyId: record.partyId,
        partyName: name,
        dueDate: record.dueDate,
        amountIRR,
        remainingIRR,
        paidIRR: Math.max(0, roundIRR(amountIRR - remainingIRR)),
        // ── واحد رسمی: گرم ۷۵۰ ──
        amountGrams,
        remainingGrams,
        paidGrams: Math.max(0, roundGrams(amountGrams - remainingGrams)),
        storedStatus: record.status,
        nearDays,
        ...cls,
      };
    })
  );

  return items
    .filter((it) => (includeSettled || it.state !== 'settled') && (includeVoided || it.state !== 'voided'))
    .sort(compareDueItems);
}

/** جمع‌بندی گروهی: تعداد و مانده‌ی دریافتنی/پرداختنی هر وضعیت. */
export function summarizeDueItems(items) {
  const empty = () => ({ count: 0, receivableIRR: 0, payableIRR: 0, receivableGrams: 0, payableGrams: 0 });
  const byState = Object.fromEntries(DUE_STATES.map((s) => [s, empty()]));
  const total = empty();
  for (const it of items) {
    const bucket = byState[it.state] || (byState[it.state] = empty());
    for (const b of [bucket, total]) {
      b.count += 1;
      if (it.direction === 'receivable') {
        b.receivableIRR = roundIRR(b.receivableIRR + it.remainingIRR);
        b.receivableGrams = roundGrams(b.receivableGrams + it.remainingGrams);
      } else {
        b.payableIRR = roundIRR(b.payableIRR + it.remainingIRR);
        b.payableGrams = roundGrams(b.payableGrams + it.remainingGrams);
      }
    }
  }
  return { byState, total };
}

/**
 * هشدارهای داشبورد: سه گروه «سررسید گذشته»، «امروز» و «N روز مانده».
 * @returns {Promise<{nearDays:number, overdue:Array, today:Array, near:Array, count:number, summary:object}>}
 */
export async function getDueAlerts(opts = {}) {
  const items = await listDueItems({ ...opts, includeSettled: false, includeVoided: false });
  const alerts = items.filter((it) => it.alert);
  const nearDays = opts.nearDays === undefined ? (items[0]?.nearDays ?? (await getAlertDays())) : normalizeAlertDays(opts.nearDays);
  return {
    nearDays,
    overdue: alerts.filter((it) => it.state === 'overdue'),
    today: alerts.filter((it) => it.state === 'today'),
    near: alerts.filter((it) => it.state === 'near'),
    count: alerts.length,
    summary: summarizeDueItems(alerts),
  };
}

/** یک سررسید (برای صفحه‌ی جزئیات سند) با وضعیت زمانی مشتق‌شده. */
export async function getDueItem(dueDateId, opts = {}) {
  const record = await get('dueDates', dueDateId);
  if (!record) return null;
  const items = await listDueItems({
    ...opts,
    partyType: record.partyType,
    partyId: record.partyId,
    includeSettled: true,
    includeVoided: true,
  });
  return items.find((it) => it.id === dueDateId) || null;
}
