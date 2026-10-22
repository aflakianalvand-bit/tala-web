// dashboard.js — موتور KPI داشبورد (Phase 13)
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل **فقط‌خواندنی** است و هیچ عدد جدیدی «نمی‌سازد» که جای دیگری هم ساخته
// شده باشد. هر KPI از همان مرجعی می‌آید که صفحه‌ی تخصصی‌اش از آن می‌خواند:
//
//   موجودی طلا و ارزش آن ....... services/inventory.js  (listBuckets/grandTotal)
//   مانده‌ی صندوق‌ها ............ services/accounts.js   (listAccounts)
//   مطالبات و بدهی ............. services/ledger.js     (moneyBalanceMap)
//   هشدار سررسید ............... services/dueDates.js   (getDueAlerts)
//   اقلام فروش و خرید .......... services/reports/invoiceReports.js (rawData)
//
// «rawData» همان بارگذارِ گزارش‌های Phase 14 است؛ یعنی قاعده‌ی «کدام سند شمرده
// می‌شود» (باطل‌نشده، حذف‌نشده، داخل بازه، برگشت در تاریخ خودش) در یک جا تعریف
// شده و داشبورد و گزارش هرگز نمی‌توانند دو جواب متفاوت بدهند. تست این برابری را
// مستقیماً assert می‌کند.
//
// ─── دو تصمیم کسب‌وکاری این فاز (پرسیده شد، حدس زده نشد) ───
//
// ۱) «سود تقریبی» = درآمد خدماتی فروش خالص − اجرت پرداختی در خرید
//        = (اجرت + سود + کارمزد تبدیلِ فروش) − برگشتِ همان اجزا − (اجرت + کارمزدِ خرید)
//    بهای خودِ طلا پاس‌ترو در نظر گرفته می‌شود و وارد سود نمی‌شود.
//    چرا: تصمیمِ بازِ «روش بهای تمام‌شده» (موارد ۱۳، ۲۰، ۲۱ در DEVELOPMENT_STATUS)
//    هنوز قطعی نشده؛ این فرمول کاملاً از Snapshot اسناد درمی‌آید و به آن دست
//    نمی‌زند. مالیات وارد سود نمی‌شود (پول دولت است، نه ما) و تخفیف هم نه، چون
//    تخفیف روی کل فاکتور سرشکن می‌شود و انتساب سهم آن به اجرت یک حدس است.
//    محدودیت صریح: نوسان قیمت طلا در این عدد دیده نمی‌شود — برچسب «تقریبی» و
//    یادداشت کارت همین را به کاربر می‌گوید.
//
// ۲) «میانگین اجرت» = کل اجرت فروش خالص ÷ کل وزن فروش خالص (ریال بر گرم).
//    با هر دو نوع اجرت (درصدی و مبلغی) کار می‌کند و بین ماه‌ها قابل مقایسه است.
//
// ─── سهم برگشتی هر جزء ───
// قلم برگشت فقط `amountIRR` کل دارد، نه تفکیک اجرت/سود. سهم هر جزء **به نسبت وزن
// همان قلم در فاکتور اصلی** حساب می‌شود (`saleLineIndex` این ارجاع را می‌دهد).
// برگشتِ کاملِ یک قلم دقیقاً ۱۰۰٪ اجزای آن را برمی‌گرداند؛ برگشت نیمی از وزن، نیمی
// از اجرت. جایگزینِ ساده‌تر — کسرِ کلِ مبلغ برگشت از سود — بهای طلا را هم از سود کم
// می‌کرد و سود را بی‌دلیل منفی نشان می‌داد.
// ═══════════════════════════════════════════════════════════════════════════

import { roundGrams, moneyBalanceMap, gramsBalanceMap } from './ledger.js';
import { roundBaseGrams, GRAM_EPS as BASE_GRAM_EPS } from './goldTotals.js';
import { listBuckets, grandTotal, totalsByType } from './inventory.js';
import { listAccounts, IRR_EPS, GRAM_EPS } from './accounts.js';
import { getDueAlerts } from './dueDates.js';
import { salesReports, purchaseReports } from './reports/invoiceReports.js';
import { presetRange, describeRange, dayKeyOf } from '../utils/dateRange.js';

/** بازه‌های قابل انتخاب داشبورد. همه تا «امروز» ادامه دارند، پس «امروز» همیشه درون بازه است. */
export const DASHBOARD_PERIODS = [
  { key: 'today', label: 'امروز', preset: 'today' },
  { key: 'thisMonth', label: 'ماه جاری', preset: 'thisMonth' },
  { key: 'thisYear', label: 'سال جاری', preset: 'thisYear' },
];

export const DEFAULT_PERIOD = 'thisMonth';

const PERIOD_BY_KEY = new Map(DASHBOARD_PERIODS.map((p) => [p.key, p]));

export function resolvePeriod(key) {
  return PERIOD_BY_KEY.get(key) || PERIOD_BY_KEY.get(DEFAULT_PERIOD);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** صفر منفی ⇒ صفر (همان دلیل normalizeZero در ledger.js). */
function nz(n) {
  return n === 0 ? 0 : n;
}

// ───────────────────────── انباشتگر اقلام سند ─────────────────────────

function emptyAgg() {
  return {
    docIds: new Set(),
    returnIds: new Set(),
    grossIRR: 0,
    grossWeightGrams: 0,
    grossWageIRR: 0,
    grossServiceIRR: 0,
    returnIRR: 0,
    returnWeightGrams: 0,
    returnWageIRR: 0,
    returnServiceIRR: 0,
  };
}

function addDoc(agg, doc) {
  agg.docIds.add(doc.id);
  for (const line of doc.lines || []) {
    agg.grossIRR += num(line.lineTotalIRR);
    agg.grossWeightGrams += num(line.weightGrams);
    agg.grossWageIRR += num(line.wageIRR);
    agg.grossServiceIRR += num(line.wageIRR) + num(line.profitIRR) + num(line.meltFeeIRR);
  }
}

function addReturn(agg, ret, sale) {
  agg.returnIds.add(ret.id);
  for (const line of ret.lines || []) {
    agg.returnIRR += num(line.amountIRR);
    agg.returnWeightGrams += num(line.weightGrams);

    const source = sale?.lines?.[line.saleLineIndex];
    if (!source) continue; // فاکتور مبدأ در دسترس نیست: مبلغ برگشت شمرده شد، اجزا نه.
    const sourceWeight = num(source.weightGrams);
    if (sourceWeight <= GRAM_EPS) continue;
    const fraction = Math.min(1, num(line.weightGrams) / sourceWeight);
    agg.returnWageIRR += fraction * num(source.wageIRR);
    agg.returnServiceIRR += fraction * (num(source.wageIRR) + num(source.profitIRR) + num(source.meltFeeIRR));
  }
}

function finalizeAgg(agg) {
  const netWeightGrams = roundGrams(agg.grossWeightGrams - agg.returnWeightGrams);
  const netWageIRR = Math.round(agg.grossWageIRR - agg.returnWageIRR);
  return {
    count: agg.docIds.size,
    returnCount: agg.returnIds.size,
    grossIRR: nz(Math.round(agg.grossIRR)),
    returnIRR: nz(Math.round(agg.returnIRR)),
    netIRR: nz(Math.round(agg.grossIRR - agg.returnIRR)),
    grossWeightGrams: roundGrams(agg.grossWeightGrams),
    returnWeightGrams: roundGrams(agg.returnWeightGrams),
    netWeightGrams,
    netWageIRR: nz(netWageIRR),
    netServiceIRR: nz(Math.round(agg.grossServiceIRR - agg.returnServiceIRR)),
    // ریال بر گرم. وزن صفر ⇒ null (نه صفر): «اجرتی نبوده» با «میانگین صفر» یکی نیست.
    avgWagePerGramIRR: netWeightGrams > GRAM_EPS ? Math.round(netWageIRR / netWeightGrams) : null,
  };
}

/**
 * یک بار پیمایش اقلام، دو سبد: کل بازه و «امروز».
 * چون همه‌ی بازه‌های داشبورد تا امروز ادامه دارند، امروز همیشه زیرمجموعه‌ی بازه است
 * و این کار یک بار خواندن کامل دیتابیس را صرفه‌جویی می‌کند.
 */
function splitByToday(data, todayKey) {
  const period = emptyAgg();
  const today = emptyAgg();

  for (const doc of data.docs) {
    addDoc(period, doc);
    if (dayKeyOf(doc.date) === todayKey) addDoc(today, doc);
  }
  for (const ret of data.returns) {
    const sale = data.docById.get(ret.saleId) || null;
    addReturn(period, ret, sale);
    if (dayKeyOf(ret.date) === todayKey) addReturn(today, ret, sale);
  }

  return { period: finalizeAgg(period), today: finalizeAgg(today) };
}

// ───────────────────────── مانده‌ی طرف‌های حساب ─────────────────────────

/**
 * جمع دو طرفِ یک نگاشت مانده. برای مشتری علامت +۱ و برای تأمین‌کننده −۱ پیش‌تر در
 * `moneyBalanceMap` اعمال شده، پس در هر دو حالت «مثبت» یعنی همان چیزی که کارت
 * نشان می‌دهد (طلب ما / بدهی ما) و «منفی» طرف مقابل آن است.
 */
/** همتای گرمی sumBalances — همان قاعده، واحد رسمی (Phase 19). */
function sumGramBalances(map) {
  let positiveGrams = 0;
  let negativeGrams = 0;
  for (const balance of map.values()) {
    if (balance > BASE_GRAM_EPS) positiveGrams += balance;
    else if (balance < -BASE_GRAM_EPS) negativeGrams -= balance;
  }
  return {
    positiveGrams: roundBaseGrams(positiveGrams),
    negativeGrams: roundBaseGrams(negativeGrams),
    netGrams: roundBaseGrams(positiveGrams - negativeGrams),
  };
}

function sumBalances(map) {
  let positiveIRR = 0;
  let negativeIRR = 0;
  let positiveParties = 0;
  let negativeParties = 0;
  for (const balance of map.values()) {
    if (balance > IRR_EPS) {
      positiveIRR += balance;
      positiveParties += 1;
    } else if (balance < -IRR_EPS) {
      negativeIRR -= balance;
      negativeParties += 1;
    }
  }
  return {
    positiveIRR: nz(Math.round(positiveIRR)),
    negativeIRR: nz(Math.round(negativeIRR)),
    netIRR: nz(Math.round(positiveIRR - negativeIRR)),
    positiveParties,
    negativeParties,
  };
}

// ───────────────────────────── نقطه‌ی ورود ─────────────────────────────

/**
 * تمام اعداد داشبورد در یک بار خواندن.
 *
 * @param {object} options
 * @param {string} options.period کلید بازه (`today` | `thisMonth` | `thisYear`)
 * @param {Date} options.today «امروز» (تست‌پذیری؛ پیش‌فرض لحظه‌ی فراخوانی)
 */
export async function getDashboard({ period = DEFAULT_PERIOD, today = new Date() } = {}) {
  const def = resolvePeriod(period);
  const range = presetRange(def.preset, today);
  const todayKey = dayKeyOf(today);

  const [salesData, purchaseData, buckets, accounts, customerMap, supplierMap, alerts] = await Promise.all([
    salesReports.rawData(range),
    purchaseReports.rawData(range),
    listBuckets(),
    listAccounts({ status: 'active' }),
    moneyBalanceMap('customer'),
    moneyBalanceMap('supplier'),
    getDueAlerts({ today }),
  ]);
  // (Phase 19) واحد رسمی مطالبات و بدهی: گرم ۷۵۰ — عدد اصلی کارت‌ها.
  const [customerGramsMap, supplierGramsMap] = await Promise.all([
    gramsBalanceMap('customer'),
    gramsBalanceMap('supplier'),
  ]);

  const sales = splitByToday(salesData, todayKey);
  const purchases = splitByToday(purchaseData, todayKey);

  const inventoryTotal = grandTotal(buckets);
  const byType = totalsByType(buckets);

  // سود تقریبی = درآمد خدماتی فروش خالص − اجرت و کارمزدِ پرداختیِ خرید (بالای فایل).
  const profitIRR = nz(sales.period.netServiceIRR - purchases.period.netServiceIRR);
  const profitTodayIRR = nz(sales.today.netServiceIRR - purchases.today.netServiceIRR);

  const receivables = { ...sumBalances(customerMap), ...sumGramBalances(customerGramsMap) };
  const payables = { ...sumBalances(supplierMap), ...sumGramBalances(supplierGramsMap) };

  const cashTotalIRR = nz(Math.round(accounts.reduce((s, a) => s + num(a.balance), 0)));

  return {
    generatedAt: new Date(today).toISOString(),
    period: { key: def.key, label: def.label, range, rangeLabel: describeRange(range) },

    inventory: {
      totalGrams: roundGrams(inventoryTotal.grams),
      marketValueIRR: nz(Math.round(inventoryTotal.marketValueIRR)),
      bookValueIRR: nz(Math.round(inventoryTotal.bookValueIRR)),
      unrealizedIRR: nz(Math.round(inventoryTotal.unrealizedIRR)),
      bucketCount: inventoryTotal.buckets,
      byType: byType.map((t) => ({
        goldType: t.goldType,
        label: t.label,
        grams: roundGrams(t.grams),
        marketValueIRR: nz(Math.round(t.marketValueIRR)),
        buckets: t.buckets,
      })),
    },

    sales,
    purchases,

    profit: {
      periodIRR: profitIRR,
      todayIRR: profitTodayIRR,
      salesServiceIRR: sales.period.netServiceIRR,
      purchaseServiceIRR: purchases.period.netServiceIRR,
    },

    wage: {
      avgPerGramIRR: sales.period.avgWagePerGramIRR,
      totalIRR: sales.period.netWageIRR,
      weightGrams: sales.period.netWeightGrams,
    },

    receivables,
    payables,

    cash: {
      totalIRR: cashTotalIRR,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        balanceIRR: nz(Math.round(num(a.balance))),
      })),
    },

    due: {
      nearDays: alerts.nearDays,
      overdueCount: alerts.overdue.length,
      todayCount: alerts.today.length,
      nearCount: alerts.near.length,
      alertCount: alerts.count,
      receivableIRR: nz(Math.round(alerts.summary.total.receivableIRR)),
      payableIRR: nz(Math.round(alerts.summary.total.payableIRR)),
      receivableGrams: roundBaseGrams(alerts.summary.total.receivableGrams),
      payableGrams: roundBaseGrams(alerts.summary.total.payableGrams),
      overdueIRR: nz(
        Math.round(
          alerts.overdue.reduce((s, it) => s + num(it.remainingIRR), 0)
        )
      ),
    },
  };
}
