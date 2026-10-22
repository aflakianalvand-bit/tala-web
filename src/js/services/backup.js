// backup.js — موتور پشتیبان‌گیری، بازگردانی و بررسی یکپارچگی (Phase 15)
//
// ═══════════════════════════════════════════════════════════════════════════
// سه تضمین این فایل:
//
//  ۱) **Export یک عکس کامل است، نه خلاصه.** تمام Storeهای داده‌ای بدون استثنا
//     نوشته می‌شوند (شامل دفاتر، تخصیص‌ها، auditLog و backupLogs). هیچ عددی
//     بازمحاسبه نمی‌شود: فایل پشتیبان همان رکوردهای خام است، چون تمام مانده‌های
//     برنامه از همین رکوردها مشتق می‌شوند (دستور پروژه §۲۰).
//
//  ۲) **Restore اتمیک است.** پاک‌سازی و نوشتن در **یک** IndexedDB Transaction
//     انجام می‌شود: یا کل بازگردانی موفق است یا دیتابیس دقیقاً دست‌نخورده می‌ماند.
//     دیتابیس «نیمه‌بازگردانی‌شده» وجود ندارد.
//
//  ۳) **هر Restore یک راه برگشت دارد.** پیش از نوشتن، وضعیت فعلی در
//     `restorePoints` ذخیره می‌شود — تنها Storeی که نه در فایل پشتیبان می‌آید و
//     نه در Replace پاک می‌شود (دلیل در schema.js).
// ═══════════════════════════════════════════════════════════════════════════

import { STORES, DB_VERSION } from '../db/schema.js';
import { openDatabase, runTransaction, runDataMigrations } from '../db/db.js';
import { getAll } from '../db/repo.js';
import { generateId } from '../utils/id.js';
import { nowIso } from '../utils/date.js';
import { findSettings } from './settings.js';

export const BACKUP_FORMAT = 'tala-gold-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const RESTORE_MODES = ['replace', 'merge'];
export const RESTORE_MODE_LABELS = {
  replace: 'جایگزینی کامل',
  merge: 'ادغام با داده‌ی فعلی',
};

/**
 * Storeهایی که عمداً بیرون از دامنه‌ی Backup/Restore‌اند:
 *   - `restorePoints`: تور ایمنی خودِ Restore و مهاجرت (Phase 15/22)
 *   - `deviceInfo`: هویت همین نصب؛ اگر در فایل بود، بازگردانی روی گوشی دیگر هویت گوشی
 *     اول را کپی می‌کرد و دو دستگاه یک `deviceId` می‌گرفتند (Phase 22).
 */
const OUT_OF_SCOPE = new Set(['restorePoints', 'deviceInfo']);

/** نوع نسخه‌ی اضطراری: پیش از بازگردانی/پاک‌سازی (Phase 15) یا پیش از مهاجرت داده (Phase 22). */
export const RESTORE_POINT_KINDS = { restore: 'پیش از بازگردانی', preMigration: 'پیش از ارتقای داده' };
const isPreMigration = (p) => p?.kind === 'preMigration';

/** تمام Storeهای داده‌ای — همین‌ها هم Export می‌شوند و هم در Replace پاک می‌شوند. */
export const BACKUP_STORES = STORES.map((s) => s.name).filter((n) => !OUT_OF_SCOPE.has(n));

/**
 * Storeهایی که پس از یک Restore از نوع Replace باید **دقیقاً** با فایل یکی باشند.
 * `backupLogs` و `auditLog` بیرون‌اند چون خودِ عملِ بازگردانی یک رکورد تازه در
 * آن‌ها می‌سازد؛ برای آن دو، بررسی «زیرمجموعه بودن» انجام می‌شود نه تساوی.
 */
export const VERIFY_STORES = BACKUP_STORES.filter((n) => n !== 'backupLogs' && n !== 'auditLog');

const KEY_PATH = new Map(STORES.map((s) => [s.name, s.keyPath]));

export class BackupError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

// ─────────────────────────── اثر انگشت (Checksum) ───────────────────────────

/**
 * نمایش متعارف یک مقدار: کلیدهای شیء مرتب می‌شوند تا ترتیبِ نوشتنِ فیلدها روی
 * اثر انگشت اثر نگذارد. بدون این، همان داده پس از یک رفت‌وبرگشت JSON می‌توانست
 * اثر انگشت متفاوتی بگیرد و «فایل دستکاری شده» اعلام شود.
 */
function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

function sortedById(rows, keyPath = 'id') {
  return [...(rows || [])].sort((a, b) => String(a?.[keyPath]).localeCompare(String(b?.[keyPath])));
}

/**
 * اثر انگشت داده (FNV-1a ۳۲ بیتی روی نمایش متعارف).
 * هدف تشخیص **خرابی/دستکاری تصادفی** است، نه امنیت رمزنگاری؛ برای همین یک تابع
 * کوتاه و بدون وابستگی انتخاب شد نه SHA-256 (که در Safari فقط async در دسترس است
 * و کل مسیر Export را غیرهمزمان می‌کرد).
 */
export function checksumOf(data, stores = VERIFY_STORES) {
  const normalized = {};
  for (const name of [...stores].sort()) {
    normalized[name] = sortedById(data?.[name], KEY_PATH.get(name) || 'id');
  }
  const text = canonical(normalized);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function countsOf(data, stores = BACKUP_STORES) {
  const counts = {};
  let total = 0;
  for (const name of stores) {
    const n = Array.isArray(data?.[name]) ? data[name].length : 0;
    counts[name] = n;
    total += n;
  }
  return { counts, total };
}

// ─────────────────────────────── Export ───────────────────────────────

/** خواندن کامل داده‌ی همه‌ی Storeها (طبق قرارداد پروژه: خواندن‌ها پیش از تراکنش نوشتن). */
export async function readAllData(stores = BACKUP_STORES) {
  await openDatabase();
  const data = {};
  for (const name of stores) data[name] = await getAll(name);
  return data;
}

/** `GoldShop_Backup_YYYY-MM-DD_HH-mm.json` — طبق فرمت خواسته‌شده در Phase 15. */
export function backupFileName(at = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `GoldShop_Backup_${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}_${pad(at.getHours())}-${pad(at.getMinutes())}.json`;
}

async function writeBackupLog(entry) {
  const record = { id: generateId(), timestamp: nowIso(), ...entry };
  await runTransaction(['backupLogs'], 'readwrite', (tx) => {
    tx.objectStore('backupLogs').add(record);
  });
  return record;
}

/**
 * ساخت فایل پشتیبان کامل.
 *
 * نکته‌ی ترتیب: رکورد `backupLogs` **پس از** ساخته شدن payload نوشته می‌شود، پس
 * لاگِ خودِ این Export داخل فایل نیست. اگر برعکس بود، هر Export یک رکورد بیشتر از
 * Export قبلی داشت و «آخرین پشتیبان» با محتوای فایل نمی‌خواند.
 */
export async function createBackup({ note = '' } = {}) {
  const at = new Date();
  const data = await readAllData();
  const { counts, total } = countsOf(data);

  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: DB_VERSION,
    app: 'tala-app',
    exportedAt: at.toISOString(),
    note: String(note || ''),
    stores: BACKUP_STORES,
    recordCounts: counts,
    totalRecords: total,
    checksum: checksumOf(data),
    data,
  };

  const json = JSON.stringify(payload);
  const fileName = backupFileName(at);
  const log = await writeBackupLog({
    type: 'export',
    status: 'success',
    fileName,
    totalRecords: total,
    recordCounts: counts,
    checksum: payload.checksum,
    sizeBytes: json.length,
    note: payload.note,
  });

  return { payload, json, fileName, totalRecords: total, recordCounts: counts, checksum: payload.checksum, log };
}

// ─────────────────────────── اعتبارسنجی فایل ───────────────────────────

/**
 * فایل را **پیش از هر نوشتنی** بررسی می‌کند و خلاصه‌ای می‌دهد که صفحه‌ی بازگردانی
 * برای گرفتن تأیید صریح کاربر نشان می‌دهد (ARCHITECTURE §12، مرحله ۳).
 * خطا = فایل غیرقابل استفاده. هشدار = قابل استفاده ولی کاربر باید بداند.
 */
export function validateBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new BackupError('محتوای فایل یک شیء پشتیبان معتبر نیست.', 'shape');
  }
  if (payload.format !== BACKUP_FORMAT) {
    throw new BackupError('این فایل، پشتیبان این نرم‌افزار نیست.', 'format');
  }
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new BackupError('بخش داده‌ی فایل پشتیبان یافت نشد یا خراب است.', 'data');
  }
  const formatVersion = Number(payload.formatVersion) || 0;
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      `این فایل با نسخه‌ی جدیدتری از نرم‌افزار ساخته شده (قالب ${formatVersion}). ابتدا برنامه را به‌روزرسانی کنید.`,
      'formatVersion'
    );
  }

  const warnings = [];
  const schemaVersion = Number(payload.schemaVersion) || 0;
  if (schemaVersion > DB_VERSION) {
    throw new BackupError(
      `ساختار این پشتیبان (نسخه ${schemaVersion}) جلوتر از نسخه‌ی این نرم‌افزار (${DB_VERSION}) است. بازگردانی می‌تواند داده را خراب کند.`,
      'schemaVersion'
    );
  }
  if (schemaVersion > 0 && schemaVersion < DB_VERSION) {
    warnings.push(`این پشتیبان با ساختار نسخه ${schemaVersion} ساخته شده و نسخه‌ی فعلی ${DB_VERSION} است؛ پس از بازگردانی، سازگارسازی لازم روی داده اجرا می‌شود.`);
  }

  const known = new Set(BACKUP_STORES);
  const unknown = Object.keys(payload.data).filter((n) => !known.has(n));
  if (unknown.length) {
    warnings.push(`این بخش‌ها در نسخه‌ی فعلی وجود ندارند و نادیده گرفته می‌شوند: ${unknown.join('، ')}`);
  }
  const missing = BACKUP_STORES.filter((n) => !Array.isArray(payload.data[n]));
  if (missing.length) {
    warnings.push(`این بخش‌ها در فایل نیستند و پس از جایگزینی خالی خواهند شد: ${missing.join('، ')}`);
  }

  const { counts, total } = countsOf(payload.data);
  const checksum = checksumOf(payload.data);
  const checksumOk = !payload.checksum || payload.checksum === checksum;
  if (!checksumOk) {
    warnings.push('اثر انگشت فایل با محتوای آن نمی‌خواند — احتمالاً فایل پس از ساخته شدن ویرایش شده است.');
  }

  return {
    payload,
    summary: {
      exportedAt: payload.exportedAt || null,
      note: payload.note || '',
      schemaVersion,
      formatVersion,
      recordCounts: counts,
      totalRecords: total,
      checksum,
      declaredChecksum: payload.checksum || null,
      checksumOk,
    },
    warnings,
  };
}

export function parseBackup(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new BackupError('فایل انتخابی یک JSON معتبر نیست.', 'parse');
  }
  return validateBackup(payload);
}

// ─────────────────────────────── Restore ───────────────────────────────

/**
 * بازگردانی از فایل پشتیبان.
 *
 * `replace`: تمام Storeهای داده‌ای پاک و با محتوای فایل جایگزین می‌شوند —
 *            دیتابیس دقیقاً به وضعیت لحظه‌ی Backup برمی‌گردد (تصمیم Phase 15).
 * `merge`:   فقط رکوردهایی که کلیدشان در دیتابیس نیست اضافه می‌شوند؛
 *            **رکورد موجود هرگز بازنویسی نمی‌شود** (تصمیم Phase 15). پس Merge
 *            هیچ‌وقت داده‌ی امروز را با داده‌ی دیروز خراب نمی‌کند.
 *
 * هر دو حالت در یک تراکنش واحد اجرا می‌شوند.
 */
export async function restoreBackup(input, { mode = 'replace', createRestorePoint = true } = {}) {
  if (!RESTORE_MODES.includes(mode)) {
    throw new BackupError(`حالت بازگردانی نامعتبر است: ${mode}`, 'mode');
  }
  const validated = typeof input === 'string' ? parseBackup(input) : validateBackup(input);
  const { payload, summary, warnings } = validated;

  await openDatabase();
  // خواندن‌ها پیش از تراکنش نوشتن — قرارداد ثابت سرویس‌های این پروژه.
  const current = await readAllData();
  const existingPoints = await getAll('restorePoints');

  const timestamp = nowIso();
  const stats = {};
  const conflicts = [];
  let addedTotal = 0;
  let skippedTotal = 0;

  // پس از بازگردانیِ پشتیبانی که پیش از v7 ساخته شده، Store `allocations` خالی
  // می‌ماند و هر فاکتور تسویه‌شده «باز» به نظر می‌رسد. ارتقای onupgradeneeded
  // دیگر اجرا نمی‌شود (نسخه‌ی دیتابیس عوض نشده)، پس همان Backfill اینجا و در
  // همان تراکنش تکرار می‌شود — دقیقاً همان کدی که Migration v6→v7 اجرا می‌کند.
  const needsAllocationBackfill = summary.schemaVersion > 0 && summary.schemaVersion < 7;

  // (Phase 19) همان درس، برای واحد جدید: پشتیبانی که پیش از v9 ساخته شده هیچ
  // مقدار گرمی ندارد، و چون نسخه‌ی دیتابیس عوض نمی‌شود onupgradeneeded اجرا
  // نمی‌شود. بدون این تکرار، بازگردانی یک فایل قدیمی تمام بدهی‌ها و طلب‌های
  // کاربر را صفر گرم نشان می‌داد.
  const needsGoldUnitBackfill = summary.schemaVersion > 0 && summary.schemaVersion < 9;
  // (Phase 22) و برای عیار هزاری: پشتیبانِ پیش از v10 عیار ۲۴تایی و سطل‌های قدیمی دارد.
  const needsUnitsMigration = summary.schemaVersion > 0 && summary.schemaVersion < 10;

  const writeStores = [...BACKUP_STORES, 'restorePoints'];

  await runTransaction(writeStores, 'readwrite', (tx) => {
    // (Phase 22) رکوردهای بازگردانی‌شده منشأ اصلی خود را نگه می‌دارند؛ مُهر دستگاه
    // فعلی فقط روی رکوردهای واقعاً تازه می‌خورد، نه روی داده‌ی بازگردانی‌شده.
    if (createRestorePoint) {
      // فقط یک نسخه‌ی اضطراری «پیش از بازگردانی» نگه داشته می‌شود (تصمیم Phase 15)؛
      // نسخه‌ی «پیش از مهاجرت» (Phase 22) جداست و دست نمی‌خورد.
      for (const point of existingPoints) if (!isPreMigration(point)) tx.objectStore('restorePoints').delete(point.id);
      const { counts, total } = countsOf(current);
      tx.objectStore('restorePoints').add({
        id: generateId(),
        kind: 'restore',
        createdAt: timestamp,
        reason: `پیش از بازگردانی — ${RESTORE_MODE_LABELS[mode]}`,
        schemaVersion: DB_VERSION,
        recordCounts: counts,
        totalRecords: total,
        data: current,
      });
    }

    for (const name of BACKUP_STORES) {
      const store = tx.objectStore(name);
      const keyPath = KEY_PATH.get(name) || 'id';
      const rows = Array.isArray(payload.data[name]) ? payload.data[name] : [];
      const stat = { cleared: mode === 'replace', added: 0, skipped: 0 };
      stats[name] = stat;

      if (mode === 'replace') {
        store.clear();
        for (const row of rows) {
          store.put(row);
          stat.added++;
        }
      } else {
        const have = new Set((current[name] || []).map((r) => r?.[keyPath]));
        for (const row of rows) {
          const key = row?.[keyPath];
          if (key === undefined || key === null || have.has(key)) {
            stat.skipped++;
            continue;
          }
          have.add(key);
          stat.added++;
          const request = store.add(row);
          request.onerror = (event) => {
            // تعارض Index یکتا (مثلاً کد مشتری تکراری با شناسه‌ی متفاوت).
            // بدون preventDefault کل تراکنش Abort می‌شد و یک رکورد تکراری،
            // تمام بازگردانی را از بین می‌برد.
            event.preventDefault();
            event.stopPropagation();
            stat.added--;
            stat.skipped++;
            conflicts.push({ store: name, key, message: request.error?.message || 'تعارض کلید یکتا' });
          };
        }
      }
    }

    // زنجیره‌ی مهاجرت داده، به ترتیب v7 ← v9 ← v10 و هر گام پس از پایان قبلی —
    // همان تابعی که ارتقای برنامه اجرا می‌کند (db.js).
    if (needsUnitsMigration) runDataMigrations(tx, summary.schemaVersion);

    tx.objectStore('backupLogs').add({
      id: generateId(),
      type: 'import',
      status: 'success',
      mode,
      timestamp,
      sourceExportedAt: summary.exportedAt,
      sourceSchemaVersion: summary.schemaVersion,
      checksum: summary.checksum,
      totalRecords: summary.totalRecords,
      restorePointCreated: Boolean(createRestorePoint),
    });

    tx.objectStore('auditLog').add({
      id: generateId(),
      entity: 'backup',
      entityId: 'restore',
      action: mode === 'replace' ? 'restore-replace' : 'restore-merge',
      before: null,
      after: { exportedAt: summary.exportedAt, totalRecords: summary.totalRecords, checksum: summary.checksum },
      timestamp,
    });
  }, { stampOrigin: false });

  for (const stat of Object.values(stats)) {
    addedTotal += stat.added;
    skippedTotal += stat.skipped;
  }

  return {
    mode,
    stats,
    conflicts,
    addedTotal,
    skippedTotal,
    warnings,
    summary,
    restorePointCreated: Boolean(createRestorePoint),
    allocationBackfill: needsAllocationBackfill,
    goldUnitBackfill: needsGoldUnitBackfill,
    unitsMigration: needsUnitsMigration,
  };
}

// ─────────────────────── پاک‌سازی کامل (برای سناریوی تست و «شروع از نو») ───────────────────────

/**
 * تمام Storeهای داده‌ای را در یک تراکنش خالی می‌کند. `restorePoints` دست‌نخورده
 * می‌ماند تا اگر کاربر اشتباه کرده باشد، راه برگشت باقی بماند.
 */
export async function clearAllData({ createRestorePoint = true, reason = 'پاک‌سازی کامل داده' } = {}) {
  await openDatabase();
  const current = await readAllData();
  const existingPoints = await getAll('restorePoints');
  const timestamp = nowIso();
  const { counts, total } = countsOf(current);

  await runTransaction([...BACKUP_STORES, 'restorePoints'], 'readwrite', (tx) => {
    if (createRestorePoint) {
      for (const point of existingPoints) if (!isPreMigration(point)) tx.objectStore('restorePoints').delete(point.id);
      tx.objectStore('restorePoints').add({
        id: generateId(),
        kind: 'restore',
        createdAt: timestamp,
        reason,
        schemaVersion: DB_VERSION,
        recordCounts: counts,
        totalRecords: total,
        data: current,
      });
    }
    for (const name of BACKUP_STORES) tx.objectStore(name).clear();
    tx.objectStore('backupLogs').add({
      id: generateId(),
      type: 'clear',
      status: 'success',
      timestamp,
      totalRecords: total,
      reason,
    });
  });

  return { clearedRecords: total, recordCounts: counts, restorePointCreated: Boolean(createRestorePoint) };
}

// ─────────────────────── بررسی یکپارچگی (Integrity Check) ───────────────────────

/**
 * پس از بازگردانی، دیتابیس را با فایل پشتیبان مقایسه می‌کند.
 *
 * چرا `backupLogs` و `auditLog` جدا بررسی می‌شوند: خودِ عمل بازگردانی در هر دو
 * یک رکورد تازه می‌سازد. مقایسه‌ی تساوی برای آن‌ها همیشه (و به‌درستی) شکست
 * می‌خورد؛ پس برای آن دو بررسی می‌شود که **هر رکورد فایل موجود باشد** و تعداد
 * فقط به اندازه‌ی رکوردهای همین عملیات بیشتر شده باشد.
 */
export async function integrityCheck(payload, { mode = 'replace' } = {}) {
  const data = await readAllData();
  const issues = [];
  const perStore = {};

  for (const name of BACKUP_STORES) {
    const expected = Array.isArray(payload?.data?.[name]) ? payload.data[name] : [];
    const actual = data[name] || [];
    const keyPath = KEY_PATH.get(name) || 'id';
    const actualKeys = new Set(actual.map((r) => r?.[keyPath]));
    const missing = expected.filter((r) => !actualKeys.has(r?.[keyPath]));
    const strict = VERIFY_STORES.includes(name);

    perStore[name] = { expected: expected.length, actual: actual.length, missing: missing.length, strict };

    if (missing.length) {
      issues.push(`«${name}»: ${missing.length} رکورد فایل در دیتابیس نیست.`);
    }
    if (strict && mode === 'replace' && actual.length !== expected.length) {
      issues.push(`«${name}»: تعداد رکوردها ${actual.length} است ولی فایل ${expected.length} رکورد دارد.`);
    }
  }

  const checksum = checksumOf(data);
  const expectedChecksum = checksumOf(payload?.data || {});
  const checksumMatches = checksum === expectedChecksum;
  if (mode === 'replace' && !checksumMatches) {
    issues.push('اثر انگشت داده‌ی بازگردانی‌شده با فایل یکی نیست.');
  }

  return {
    ok: issues.length === 0,
    mode,
    checksum,
    expectedChecksum,
    checksumMatches,
    perStore,
    issues,
  };
}

// ─────────────────────── نسخه‌ی اضطراری (Restore Point) ───────────────────────

export async function listRestorePoints() {
  await openDatabase();
  const points = await getAll('restorePoints');
  return points
    .map((p) => ({
      id: p.id,
      kind: p.kind === 'preMigration' ? 'preMigration' : 'restore',
      kindLabel: RESTORE_POINT_KINDS[p.kind === 'preMigration' ? 'preMigration' : 'restore'],
      createdAt: p.createdAt,
      reason: p.reason,
      schemaVersion: p.schemaVersion,
      totalRecords: p.totalRecords,
      recordCounts: p.recordCounts,
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * برگشت به نسخه‌ی اضطراری. عمداً **یک Replace کامل** است و خودش نسخه‌ی اضطراری
 * تازه نمی‌سازد، چون در غیر این صورت بازگشت از یک بازگشت، تور ایمنی اصلی را
 * بازنویسی می‌کرد و کاربر دیگر نمی‌توانست به وضعیت پیش از بازگردانی برگردد.
 *
 * (Phase 22) نسخه‌ی «پیش از مهاجرت» داده‌ی نسخه‌ی قدیمی را دارد؛ برگشت به آن از همان
 * زنجیره‌ی مهاجرت عبور می‌کند، وگرنه داده‌ی v9 در برنامه‌ی v10 نشانده می‌شد.
 */
export async function rollbackToRestorePoint(id) {
  await openDatabase();
  const points = await getAll('restorePoints');
  const point = points.find((p) => p.id === id) || null;
  if (!point) throw new BackupError('نسخه‌ی اضطراری یافت نشد.', 'restorePoint');

  const timestamp = nowIso();
  const fromVersion = Number(point.schemaVersion) || DB_VERSION;
  await runTransaction(
    BACKUP_STORES,
    'readwrite',
    (tx) => {
      for (const name of BACKUP_STORES) {
        const store = tx.objectStore(name);
        store.clear();
        for (const row of point.data?.[name] || []) store.put(row);
      }
      if (fromVersion < DB_VERSION) runDataMigrations(tx, fromVersion);
      tx.objectStore('backupLogs').add({
        id: generateId(),
        type: 'rollback',
        status: 'success',
        timestamp,
        restorePointId: point.id,
        totalRecords: point.totalRecords,
      });
    },
    { stampOrigin: false }
  );

  return { restoredRecords: point.totalRecords, createdAt: point.createdAt, migratedFrom: fromVersion < DB_VERSION ? fromVersion : null };
}

/**
 * نسخه‌ی اضطراری ⇒ فایل پشتیبان معتبر (Phase 22). مهم‌ترین کاربرد: ذخیره‌ی بیرونیِ
 * «پشتیبان خودکار پیش از مهاجرت» — Safari اجازه‌ی ذخیره‌ی خودکار فایل بدون لمس کاربر
 * را نمی‌دهد، پس نسخه داخل برنامه ساخته می‌شود و کاربر با یک لمس آن را بیرون می‌برد.
 * `schemaVersion` همان نسخه‌ی داده‌ی داخل نسخه است، پس بازگردانی‌اش در هر نسخه‌ی
 * آینده‌ی برنامه از زنجیره‌ی مهاجرت عبور می‌کند.
 */
export async function exportRestorePoint(id) {
  await openDatabase();
  const point = (await getAll('restorePoints')).find((p) => p.id === id) || null;
  if (!point) throw new BackupError('نسخه‌ی اضطراری یافت نشد.', 'restorePoint');
  const stores = Object.keys(point.data || {}).filter((n) => !OUT_OF_SCOPE.has(n));
  const data = {};
  for (const name of stores) data[name] = point.data[name] || [];
  // Storeهایی که در آن نسخه وجود نداشته‌اند، آرایه‌ی خالی می‌گیرند تا فایل معتبر بماند.
  for (const name of BACKUP_STORES) if (!Array.isArray(data[name])) data[name] = [];
  const { counts, total } = countsOf(data);
  const at = new Date(point.createdAt || Date.now());
  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: Number(point.schemaVersion) || DB_VERSION,
    app: 'tala-app',
    exportedAt: at.toISOString(),
    note: point.reason || '',
    stores: BACKUP_STORES,
    recordCounts: counts,
    totalRecords: total,
    checksum: checksumOf(data),
    data,
  };
  const json = JSON.stringify(payload);
  const prefix = point.kind === 'preMigration' ? `GoldShop_PreMigration_v${payload.schemaVersion}_` : 'GoldShop_RestorePoint_';
  const fileName = backupFileName(at).replace('GoldShop_Backup_', prefix);
  await writeBackupLog({ type: 'exportRestorePoint', status: 'success', restorePointId: point.id, fileName, totalRecords: total });
  return { payload, json, fileName, totalRecords: total };
}

/**
 * (Phase 22) پشتیبان خودکار پیش از مهاجرتی که هنوز به‌صورت **فایل** بیرون برده نشده است.
 * تا وقتی کاربر آن را ذخیره نکرده، داشبورد یادآوری می‌کند (Safari ذخیره‌ی خودکار فایل را
 * بدون لمس کاربر اجازه نمی‌دهد). `null` یعنی چیزی در انتظار نیست.
 */
export async function pendingMigrationBackup() {
  await openDatabase();
  const points = (await getAll('restorePoints')).filter((p) => p.kind === 'preMigration');
  if (!points.length) return null;
  const latest = points.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const logs = await getAll('backupLogs');
  if (logs.some((l) => l.type === 'exportRestorePoint' && l.restorePointId === latest.id)) return null;
  return { id: latest.id, createdAt: latest.createdAt, fromVersion: latest.schemaVersion, toVersion: latest.toVersion, totalRecords: latest.totalRecords };
}

// ─────────────────────── یادآوری پشتیبان‌گیری ───────────────────────

export const BACKUP_REMINDER_DEFAULT_DAYS = 7;

/**
 * (Phase 27) فاصله‌ی یادآوری پشتیبان از تنظیمات (یا پیش‌فرض). پیش از این همین چند خط در داشبورد،
 * هدر و صفحه‌ی پشتیبان تکرار شده بود و هر سه `repo.get('settings')` را مستقیم صدا می‌زدند.
 */
export async function backupReminderDays() {
  const settings = (await findSettings()) || {};
  return Number.isFinite(Number(settings.backupReminderDays)) ? Number(settings.backupReminderDays) : BACKUP_REMINDER_DEFAULT_DAYS;
}

/** آخرین Export موفق — «آخرین پشتیبان» از دفتر رویدادها مشتق می‌شود، نه از یک فیلد دستی. */
export async function lastBackupInfo() {
  await openDatabase();
  const logs = await getAll('backupLogs');
  const exports_ = logs
    .filter((l) => l.type === 'export' && l.status === 'success' && l.timestamp)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return exports_[0] || null;
}

/** تفاوت دو تاریخ به **روز تقویمی محلی** (نه ۲۴ ساعت) — همان قاعده‌ی Phase 12. */
function daysBetween(fromIso, now) {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * وضعیت یادآوری برای داشبورد.
 * `days = 0` در تنظیمات یعنی یادآوری خاموش (همان قرارداد `dueDateAlertDaysAhead`).
 */
export async function backupReminder({ days = BACKUP_REMINDER_DEFAULT_DAYS, now = new Date() } = {}) {
  const limit = Number.isFinite(Number(days)) ? Math.max(0, Math.min(365, Number(days))) : BACKUP_REMINDER_DEFAULT_DAYS;
  const last = await lastBackupInfo();
  if (limit === 0) return { enabled: false, due: false, last: null, daysSince: null, limit };
  if (!last) {
    return { enabled: true, due: true, last: null, daysSince: null, limit, reason: 'never' };
  }
  const daysSince = daysBetween(last.timestamp, now);
  return {
    enabled: true,
    due: daysSince !== null && daysSince >= limit,
    last,
    daysSince,
    limit,
    reason: 'stale',
  };
}
