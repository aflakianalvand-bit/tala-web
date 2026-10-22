// db.js — راه‌اندازی و مدیریت اتصال IndexedDB (بدون کتابخانه‌ی خارجی)
import { DB_NAME, DB_VERSION, STORES } from './schema.js';
import { generateId } from '../utils/id.js';
// units.js خالص است (فقط utils/decimal) — وابستگی چرخه‌ای ایجاد نمی‌کند.
import { legacyKaratToFineness, migrateInventoryRefId } from '../services/units.js';

let dbInstance = null;
let openPromise = null;

// ─────────────────── هویت دستگاه و ثبت‌کننده (Phase 22، DB v10) ───────────────────
//
// مسیر آینده‌ی محصول (BUSINESS_RULES §11.8): چند مغازه‌ی مستقل، هر کدام داده‌ی جدا روی
// دستگاه خودش. از v10 هر رکورد تازه دو فیلد رهگیری می‌گیرد: `deviceId` (این نصب) و
// `createdBy` (کاربر محلی). این‌ها **هرگز در هیچ فرمولی نمی‌آیند** — فقط رهگیری‌اند.
//
// چرا اینجا و نه در هر سرویس: «هر رکورد تازه» ده‌ها محل ساخت دارد و فراموش‌کردن یکی
// یعنی سندی بدون منشأ. پس مُهر در همان نقطه‌ای زده می‌شود که همه‌ی نوشتن‌ها از آن
// می‌گذرند: `add` در runTransaction و repo. فقط `add` (ساختن)، نه `put` (ویرایش):
// ابطال یک سند قدیمی نباید آن را به دستگاه فعلی نسبت دهد. و فقط وقتی فیلد وجود
// ندارد: بازگردانی پشتیبان منشأ اصلی رکوردها را حفظ می‌کند (و اصلاً مُهر نمی‌خورد).

/** Storeهایی که رکوردشان «سند/داده‌ی کاربر» نیست و مُهر منشأ نمی‌گیرند. */
const ORIGIN_EXCLUDED_STORES = new Set(['settings', 'restorePoints', 'deviceInfo']);

/** نام پیش‌فرض کاربر محلی تا پیش از چندکاربره (Phase 21، پیشنهاد تأییدشده). */
export const DEFAULT_USER_NAME = 'مالک';

const origin = { deviceId: null, createdBy: DEFAULT_USER_NAME };

/** منشأ فعلی (برای نمایش در تنظیمات و تست). */
export function getOrigin() {
  return { ...origin };
}

/** نام کاربر محلی — سرویس تنظیمات پس از ذخیره صدا می‌زند. */
export function setOriginUser(name) {
  const n = String(name ?? '').trim();
  origin.createdBy = n || DEFAULT_USER_NAME;
}

/** مُهر منشأ روی یک رکورد **تازه** (فقط اگر فیلدها وجود نداشته باشند). */
export function stampOrigin(storeName, value) {
  if (!origin.deviceId || ORIGIN_EXCLUDED_STORES.has(storeName)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value.deviceId === undefined) value.deviceId = origin.deviceId;
  if (value.createdBy === undefined) value.createdBy = origin.createdBy;
  return value;
}

function installOriginStamp(tx) {
  const wrapped = new WeakSet();
  const original = tx.objectStore.bind(tx);
  tx.objectStore = (name) => {
    const store = original(name);
    if (!wrapped.has(store) && !ORIGIN_EXCLUDED_STORES.has(name)) {
      const add = store.add.bind(store);
      store.add = (value, key) =>
        key === undefined ? add(stampOrigin(name, value)) : add(stampOrigin(name, value), key);
      wrapped.add(store);
    }
    return store;
  };
}

/** شناسه‌ی این نصب را می‌خواند (یا یک بار می‌سازد) و نام کاربر را از تنظیمات برمی‌دارد. */
function loadIdentity(db) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains('deviceInfo')) {
      resolve();
      return;
    }
    const stores = db.objectStoreNames.contains('settings') ? ['deviceInfo', 'settings'] : ['deviceInfo'];
    const tx = db.transaction(stores, 'readwrite');
    const devices = tx.objectStore('deviceInfo');
    const req = devices.get('device');
    req.onsuccess = () => {
      if (req.result?.deviceId) {
        origin.deviceId = req.result.deviceId;
      } else {
        origin.deviceId = generateId();
        devices.put({ id: 'device', deviceId: origin.deviceId, createdAt: new Date().toISOString() });
      }
    };
    if (stores.includes('settings')) {
      const sreq = tx.objectStore('settings').get('main');
      sreq.onsuccess = () => setOriginUser(sreq.result?.userName);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // هویت اختیاری است؛ نبودش هیچ عملیاتی را متوقف نمی‌کند.
    tx.onabort = () => resolve();
  });
}

/**
 * پایگاه‌داده را باز می‌کند (و در صورت نیاز، Object Storeها را می‌سازد).
 * ایمن برای فراخوانی چندباره — همیشه همان اتصال را برمی‌گرداند.
 */
export function openDatabase() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (openPromise) return openPromise;

  openPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB در این مرورگر پشتیبانی نمی‌شود.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const store of STORES) {
        let objectStore;
        if (!db.objectStoreNames.contains(store.name)) {
          objectStore = db.createObjectStore(store.name, { keyPath: store.keyPath });
        } else {
          objectStore = request.transaction.objectStore(store.name);
        }
        for (const idx of store.indexes || []) {
          if (!objectStore.indexNames.contains(idx.name)) {
            objectStore.createIndex(idx.name, idx.keyPath, idx.options || {});
          }
        }
      }

      // ── Migration داده‌ای (نه ساختاری) ──
      // ساخت Object Store کار حلقه‌ی بالاست؛ اینجا فقط داده‌ی موجود با قواعد نسخه‌ی
      // جدید سازگار می‌شود. داخل همان تراکنش ارتقا اجرا می‌شود، پس یا کامل انجام
      // می‌شود یا هیچ (دیتابیس نیمه‌مهاجرت‌کرده وجود ندارد).
      // (Phase 19) واحد رسمی مانده از ریال به «گرم ۷۵۰» تغییر کرد. بدون این
      // Backfill، هر فاکتور و هر مانده‌ی قدیمی پس از به‌روزرسانی **صفر گرم**
      // می‌شد — یعنی تمام بدهی‌ها و طلب‌های کاربر ناپدید می‌شدند.
      // ترتیب **مهم** است: v9 باید تخصیص‌هایی را که v7 تازه ساخته هم ببیند،
      // وگرنه همان فاکتورهای تسویه‌شده بدون مقدار گرمی می‌مانند و دوباره «باز»
      // دیده می‌شوند — همان باگی که Backfill v7 برای حل آن نوشته شده بود.
      //
      // (Phase 22) پیش از **هر** Migration داده‌ای، نسخه‌ی کامل داده‌ی فعلی — پیش از
      // هر تغییری — در `restorePoints` نوشته می‌شود؛ در همین تراکنش ارتقا، پس یا
      // نسخه و مهاجرت هر دو ثبت می‌شوند یا هیچ‌کدام. زنجیره‌ی مهاجرت‌ها به ترتیب
      // v7 ← v9 ← v10 اجرا می‌شود و هر گام پس از پایان کامل گام قبل شروع می‌شود.
      const from = event.oldVersion;
      if (from > 0 && from < DB_VERSION) {
        const tx = request.transaction;
        snapshotBeforeMigration(tx, from, DB_VERSION, () => runDataMigrations(tx, from));
      }
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      db.onversionchange = () => {
        // یک Tab دیگر در حال Upgrade دیتابیس است؛ این اتصال را می‌بندیم.
        db.close();
        if (dbInstance === db) dbInstance = null;
      };
      loadIdentity(db).then(() => {
        dbInstance = db;
        resolve(db);
      });
    };

    request.onerror = (event) => {
      openPromise = null;
      reject(event.target.error || new Error('خطا در باز کردن پایگاه‌داده'));
    };

    request.onblocked = () => {
      reject(new Error('پایگاه‌داده توسط یک تب دیگر مسدود شده است. لطفاً تب‌های دیگر برنامه را ببندید.'));
    };
  });

  return openPromise;
}

/**
 * Migration داده‌ای v6 → v7 (Phase 11): ساخت رکورد «تخصیص» برای پرداخت/دریافت‌هایی
 * که پیش از Phase 11 همراه سند خرید/فروش ثبت شده‌اند.
 *
 * چرا لازم است: از Phase 11 مانده‌ی هر فاکتور با فرمول یکتای
 * «مبلغ − برگشت‌ها − Σ تخصیص‌ها» محاسبه می‌شود. بدون این Backfill، فاکتوری که کاربر
 * ماه‌ها پیش نقداً تسویه کرده بود، بعد از به‌روزرسانی برنامه ناگهان با **تمام مبلغ**
 * بدهکار نشان داده می‌شد — یک خطای داده‌ای واقعی روی گوشی کاربر، نه یک نکته‌ی نظری.
 *
 * هیچ رکورد دفتری ساخته یا تغییر داده نمی‌شود: تخصیص فقط یک نسبت‌دادن است و اثر
 * مالی این پرداخت‌ها از همان Phase 6/7 در دفاتر ثبت شده است.
 */
// از Phase 15 صادر می‌شود: بازگردانی یک پشتیبانِ پیش از v7 هم دقیقاً همین
// سازگارسازی را لازم دارد، و دو نسخه از یک قاعده‌ی داده‌ای در آینده از هم واگرا می‌شود.
export function backfillAllocationsV7(tx, onDone = null) {
  const finish = () => {
    if (typeof onDone === 'function') onDone();
  };
  if (!tx.objectStoreNames.contains('allocations')) {
    finish();
    return;
  }
  const allocations = tx.objectStore('allocations');
  const now = new Date().toISOString();
  // شمارنده‌ی کارهای در جریان: تا آخرین رکورد ساخته نشده، مرحله‌ی بعدی (v9)
  // نباید شروع شود.
  let pending = 1;
  const step = (n) => {
    pending += n;
    if (pending === 0) finish();
  };

  const groups = [
    { docStore: 'purchases', idsKey: 'paymentIds', payStore: 'payments', partyType: 'supplier', partyKey: 'supplierId', targetType: 'purchase', docType: 'payment' },
    { docStore: 'sales', idsKey: 'receiptIds', payStore: 'receipts', partyType: 'customer', partyKey: 'customerId', targetType: 'sale', docType: 'receipt' },
  ];

  for (const g of groups) {
    if (!tx.objectStoreNames.contains(g.docStore) || !tx.objectStoreNames.contains(g.payStore)) continue;
    pending += 1;
    const docsRequest = tx.objectStore(g.docStore).getAll();
    docsRequest.onsuccess = () => {
      for (const doc of docsRequest.result || []) {
        const ids = doc[g.idsKey] || [];
        if (!ids.length) continue;
        for (const payId of ids) {
          pending += 1;
          const payRequest = tx.objectStore(g.payStore).get(payId);
          payRequest.onsuccess = () => {
            const pay = payRequest.result;
            if (!pay || pay.status === 'voided') {
              step(-1);
              return;
            }
            const amount = Number(pay.valueIRR);
            if (!Number.isFinite(amount) || amount <= 0) {
              step(-1);
              return;
            }
            const addRequest = allocations.add({
              id: generateId(),
              docType: g.docType,
              docId: pay.id,
              docNumberSnapshot: pay.number || '',
              partyType: g.partyType,
              partyId: doc[g.partyKey],
              targetType: g.targetType,
              targetId: doc.id,
              targetNumberSnapshot: doc.number || '',
              amountIRR: amount,
              auto: true,
              date: pay.date || doc.date,
              status: 'active',
              migratedFrom: 'v6',
              createdAt: now,
              updatedAt: now,
              voidedAt: null,
            });
            addRequest.onsuccess = () => step(-1);
            addRequest.onerror = () => step(-1);
          };
          payRequest.onerror = () => step(-1);
        }
      }
      step(-1);
    };
    docsRequest.onerror = () => step(-1);
  }

  step(-1);
}

// ═════════════════════ Migration داده‌ای v8 → v9 (Phase 19) ═════════════════════
//
// از Phase 19 واحد رسمی مانده‌ی طرف حساب، فاکتور، سررسید و تخصیص «گرم عیار ۷۵۰»
// است. داده‌ی قدیمی فقط ریال دارد، پس باید یک بار و برای همیشه به گرم ترجمه شود.
//
// قاعده‌ی تبدیل (تصمیم ۵۶ کاربر):
//   ۱) فیِ خودِ سند (Snapshot لحظه‌ی ثبت) — تغییر بعدی نرخ روز این عدد را عوض نمی‌کند
//   ۲) نرخ دستی یکی از اقلام همان سند، نرمال‌شده به عیار ۱۸
//   ۳) نرخ مؤثر همان **تاریخ** از تاریخچه‌ی نرخ روز
//   ۴) هیچ‌کدام نبود ⇒ سند صفر نمی‌گیرد، علامت `goldUnitsPending` می‌خورد تا کاربر
//      یک‌بار دستی فی آن را وارد کند (همان اصل Phase 18: مانده‌ی صریحاً ناقص از
//      مانده‌ی کمی‌غلطِ درست‌به‌نظر امن‌تر است).

function numOf(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** گِردکردن به دقت رسمی مانده (۰٫۰۱ گرم) با قاعده‌ی «نصف به بالا، دور از صفر». */
function g2(value) {
  const n = numOf(value);
  const r = (n < 0 ? -1 : 1) * Math.round(Math.abs(n) * 100) / 100;
  return r === 0 ? 0 : r;
}

export function backfillGoldUnitsV9(tx, onDone = null) {
  const finish = () => {
    if (typeof onDone === 'function') onDone();
  };
  const names = [
    'priceRates', 'sales', 'purchases', 'saleReturns', 'receipts', 'payments',
    'allocations', 'dueDates', 'transactions', 'moneyLedger',
  ];
  const available = names.filter((n) => tx.objectStoreNames.contains(n));
  if (!available.length) {
    finish();
    return;
  }

  const data = {};
  let pending = available.length;
  for (const name of available) {
    const req = tx.objectStore(name).getAll();
    req.onsuccess = () => {
      data[name] = req.result || [];
      pending -= 1;
      if (pending === 0) {
        applyGoldUnitsV9(tx, data);
        // نوشتن‌های بالا در صف همین تراکنش‌اند؛ هر خواندنِ بعدی (گام v10) آن‌ها را می‌بیند.
        finish();
      }
    };
  }
}

function applyGoldUnitsV9(tx, data) {
  const BASE = 18;
  const put = (store, record) => {
    if (tx.objectStoreNames.contains(store)) tx.objectStore(store).put(record);
  };

  // ── تاریخچه‌ی نرخ، مرتب و قطعی (همان ترتیب priceRates.js) ──
  const rates = (data.priceRates || [])
    .filter((r) => numOf(r.ratePerGram18k) > 0)
    .sort((a, b) => {
      const d = String(a.effectiveDate || a.createdAt || '').localeCompare(
        String(b.effectiveDate || b.createdAt || '')
      );
      return d !== 0 ? d : numOf(a.seq) - numOf(b.seq);
    });

  function rateAt(dateIso) {
    if (!rates.length) return 0;
    const key = String(dateIso || '');
    let found = 0;
    for (const r of rates) {
      if (String(r.effectiveDate || r.createdAt || '') <= key) found = numOf(r.ratePerGram18k);
      else break;
    }
    // سندی پیش از نخستین نرخ ثبت‌شده: نزدیک‌ترین نرخ موجود بهتر از صفر است.
    return found || numOf(rates[0].ratePerGram18k);
  }

  function docRate(doc) {
    if (!doc) return 0;
    if (numOf(doc.ratePerBaseGram) > 0) return numOf(doc.ratePerBaseGram);
    const snap = doc.pricingSnapshot;
    if (snap && numOf(snap.ratePerGram18k) > 0) {
      const bk = numOf(snap.baseKarat) || BASE;
      return (numOf(snap.ratePerGram18k) * BASE) / bk;
    }
    for (const line of doc.lines || []) {
      if (numOf(line.ratePerGram) > 0 && numOf(line.karat) > 0) {
        return (numOf(line.ratePerGram) * BASE) / numOf(line.karat);
      }
    }
    return rateAt(doc.date);
  }

  const invoiceRate = new Map();
  const invoiceGross = new Map();

  // ── فاکتورهای فروش و اسناد خرید ──
  for (const [store, key] of [['sales', 'received'], ['purchases', 'paid']]) {
    for (const doc of data[store] || []) {
      const rate = docRate(doc);
      invoiceRate.set(doc.id, rate);
      if (rate <= 0) {
        put(store, { ...doc, ratePerBaseGram: 0, grandTotalGrams: 0, goldUnitsPending: true });
        invoiceGross.set(doc.id, 0);
        continue;
      }
      const lines = (doc.lines || []).map((line) => ({
        ...line,
        baseGrams: g2((numOf(line.weightGrams) * numOf(line.karat)) / BASE),
        lineTotalGrams: g2(numOf(line.lineTotalIRR) / rate),
        returnedGrams: g2(numOf(line.returnedAmountIRR) / rate),
      }));
      // سند قدیمیِ بدون ریز اقلام (نسخه‌های خیلی اولیه) هم باید مقدار بگیرد،
      // وگرنه بدهی‌اش پس از ارتقا صفر گرم می‌شد.
      const linesGrams = g2(lines.reduce((s, l) => s + numOf(l.lineTotalGrams), 0));
      const grandTotalGrams = linesGrams > 0 ? linesGrams : g2(numOf(doc.grandTotalIRR) / rate);
      const linesReturned = g2(lines.reduce((s, l) => s + numOf(l.returnedGrams), 0));
      const returnedGrams =
        linesReturned > 0 ? linesReturned : g2(numOf(doc.returnedAmountIRR) / rate);
      const settledIRR =
        key === 'received'
          ? numOf(doc.receivedCashIRR) + numOf(doc.receivedGoldValueIRR)
          : numOf(doc.paidCashIRR) + numOf(doc.paidGoldValueIRR);
      const settledGrams = g2(settledIRR / rate);
      const record = {
        ...doc,
        lines,
        ratePerBaseGram: rate,
        totalBaseGrams: g2(lines.reduce((s, l) => s + numOf(l.baseGrams), 0)),
        grandTotalGrams,
        returnedGrams,
        remainingGrams: Math.max(0, g2(grandTotalGrams - settledGrams - returnedGrams)),
        goldUnitsPending: false,
      };
      if (key === 'received') record.receivedTotalGrams = settledGrams;
      else record.paidTotalGrams = settledGrams;
      put(store, record);
      invoiceGross.set(doc.id, g2(grandTotalGrams - returnedGrams));
    }
  }

  // ── اسناد برگشت از فروش ──
  for (const doc of data.saleReturns || []) {
    const rate = invoiceRate.get(doc.saleId) || rateAt(doc.date);
    const lines = (doc.lines || []).map((line) => ({
      ...line,
      amountGrams: rate > 0 ? g2(numOf(line.amountIRR) / rate) : 0,
    }));
    put('saleReturns', {
      ...doc,
      lines,
      totalGrams: g2(lines.reduce((s, l) => s + numOf(l.amountGrams), 0)),
      goldUnitsPending: rate <= 0,
    });
  }

  // ── اسناد دریافت و پرداخت ──
  for (const store of ['receipts', 'payments']) {
    for (const doc of data[store] || []) {
      // طلا در برابر طلا هیچ نرخی نمی‌خواهد: وزن معادل ۷۵۰ خودش مقدار است.
      if (doc.method === 'gold' && numOf(doc.weightGrams) > 0 && numOf(doc.karat) > 0) {
        put(store, {
          ...doc,
          valueGrams: g2((numOf(doc.weightGrams) * numOf(doc.karat)) / BASE),
          goldUnitsPending: false,
        });
        continue;
      }
      const related = doc.relatedSaleId || doc.relatedPurchaseId || null;
      const rate = (related && invoiceRate.get(related)) || numOf(doc.ratePerBaseGram) || rateAt(doc.date);
      put(store, {
        ...doc,
        ratePerBaseGram: rate,
        valueGrams: rate > 0 ? g2(numOf(doc.valueIRR) / rate) : 0,
        goldUnitsPending: rate <= 0,
      });
    }
  }

  // ── تخصیص‌ها: با نرخ **فاکتور مقصد**، تا مانده‌ی فاکتور دقیقاً بسته شود ──
  const byTarget = new Map();
  for (const a of data.allocations || []) {
    if (a.status === 'voided') {
      put('allocations', { ...a, amountGrams: 0 });
      continue;
    }
    const list = byTarget.get(a.targetId) || [];
    list.push(a);
    byTarget.set(a.targetId, list);
  }
  const invoiceById = new Map(
    [...(data.sales || []), ...(data.purchases || [])].map((d) => [d.id, d])
  );
  for (const [targetId, list] of byTarget) {
    const rate = invoiceRate.get(targetId) || 0;
    const converted = list.map((a) => ({ ...a, amountGrams: rate > 0 ? g2(numOf(a.amountIRR) / rate) : 0 }));
    // فاکتوری که در نسخه‌ی قبل «تسویه‌شده» بوده باید پس از ارتقا هم دقیقاً صفر
    // بماند؛ خطای گِردکردن ردیف‌ها روی آخرین تخصیص جبران می‌شود.
    const invoice = invoiceById.get(targetId);
    if (invoice && invoice.status === 'settled' && converted.length && rate > 0) {
      const gross = numOf(invoiceGross.get(targetId));
      const sum = g2(converted.reduce((s, a) => s + numOf(a.amountGrams), 0));
      const diff = g2(gross - sum);
      if (diff !== 0) {
        const last = converted[converted.length - 1];
        last.amountGrams = g2(numOf(last.amountGrams) + diff);
      }
    }
    for (const a of converted) put('allocations', a);
  }

  // ── سررسیدها ──
  for (const d of data.dueDates || []) {
    const rate = invoiceRate.get(d.sourceId) || rateAt(d.dueDate || d.createdAt);
    put('dueDates', {
      ...d,
      amountGrams: rate > 0 ? g2(numOf(d.amountIRR) / rate) : 0,
      goldUnitsPending: rate <= 0,
    });
  }

  // ── دفتر وجه: هر تراکنش جداگانه، تا تراز گرمیِ همان سند برقرار بماند ──
  const txSource = new Map((data.transactions || []).map((t) => [t.id, t]));
  const entriesByTx = new Map();
  for (const e of data.moneyLedger || []) {
    const list = entriesByTx.get(e.transactionId) || [];
    list.push(e);
    entriesByTx.set(e.transactionId, list);
  }
  for (const [txId, entries] of entriesByTx) {
    const source = txSource.get(txId);
    const sourceDoc = source ? invoiceById.get(source.sourceId) : null;
    const rate =
      (sourceDoc && invoiceRate.get(sourceDoc.id)) ||
      (source && invoiceRate.get(source.sourceId)) ||
      rateAt(entries[0]?.date);
    const converted = entries.map((e) => ({
      ...e,
      debitGrams: rate > 0 ? g2(numOf(e.debit) / rate) : 0,
      creditGrams: rate > 0 ? g2(numOf(e.credit) / rate) : 0,
    }));
    // جبران خطای گِردکردن: بدون این گام، یک سند چندقلمی می‌توانست چند صدم گرم
    // ناتراز بماند و تراز آزمایشی گرمی را برای همیشه بشکند.
    const debit = g2(converted.reduce((s, e) => s + e.debitGrams, 0));
    const credit = g2(converted.reduce((s, e) => s + e.creditGrams, 0));
    const diff = g2(debit - credit);
    if (diff !== 0) {
      const side = diff > 0 ? 'creditGrams' : 'debitGrams';
      let biggest = null;
      for (const e of converted) {
        if (numOf(e[side]) > 0 && (!biggest || numOf(e[side]) > numOf(biggest[side]))) biggest = e;
      }
      if (biggest) biggest[side] = g2(numOf(biggest[side]) + Math.abs(diff));
    }
    for (const e of converted) put('moneyLedger', e);
  }
}

// ─────────────────── زنجیره‌ی مهاجرت داده + نسخه‌ی پیش از مهاجرت (Phase 22) ───────────────────

/**
 * تمام Migrationهای داده‌ای لازم از نسخه‌ی `fromVersion` به نسخه‌ی فعلی، **به ترتیب**
 * و هر کدام پس از پایان کامل قبلی. همین تابع هم در ارتقای برنامه (onupgradeneeded)
 * و هم در بازگردانی پشتیبان قدیمی و برگشت به نسخه‌ی اضطراری اجرا می‌شود — یک قاعده،
 * یک پیاده‌سازی (درس Phase 15).
 */
export function runDataMigrations(tx, fromVersion, onDone = null) {
  const from = Number(fromVersion) || 0;
  const steps = [];
  if (from > 0 && from < 7) steps.push((next) => backfillAllocationsV7(tx, next));
  if (from > 0 && from < 9) steps.push((next) => backfillGoldUnitsV9(tx, next));
  if (from > 0 && from < 10) steps.push((next) => migrateUnitsV10(tx, next));
  const run = (i) => {
    if (i < steps.length) steps[i](() => run(i + 1));
    else if (typeof onDone === 'function') onDone();
  };
  run(0);
}

/** Storeهای بیرون از نسخه‌ی پیش از مهاجرت (همان دامنه‌ی فایل پشتیبان). */
const SNAPSHOT_EXCLUDED = new Set(['restorePoints', 'deviceInfo']);

/**
 * نسخه‌ی کامل داده **پیش از** هر Migration داده‌ای (پشتیبان خودکار اجباری — Phase 21 §۱۱.۸).
 *
 * - در همان تراکنش ارتقا: اگر مهاجرت شکست بخورد، کل ارتقا برمی‌گردد و این نسخه هم
 *   لازم نیست؛ اگر موفق شود، نسخه‌ی پیش از آن کنار داده‌ی جدید ذخیره است.
 * - `kind: 'preMigration'` و `schemaVersion` = نسخه‌ی **داده‌ی داخل آن** (نه نسخه‌ی برنامه)
 *   تا Export آن یک فایل پشتیبان معتبرِ همان نسخه باشد و بازگردانی‌اش دوباره از همین
 *   زنجیره‌ی مهاجرت عبور کند.
 * - جدا از نسخه‌ی «پیش از بازگردانی» (Phase 15) نگه داشته می‌شود؛ فقط آخرین نسخه‌ی
 *   پیش از مهاجرت می‌ماند تا حجم Safari رشد نکند.
 */
export function snapshotBeforeMigration(tx, fromVersion, toVersion, onDone) {
  const done = () => {
    if (typeof onDone === 'function') onDone();
  };
  if (!tx.objectStoreNames.contains('restorePoints')) {
    done();
    return;
  }
  const names = Array.from(tx.objectStoreNames).filter((n) => !SNAPSHOT_EXCLUDED.has(n));
  const data = {};
  let pending = names.length + 1;
  let previous = [];
  const step = () => {
    pending -= 1;
    if (pending > 0) return;
    const counts = {};
    let total = 0;
    for (const n of names) {
      counts[n] = data[n].length;
      total += data[n].length;
    }
    if (total === 0) {
      done(); // دیتابیس خالی — چیزی برای نگه‌داشتن نیست.
      return;
    }
    const points = tx.objectStore('restorePoints');
    for (const p of previous) if (p?.kind === 'preMigration') points.delete(p.id);
    points.add({
      id: generateId(),
      kind: 'preMigration',
      createdAt: new Date().toISOString(),
      reason: `پشتیبان خودکار پیش از ارتقای داده از نسخه‌ی ${fromVersion} به ${toVersion}`,
      schemaVersion: fromVersion,
      toVersion,
      recordCounts: counts,
      totalRecords: total,
      data,
    });
    done();
  };
  for (const n of names) {
    const req = tx.objectStore(n).getAll();
    req.onsuccess = () => {
      data[n] = req.result || [];
      step();
    };
  }
  const preq = tx.objectStore('restorePoints').getAll();
  preq.onsuccess = () => {
    previous = preq.result || [];
    step();
  };
}

/**
 * Migration داده‌ای v9 → v10 (Phase 22): عیار ۲۴تایی ⇒ عیار هزاری.
 *
 * فقط **کاتالوگ و دفاتر** بازنویسی می‌شوند:
 *   - `products.karat`                  (کاتالوگ، نه سند)
 *   - `goldLedger.karat` و شناسه‌ی سطل  (`melted:18` ⇒ `melted:750`)
 *   - `moneyLedger` با `accountRef.kind='inventory'` ⇒ همان شناسه‌ی سطل جدید
 * اسناد تجاری (فروش، خرید، برگشت، دریافت، پرداخت، انتقال، اسناد انبار) و نرخ‌های
 * روز **دست نمی‌خورند** (Snapshot)؛ خواننده‌ها با «پروفایل واحد» هر سند آن را
 * تفسیر می‌کنند (services/units.js). نگاشت: ۲۴←۹۹۹، ۲۲←۹۱۶، ۲۱←۸۷۵، ۱۸←۷۵۰،
 * ۱۴←۵۸۵، بقیه تناسبی (عیار × ۱۰۰۰ ÷ ۲۴).
 *
 * فقط مقادیر ۱ تا ۲۴ تبدیل می‌شوند، پس اجرای دوباره (مثلاً روی داده‌ای که قبلاً
 * مهاجرت کرده) هیچ اثری ندارد.
 */
export function migrateUnitsV10(tx, onDone = null) {
  const finish = () => {
    if (typeof onDone === 'function') onDone();
  };
  const names = ['products', 'goldLedger', 'moneyLedger'].filter((n) => tx.objectStoreNames.contains(n));
  if (!names.length) {
    finish();
    return;
  }
  const isLegacyKarat = (k) => {
    const n = Number(k);
    return Number.isFinite(n) && n > 0 && n <= 24;
  };
  const isLegacyRef = (ref) =>
    ref?.kind === 'inventory' && typeof ref.id === 'string' && migrateInventoryRefId(ref.id) !== ref.id;

  const data = {};
  let pending = names.length;
  const apply = () => {
    for (const p of data.products || []) {
      if (isLegacyKarat(p.karat)) tx.objectStore('products').put({ ...p, karat: legacyKaratToFineness(p.karat) });
    }
    for (const e of data.goldLedger || []) {
      const karatChanges = isLegacyKarat(e.karat);
      const refChanges = isLegacyRef(e.accountRef);
      if (!karatChanges && !refChanges) continue;
      tx.objectStore('goldLedger').put({
        ...e,
        karat: karatChanges ? legacyKaratToFineness(e.karat) : e.karat,
        accountRef: refChanges ? { ...e.accountRef, id: migrateInventoryRefId(e.accountRef.id) } : e.accountRef,
      });
    }
    for (const e of data.moneyLedger || []) {
      if (!isLegacyRef(e.accountRef)) continue;
      tx.objectStore('moneyLedger').put({
        ...e,
        accountRef: { ...e.accountRef, id: migrateInventoryRefId(e.accountRef.id) },
      });
    }
    finish();
  };
  for (const n of names) {
    const req = tx.objectStore(n).getAll();
    req.onsuccess = () => {
      data[n] = req.result || [];
      pending -= 1;
      if (pending === 0) apply();
    };
  }
}

/** اتصال فعلی را برمی‌گرداند؛ اگر باز نشده باشد خطا می‌دهد (باید بعد از bootstrap فراخوانی شود). */
export function getDB() {
  if (!dbInstance) {
    throw new Error('پایگاه‌داده هنوز راه‌اندازی نشده است. ابتدا openDatabase() را فراخوانی کنید.');
  }
  return dbInstance;
}

/** فهرست نام تمام Object Storeهای موجود — برای تست/Debug. */
export function listStoreNames() {
  return Array.from(getDB().objectStoreNames);
}

/**
 * یک Transaction روی چند Store به‌صورت اتمیک اجرا می‌کند (پایه معماری Ledger — رجوع به ARCHITECTURE.md §8).
 * callback با شیء transaction (tx) صدا زده می‌شود و باید عملیات را روی tx.objectStore(name) انجام دهد.
 */
export async function runTransaction(storeNames, mode, callback, { stampOrigin: doStamp = true } = {}) {
  const db = await openDatabase();
  const tx = db.transaction(storeNames, mode);
  // (Phase 22) مُهر منشأ روی هر رکورد تازه. بازگردانی/برگشت با `stampOrigin: false`
  // صدا زده می‌شوند تا منشأ اصلی رکوردهای بازگردانی‌شده حفظ شود.
  if (mode === 'readwrite' && doStamp) installOriginStamp(tx);
  const result = callback(tx);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    // Phase 17: در برخی خطاها (مثلاً نقض Index یکتا) `tx.error` هنوز پر نشده و
    // رد شدن با `null` باعث می‌شد کاربر پیام «خطای نامشخص» ببیند و لاگ هم خالی بماند.
    tx.onerror = () => reject(tx.error || new Error('ثبت اطلاعات در پایگاه‌داده ناموفق بود.'));
    tx.onabort = () => reject(tx.error || new Error('تراکنش لغو شد و هیچ تغییری ثبت نشد.'));
  });
}
