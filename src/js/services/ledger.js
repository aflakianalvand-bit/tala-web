// ledger.js — لایه‌ی «خواندنِ» دفاتر (Gold Ledger / Money Ledger) و اشتقاق مانده‌ها
//
// ═══════════════════════════════════════════════════════════════════════════
// اصل بنیادین (ACCOUNTING_RULES.md §3 و PROJECT INSTRUCTIONS §20):
// هیچ مانده‌ای هرگز روی رکورد مشتری/تأمین‌کننده/حساب ذخیره نمی‌شود.
// مانده *همیشه* در لحظه از روی رکوردهای Ledger محاسبه می‌شود.
// این فایل تنها مرجع مجاز برای محاسبه‌ی مانده در کل برنامه است — هیچ صفحه/سرویس
// دیگری نباید فرمول Debit/Credit را دوباره پیاده‌سازی کند.
// ═══════════════════════════════════════════════════════════════════════════
//
// این فایل فقط Read است. نوشتن در دفاتر (ایجاد Transaction + رکوردهای Ledger)
// در Phase 10 (موتور موجودی) و Phase 11 (دریافت/پرداخت/تسویه) اضافه می‌شود.

import { GRAM_EPS as GRAM_EPS_750 } from './units.js';
import { getAll, getByIndex } from '../db/repo.js';
import { roundBaseGrams, isZeroGrams } from './goldTotals.js';

/** جهت مانده هر نوع طرف حساب (ACCOUNTING_RULES.md §2). */
export const BALANCE_SIGN = {
  // مشتری: بدهی او به ما با Debit زیاد می‌شود ⇒ مانده = Debit − Credit
  customer: +1,
  // تأمین‌کننده: طلب او از ما با Credit زیاد می‌شود ⇒ مانده = Credit − Debit
  supplier: -1,
  // صندوق/بانک/کارتخوان: موجودی با Debit زیاد می‌شود ⇒ مانده = Debit − Credit
  account: +1,
  // (Phase 6) موجودی طلا به‌عنوان یک «دارایی» در دفتر وجه: بهای تمام‌شده با Debit
  // زیاد می‌شود. این طرفِ متقابلِ بدهی تأمین‌کننده در سند خرید است و بدون آن،
  // تراز آزمایشی (ACCOUNTING_RULES §7) هرگز برقرار نمی‌شد.
  inventory: +1,
  // (Phase 9) طرفِ مقابلِ واریز/برداشتِ بدون طرف حساب: دسته‌های سرمایه، برداشت شخصی،
  // هزینه، درآمد متفرقه و مانده ابتدای دوره (services/cashFlow.js). بدون این طرف، یک
  // واریز به صندوق فقط یک رکورد بدهکار می‌داشت و تراز §7 می‌شکست.
  // مانده مثبت = خالص خروج وجه از کسب‌وکار به این دسته (هزینه/برداشت)؛
  // مانده منفی = خالص ورود وجه از این دسته (سرمایه/درآمد).
  other: +1,
};

function sign(kind) {
  const s = BALANCE_SIGN[kind];
  if (s === undefined) throw new Error(`نوع طرف حساب نامعتبر است: ${kind}`);
  return s;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * صفر منفی (`-0`) را به صفر مثبت تبدیل می‌کند.
 * چرا لازم است: برای تأمین‌کننده علامت مانده −۱ است، پس `-1 * (0 - 0)` در جاوااسکریپت
 * `-0` می‌دهد. این مقدار در محاسبات بی‌ضرر است اما در JSON، مقایسه‌ی `Object.is`،
 * مرتب‌سازی و بعضی مسیرهای فرمت‌کردن می‌تواند به‌صورت «-۰» ظاهر شود.
 * (این مورد با تست تأمین‌کننده در Phase 5 کشف شد.)
 */
function normalizeZero(n) {
  return n === 0 ? 0 : n;
}

/**
 * وزن انباشته را به دقت مستندشده‌ی انبار (سه رقم اعشار = یک سوت) می‌نشاند.
 *
 * چرا لازم است (کشف‌شده در Phase 10): وزن‌ها در جاوااسکریپت `Number` جمع می‌شوند و
 * `19.6 + 9.85` عدد `29.450000000000003` می‌دهد. روی یک سند بی‌اثر است، ولی موجودی
 * انبار جمعِ *همه‌ی* رکوردهای تاریخ کسب‌وکار است؛ این خطاهای ریز انباشته می‌شوند و
 * دو پیامد واقعی دارند: سطلی که باید دقیقاً صفر شده باشد «۰٫۰۰۰۰۰۰۰۰۰۰۰۰۳ گرم» نشان
 * می‌دهد، و مقایسه‌ی موجودی با وزن درخواستی می‌تواند یک هشدار کاذب کمبود بسازد.
 * INVENTORY_RULES §۱ از Phase 0 گفته بود موجودی با «دقت اعشاری حداقل ۳ رقم» نگهداری
 * می‌شود؛ این تابع همان قاعده را در نقطه‌ی اشتقاق اعمال می‌کند.
 * (تمام وزن‌های ورودی پیش‌تر به گام ۰٫۰۵ گرم گِرد شده‌اند، پس این گِردکردن هیچ‌وقت
 * داده‌ی واقعی را تغییر نمی‌دهد — فقط خطای نمایش ممیز شناور را پاک می‌کند.)
 */
export function roundGrams(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 1000) / 1000;
  return r === 0 ? 0 : r;
}

// ─────────────────────────── خواندن رکوردهای دفتر ───────────────────────────

/**
 * تمام رکوردهای Money Ledger مربوط به یک طرف حساب.
 * از Index مرکب [accountRef.kind + accountRef.id] استفاده می‌کند (DATABASE_SCHEMA §3.10).
 */
export async function moneyEntriesFor(kind, id) {
  if (!id) return [];
  return getByIndex('moneyLedger', 'accountRef', [kind, id]);
}

/** تمام رکوردهای Gold Ledger مربوط به یک طرف حساب. */
export async function goldEntriesFor(kind, id) {
  if (!id) return [];
  return getByIndex('goldLedger', 'accountRef', [kind, id]);
}

// ─────────────────────────────── محاسبه مانده ───────────────────────────────

/** جمع خام Debit/Credit یک مجموعه رکورد Money Ledger. */
export function sumMoney(entries) {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    debit += num(e.debit);
    credit += num(e.credit);
  }
  return { debit, credit };
}

/** جمع خام وزن ورودی/خروجی یک مجموعه رکورد Gold Ledger. */
export function sumGold(entries) {
  let inGrams = 0;
  let outGrams = 0;
  for (const e of entries) {
    const w = num(e.weightGrams);
    if (e.direction === 'IN') inGrams += w;
    else if (e.direction === 'OUT') outGrams += w;
  }
  return { inGrams: roundGrams(inGrams), outGrams: roundGrams(outGrams) };
}

/**
 * مانده وجهی یک طرف حساب — مشتق‌شده، هرگز ذخیره‌شده.
 * @returns {Promise<{debit:number, credit:number, balance:number}>}
 *   balance برای customer/account مثبت = بدهکار به ما / موجودی مثبت.
 *   balance برای supplier مثبت = ما به او بدهکاریم.
 */
export async function moneyBalanceOf(kind, id) {
  const { debit, credit } = sumMoney(await moneyEntriesFor(kind, id));
  return { debit, credit, balance: normalizeZero(sign(kind) * (debit - credit)) };
}

/**
 * مانده طلای یک طرف حساب (گرم) — مشتق‌شده.
 * مثبت برای مشتری یعنی مشتری به ما طلا بدهکار است (طلای بیشتری از ما خارج شده تا وارد).
 *
 * توجه: این تابع فقط برای **طرف حساب** است، نه انبار. برای موجودی انبار از
 * inventoryGramsOf()/inventoryBalances() استفاده کنید — جهت‌شان معکوس است
 * (ورود طلا موجودی انبار را زیاد می‌کند، ولی خروج طلا طرف مقابل را بدهکار می‌کند).
 */
export async function goldBalanceOf(kind, id) {
  if (kind === 'inventory') {
    throw new Error('برای موجودی انبار از inventoryGramsOf() استفاده کنید، نه goldBalanceOf().');
  }
  const { inGrams, outGrams } = sumGold(await goldEntriesFor(kind, id));
  return { inGrams, outGrams, grams: roundGrams(sign(kind) * (outGrams - inGrams)) };
}

// ───────── مانده‌ی رسمی طرف حساب به «گرم ۷۵۰» (Phase 19) ─────────
//
// از Phase 19 واحد حساب طرف مقابل گرم است، نه ریال. همان رکوردهای moneyLedger
// دو مقدار دارند (`debit/credit` ریالی و `debitGrams/creditGrams` گرمی)، پس
// **یک** منبع و **یک** فرمول باقی می‌ماند و هیچ‌وقت دو عدد برای یک بدهی ساخته
// نمی‌شود. سندی که فی ندارد فقط مقدار گرمی دارد؛ مانده‌ی گرمی او کامل و درست
// است، حتی اگر مانده‌ی ریالی‌اش صفر باشد.

/** جمع خام بدهکار/بستانکار گرمی یک مجموعه رکورد Money Ledger. */
export function sumMoneyGrams(entries) {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    debit += num(e.debitGrams);
    credit += num(e.creditGrams);
  }
  return { debit: roundBaseGrams(debit), credit: roundBaseGrams(credit) };
}

/**
 * مانده‌ی گرمی یک طرف حساب (گرم ۷۵۰) — مشتق‌شده، هرگز ذخیره‌شده.
 * جهت علامت دقیقاً همان BALANCE_SIGN مانده‌ی ریالی است، پس «بدهکار/بستانکار»
 * در هر دو واحد یک معنا دارد.
 */
export async function gramsBalanceOf(kind, id) {
  const { debit, credit } = sumMoneyGrams(await moneyEntriesFor(kind, id));
  const balance = roundBaseGrams(sign(kind) * (debit - credit));
  return { debit, credit, grams: isZeroGrams(balance) ? 0 : balance };
}

/** مانده‌ی گرمی همه‌ی طرف‌های یک نوع با یک بار خواندن دفتر. */
export async function gramsBalanceMap(kind) {
  const s = sign(kind);
  const all = await getAll('moneyLedger');
  const map = new Map();
  for (const e of all) {
    if (e?.accountRef?.kind !== kind) continue;
    const id = e.accountRef.id;
    const prev = map.get(id) || 0;
    map.set(id, roundBaseGrams(prev + s * (num(e.debitGrams) - num(e.creditGrams))));
  }
  return map;
}

/** گردش گرمی یک طرف حساب با مانده‌ی تجمعی (همتای moneyStatement). */
export async function gramsStatement(kind, id) {
  const s = sign(kind);
  const entries = (await moneyEntriesFor(kind, id)).slice().sort(sortByDateThenId);

  let running = 0;
  const rows = entries.map((e) => {
    const delta = roundBaseGrams(s * (num(e.debitGrams) - num(e.creditGrams)));
    running = roundBaseGrams(running + delta);
    return {
      id: e.id,
      date: e.date,
      reason: e.reason,
      debitGrams: num(e.debitGrams),
      creditGrams: num(e.creditGrams),
      debit: num(e.debit),
      credit: num(e.credit),
      delta,
      balance: running,
      transactionId: e.transactionId,
    };
  });

  return { rows, closing: roundBaseGrams(running) };
}

/**
 * مانده‌ی ابتدا/گردش/پایانِ گرمی همه‌ی طرف‌های یک نوع (همتای moneyPeriodMap).
 * برای گزارش‌های Phase 14 که حالا باید عدد گرمی هم نشان دهند.
 */
export async function gramsPeriodMap(kind, phaseOf) {
  const s = sign(kind);
  const rows = new Map();
  let skipped = 0;
  for (const e of await getAll('moneyLedger')) {
    if (e?.accountRef?.kind !== kind) continue;
    const phase = phaseOf(e);
    if (phase === 'after') continue;
    if (phase !== 'before' && phase !== 'in') {
      skipped += 1;
      continue;
    }
    const id = e.accountRef.id;
    const row = rows.get(id) || emptyPeriod(id);
    const delta = s * (num(e.debitGrams) - num(e.creditGrams));
    if (phase === 'before') {
      row.opening = roundBaseGrams(row.opening + delta);
    } else {
      row.debit = roundBaseGrams(row.debit + num(e.debitGrams));
      row.credit = roundBaseGrams(row.credit + num(e.creditGrams));
      row.entries += 1;
      if (s > 0) {
        row.increase = roundBaseGrams(row.increase + num(e.debitGrams));
        row.decrease = roundBaseGrams(row.decrease + num(e.creditGrams));
      } else {
        row.increase = roundBaseGrams(row.increase + num(e.creditGrams));
        row.decrease = roundBaseGrams(row.decrease + num(e.debitGrams));
      }
    }
    row.closing = roundBaseGrams(row.closing + delta);
    rows.set(id, row);
  }
  return { rows, skipped };
}

/** تراز آزمایشی گرمی کل دفتر (همتای moneyTrialBalance). */
export async function gramsTrialBalance() {
  const { debit, credit } = sumMoneyGrams(await getAll('moneyLedger'));
  return { debit, credit, balanced: Math.abs(debit - credit) < GRAM_EPS_750 };
}

// ───────────────────────── موجودی انبار طلا (Phase 6) ─────────────────────────
//
// موجودی طلا در «سطل»های مستقل نگهداری می‌شود (INVENTORY_RULES §2). شناسه‌ی هر سطل:
//   کالای مشخص (ساخته‌شده با کد کالا) → `product:<productId>`
//   بدون کالا (آبشده/متفرقه یا ساخته‌شده‌ی بدون کد) → `<goldType>:<karat>`
// موتور کامل موجودی در Phase 10 ساخته می‌شود؛ آنچه اینجاست حداقلِ لازم برای
// بررسی کفایت موجودی هنگام «پرداخت با طلا» در Phase 6 است و همان فرمول
// INVENTORY_RULES را پیاده می‌کند (نه یک محاسبه‌ی موازی).

/** شناسه‌ی سطل موجودی برای یک ترکیب کالا/نوع/عیار. */
export function inventoryRefId({ goldType, karat, productId = null }) {
  return productId ? `product:${productId}` : `${goldType}:${Number(karat)}`;
}

/** موجودی یک سطل انبار به گرم: Σ ورودی − Σ خروجی (INVENTORY_RULES §3). */
export async function inventoryGramsOf(refId) {
  const entries = await getByIndex('goldLedger', 'accountRef', ['inventory', refId]);
  const { inGrams, outGrams } = sumGold(entries);
  return { inGrams, outGrams, grams: roundGrams(inGrams - outGrams) };
}

/** موجودی همه‌ی سطل‌ها با یک بار خواندن دفتر — Map<refId, {grams, goldType, karat, productId}>. */
export async function inventoryBalances() {
  const all = await getAll('goldLedger');
  const map = new Map();
  for (const e of all) {
    if (e?.accountRef?.kind !== 'inventory') continue;
    const refId = e.accountRef.id;
    const bucket = map.get(refId) || {
      refId,
      goldType: e.goldType,
      karat: e.karat,
      productId: e.productId || null,
      grams: 0,
    };
    bucket.grams = roundGrams(bucket.grams + (e.direction === 'IN' ? num(e.weightGrams) : -num(e.weightGrams)));
    map.set(refId, bucket);
  }
  return map;
}

/**
 * گردش یک سطل انبار طلا با مانده تجمعی (Phase 9).
 *
 * چرا تابع مستقل و نه `goldStatement('inventory', refId)`: جهت مانده‌ی انبار **معکوسِ**
 * جهت مانده‌ی طرف حساب است — ورود طلا موجودی انبار را زیاد می‌کند، ولی خروج طلا طرف
 * مقابل را بدهکار می‌کند. `goldBalanceOf('inventory', …)` به همین دلیل عمداً خطا می‌دهد،
 * و این تابع همتای درستِ آن برای انبار است.
 */
export async function inventoryStatement(refId) {
  const entries = (await getByIndex('goldLedger', 'accountRef', ['inventory', refId]))
    .slice()
    .sort(sortByDateThenId);

  let running = 0;
  const rows = entries.map((e) => {
    const w = num(e.weightGrams);
    const delta = roundGrams(e.direction === 'IN' ? w : -w);
    running = roundGrams(running + delta);
    return {
      id: e.id,
      date: e.date,
      reason: e.reason,
      direction: e.direction,
      goldType: e.goldType,
      karat: e.karat,
      productId: e.productId || null,
      weightGrams: w,
      delta,
      balance: running,
      transactionId: e.transactionId,
    };
  });

  return { rows, closing: roundGrams(running) };
}

/**
 * مانده وجهی *همه‌ی* طرف‌های یک نوع، با یک بار خواندن کل دفتر.
 * برای صفحه‌ی لیست استفاده می‌شود تا به‌جای N کوئری، یک کوئری بزنیم.
 * @returns {Promise<Map<string, number>>} نگاشت partyId → مانده
 */
export async function moneyBalanceMap(kind) {
  const s = sign(kind);
  const all = await getAll('moneyLedger');
  const map = new Map();
  for (const e of all) {
    if (e?.accountRef?.kind !== kind) continue;
    const id = e.accountRef.id;
    const prev = map.get(id) || 0;
    map.set(id, normalizeZero(prev + s * (num(e.debit) - num(e.credit))));
  }
  return map;
}

/** نسخه‌ی طلا از moneyBalanceMap (گرم). */
export async function goldBalanceMap(kind) {
  const s = sign(kind);
  const all = await getAll('goldLedger');
  const map = new Map();
  for (const e of all) {
    if (e?.accountRef?.kind !== kind) continue;
    const id = e.accountRef.id;
    const w = num(e.weightGrams);
    const delta = e.direction === 'OUT' ? w : -w;
    map.set(id, roundGrams((map.get(id) || 0) + s * delta));
  }
  return map;
}

// ────────────────────── مانده‌ی دوره‌ای (Phase 14 — گزارش‌ها) ──────────────────────
//
// گزارش‌ها مانده را «در یک تاریخ» و گردش را «در یک بازه» می‌خواهند. به‌جای آنکه هر
// گزارش فرمول Debit/Credit را دوباره بنویسد (ممنوع — بالای همین فایل)، این توابع
// همان فرمول‌های بالا را با یک تابع `phaseOf(entry)` تقسیم می‌کنند:
//   'before' ⇒ مانده‌ی ابتدای دوره  |  'in' ⇒ گردش دوره  |  'after' ⇒ نادیده
//   null     ⇒ تاریخ نامعتبر؛ جمع زده نمی‌شود ولی شمرده می‌شود (`skipped`) تا پنهان نماند.
// تضمین: opening + increase − decrease = closing، و بدون بازه closing = moneyBalanceOf().

function emptyPeriod(id) {
  return { id, opening: 0, debit: 0, credit: 0, increase: 0, decrease: 0, closing: 0, entries: 0 };
}

/**
 * مانده‌ی ابتدا/گردش/مانده‌ی پایان وجهی همه‌ی طرف‌های یک نوع — با یک بار خواندن دفتر.
 * `increase`/`decrease` جهت‌دار است: برای مشتری افزایش = بدهکار، برای تأمین‌کننده
 * افزایش = بستانکار (همان BALANCE_SIGN).
 * @returns {Promise<{rows: Map<string, object>, skipped: number}>}
 */
export async function moneyPeriodMap(kind, phaseOf) {
  const s = sign(kind);
  const rows = new Map();
  let skipped = 0;
  for (const e of await getAll('moneyLedger')) {
    if (e?.accountRef?.kind !== kind) continue;
    const phase = phaseOf(e);
    if (phase === 'after') continue;
    if (phase !== 'before' && phase !== 'in') {
      skipped += 1;
      continue;
    }
    const id = e.accountRef.id;
    const row = rows.get(id) || emptyPeriod(id);
    const delta = s * (num(e.debit) - num(e.credit));
    if (phase === 'before') {
      row.opening = normalizeZero(row.opening + delta);
    } else {
      row.debit += num(e.debit);
      row.credit += num(e.credit);
      row.entries += 1;
      if (s > 0) {
        row.increase += num(e.debit);
        row.decrease += num(e.credit);
      } else {
        row.increase += num(e.credit);
        row.decrease += num(e.debit);
      }
    }
    row.closing = normalizeZero(row.closing + delta);
    rows.set(id, row);
  }
  return { rows, skipped };
}

/**
 * همتای طلایی moneyPeriodMap (گرم). برای طرف حساب همان جهت goldBalanceOf()، و برای
 * `kind='inventory'` جهت انبار (ورود = افزایش) — همان تفاوتی که inventoryBalances()
 * و goldBalanceOf() دارند. رکوردهای انبار علاوه بر مانده، نوع/عیار/کالای سطل را هم دارند.
 */
export async function goldPeriodMap(kind, phaseOf) {
  const inventory = kind === 'inventory';
  const s = inventory ? 1 : sign(kind);
  const rows = new Map();
  let skipped = 0;
  for (const e of await getAll('goldLedger')) {
    if (e?.accountRef?.kind !== kind) continue;
    const phase = phaseOf(e);
    if (phase === 'after') continue;
    if (phase !== 'before' && phase !== 'in') {
      skipped += 1;
      continue;
    }
    const id = e.accountRef.id;
    const row = rows.get(id) || {
      ...emptyPeriod(id),
      inGrams: 0,
      outGrams: 0,
      goldType: e.goldType,
      karat: e.karat,
      productId: e.productId || null,
    };
    const w = num(e.weightGrams);
    // انبار: ورود مثبت. طرف حساب: خروج از ما به او ⇒ بدهکار (goldBalanceOf).
    const delta = inventory ? (e.direction === 'IN' ? w : -w) : s * (e.direction === 'OUT' ? w : -w);
    if (phase === 'before') {
      row.opening = roundGrams(row.opening + delta);
    } else {
      if (e.direction === 'IN') row.inGrams = roundGrams(row.inGrams + w);
      else row.outGrams = roundGrams(row.outGrams + w);
      if (delta >= 0) row.increase = roundGrams(row.increase + delta);
      else row.decrease = roundGrams(row.decrease - delta);
      row.entries += 1;
    }
    row.closing = roundGrams(row.closing + delta);
    rows.set(id, row);
  }
  return { rows, skipped };
}

/**
 * برش یک گردش (خروجی moneyStatement / goldStatement / inventoryStatement) به یک بازه.
 * مانده‌ی تجمعی ردیف‌ها دست نمی‌خورد — همان عددی است که ledger حساب کرده — و
 * مانده‌ی ابتدای دوره، مانده‌ی آخرین ردیفِ پیش از بازه است.
 */
export function sliceStatement(statement, phaseOf, round = normalizeZero) {
  let opening = 0;
  let closing = 0;
  let skipped = 0;
  const rows = [];
  for (const row of statement.rows) {
    const phase = phaseOf(row);
    if (phase === 'after') continue;
    if (phase === 'before') {
      opening = row.balance;
      closing = row.balance;
    } else if (phase === 'in') {
      rows.push(row);
      closing = row.balance;
    } else {
      // تاریخ نامعتبر: مانده‌ی تجمعی این ردیف را در بر دارد ولی در هیچ دوره‌ای نمی‌نشیند.
      skipped += 1;
    }
  }
  return { opening: round(opening), rows, closing: round(closing), skipped };
}

// ────────────────────────── گردش حساب (Statement) ──────────────────────────

/**
 * گردش حساب وجهی یک طرف: رکوردها به ترتیب تاریخ + مانده تجمعی (Running Balance).
 * مانده‌ی نهایی این خروجی دقیقاً برابر moneyBalanceOf() است (هر دو از یک منبع می‌آیند).
 * @returns {Promise<{rows: Array, closing: number}>}
 */
export async function moneyStatement(kind, id) {
  const s = sign(kind);
  const entries = (await moneyEntriesFor(kind, id)).slice().sort(sortByDateThenId);

  let running = 0;
  const rows = entries.map((e) => {
    const delta = normalizeZero(s * (num(e.debit) - num(e.credit)));
    running = normalizeZero(running + delta);
    return {
      id: e.id,
      date: e.date,
      reason: e.reason,
      debit: num(e.debit),
      credit: num(e.credit),
      delta,
      balance: running,
      transactionId: e.transactionId,
    };
  });

  return { rows, closing: normalizeZero(running) };
}

/** گردش طلای یک طرف (گرم) با مانده تجمعی. */
export async function goldStatement(kind, id) {
  const s = sign(kind);
  const entries = (await goldEntriesFor(kind, id)).slice().sort(sortByDateThenId);

  let running = 0;
  const rows = entries.map((e) => {
    const w = num(e.weightGrams);
    const delta = roundGrams(s * (e.direction === 'OUT' ? w : -w));
    running = roundGrams(running + delta);
    return {
      id: e.id,
      date: e.date,
      reason: e.reason,
      direction: e.direction,
      goldType: e.goldType,
      karat: e.karat,
      weightGrams: w,
      delta,
      balance: running,
      transactionId: e.transactionId,
    };
  });

  return { rows, closing: normalizeZero(running) };
}

function sortByDateThenId(a, b) {
  const d = String(a.date || '').localeCompare(String(b.date || ''));
  if (d !== 0) return d;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

// ───────────────────────────── صحت‌سنجی (Audit) ─────────────────────────────

/**
 * تراز آزمایشی وجهی (ACCOUNTING_RULES.md §7): مجموع Debit کل دفتر باید برابر مجموع Credit باشد.
 * ابزار Audit کامل در Phase 17 روی همین تابع بنا می‌شود.
 */
export async function moneyTrialBalance() {
  const { debit, credit } = sumMoney(await getAll('moneyLedger'));
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.5 };
}
