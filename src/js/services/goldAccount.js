// goldAccount.js — حساب طلایی طرف حساب (گرم عیار پایه) — Phase 18
//
// ═══════════════════════════════════════════════════════════════════════════
// این فایل **فقط‌خواندنی** است و هیچ رکوردی نمی‌نویسد. کارش یکی است: هر سندی
// که بین ما و یک طرف حساب رد و بدل شده را به یک عدد گرمیِ علامت‌دار تبدیل کند،
// تا «مانده قبل / این سند / نهایی» روی برگه دقیقاً مثل نمونه ساخته شود.
//
// قرارداد علامت (یک محور، نه دو تا):
//     + یعنی طرف حساب **بدهکار** است («بد» روی برگه)
//     − یعنی طرف حساب **بستانکار** است («بس» روی برگه)
//
//     فروش            → +  (کالا رفت، مشتری بدهکار شد)
//     برگشت از فروش   → −
//     دریافت از مشتری → −
//     خرید            → −  (کالا آمد، ما به تأمین‌کننده بدهکار شدیم)
//     پرداخت به تأمین‌کننده → +
//
// چرا یک محور و نه دو ستون جدا: نمونه‌ی کاربر یک مانده‌ی واحد دارد که فقط
// برچسبش عوض می‌شود. دو عدد مستقل یعنی جایی که این دو با هم نخوانند و
// نرم‌افزار دو حقیقت داشته باشد — دقیقاً چیزی که دستور پروژه §۲۰ منع کرده.
//
// نکته‌ی مهم درباره‌ی دوباره‌شماری: دریافت/پرداختی که **داخل** یک فاکتور ثبت
// شده (`source !== 'settlement'`) جزو همان فاکتور شمرده می‌شود، نه یک سند
// مستقل. اگر هر دو شمرده می‌شدند، هر فاکتور نقدی دو بار از مانده کم می‌شد.
// ═══════════════════════════════════════════════════════════════════════════

import { get, getByIndex } from '../db/repo.js';
import {
  PARTY_MAP,
  partySettlementDocs,
  settlementDirectionOf,
  settlementStoreOf,
} from './allocations.js';
import { goldLineParts, goldSettlementParts, sheetRateOf, sumGrams } from './goldEquivalent.js';
// Phase 22: هر سند با «پروفایل واحد» خودش خوانده می‌شود — سند قدیمی با عیار ۲۴تایی،
// پایه‌ی ۱۸ و دقت ۰٫۰۱؛ سند جدید با عیار هزاری، پایه‌ی ۷۵۰ و سه رقم (services/units.js).
import { unitsOf, karatMilleOf, normalizeGrams } from './units.js';

/** انواع سندی که برگه‌ی طلایی می‌گیرند. */
export const SHEET_KINDS = ['sale', 'purchase', 'settlement', 'saleReturn'];

export const KIND_LABELS = {
  sale: 'فاکتور فروش',
  purchase: 'سند خرید',
  settlement: 'سند تسویه',
  saleReturn: 'برگشت از فروش',
};

/** واژگان نمونه‌ی کاربر برای نوع طلا. */
export const SHEET_GOLD_LABELS = {
  manufactured: 'کارساخته',
  melted: 'آبشده',
  misc: 'متفرقه',
};

const KIND_STORE = {
  sale: 'sales',
  purchase: 'purchases',
  saleReturn: 'saleReturns',
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** «بد» / «بس» از روی علامت. صفر عمداً «بس» نیست — بی‌طرف است. */
export function sideOf(signedGrams) {
  if (signedGrams > 0) return 'debit';
  if (signedGrams < 0) return 'credit';
  return 'zero';
}

export const SIDE_LABELS = { debit: 'بد', credit: 'بس', zero: '' };

// ─────────────────────── تبدیل یک سند به ردیف‌های برگه ───────────────────────

/**
 * Phase 23 — یادداشت آزمایشگاه روی ردیف برگه: «آزمایشگاه X — وزن ۱۰٫۰۰۳ عیار ۷۴۰».
 * ستون وزن برگه معادل ۷۵۰ است؛ وزن ترازو و عیار برگه‌ی آزمایشگاه فقط در این یادداشت
 * می‌آیند تا مشتری عدد تحویلی خودش را هم ببیند. سند بدون آزمایشگاه دست نمی‌خورد.
 */
function labNote(entry, units) {
  if (!entry?.labName) return '';
  return `آزمایشگاه ${entry.labName} — وزن ${fa(Number(entry.weightGrams) || 0)} عیار ${fa(karatMilleOf(entry.karat, units))}`;
}

function joinNotes(...parts) {
  return parts.filter(Boolean).join('، ');
}

function lineTitle(line, verb, productName) {
  const type = SHEET_GOLD_LABELS[line.goldType] || '';
  const name = productName || line.description || '';
  return [verb, type, name].filter(Boolean).join(' ');
}

/**
 * ردیف‌های طلایی یک سند + مجموع‌ها + خالص علامت‌دار.
 *
 * @param {object} doc سند ذخیره‌شده
 * @param {'sale'|'purchase'|'settlement'|'saleReturn'} kind
 * @param {object} opts `{rate, units?, productNames: Map, accountNames: Map, settlementDocs}`
 */
export function docGoldRows(doc, kind, opts = {}) {
  const units = opts.units || unitsOf(doc);
  const baseMille = karatMilleOf(units.baseKarat, units);
  const rate = num(opts.rate);
  const productNames = opts.productNames || new Map();
  const accountNames = opts.accountNames || new Map();

  const rows = [];
  const summary = [];
  let needsRate = false;
  // خالص سند **از اجزا** حساب می‌شود، نه از جمع ردیف‌های جدول. دلیل: ردیف‌های
  // «مجموع … بدون درصد» عمداً همان وزن ردیف‌های بالا را دوباره نشان می‌دهند
  // (دقیقاً مثل نمونه)، پس جمع‌زدن جدول یعنی دوباره‌شماری کل وزن سند.
  let net = 0;

  // جهتِ پایه‌ی سند روی محور «+ = طرف حساب بدهکار»
  const docSign = kind === 'sale' ? 1 : -1; // خرید، برگشت و دریافت همگی منفی‌اند
  // فعل ورود/خروج از دید انبار ما
  const goodsVerb = kind === 'sale' ? 'خروج' : 'ورود';

  if (kind === 'sale' || kind === 'purchase') {
    const mode = kind === 'sale' ? 'sale' : 'purchase';
    const parts = (doc.lines || []).map((line) => goldLineParts(line, { rate, units, mode }));
    parts.forEach((p) => {
      if (p.needsRate) needsRate = true;
    });

    (doc.lines || []).forEach((line, i) => {
      const p = parts[i];
      net += docSign * p.totalGrams;
      const notes = [];
      if (p.wagePercent > 0) notes.push(`${fa(p.wagePercent)}درصد ${fa(p.wageGrams)}گرم`);
      else if (p.wageIsRial && p.wageGrams > 0) notes.push(`اجرت ${fa(p.wageGrams)}گرم`);
      rows.push({
        seq: rows.length + 1,
        description: lineTitle(line, goodsVerb, productNames.get(line.productId)),
        note: joinNotes(notes.join('، '), labNote(line, units)),
        karatMille: p.karatMille,
        grams: p.baseGrams,
        sign: docSign,
        ratePerGram: null,
        amountIRR: null,
      });
    });

    // ── ردیف‌های مجموع، دقیقاً به سبک نمونه ──
    const wageTotal = sumGrams(parts.map((p) => p.wageGrams));
    const wageCount = parts.filter((p) => p.wageGrams > 0).length;
    if (wageTotal > 0) {
      summary.push({
        description: `مجموع درصد طلایی [${fa(wageCount)} قلم]`,
        karatMille: baseMille,
        grams: wageTotal,
        sign: docSign,
      });
    }

    // مجموع وزن خام به تفکیک نوع طلا — «مجموع کارساخته بدون درصد»
    const byType = new Map();
    (doc.lines || []).forEach((line, i) => {
      const key = line.goldType || 'misc';
      byType.set(key, [...(byType.get(key) || []), parts[i].baseGrams]);
    });
    for (const [type, values] of byType) {
      summary.push({
        description: `مجموع ${SHEET_GOLD_LABELS[type] || type} بدون درصد`,
        karatMille: baseMille,
        grams: sumGrams(values),
        sign: docSign,
      });
    }

    pushIf(summary, 'مجموع کارمزد تبدیل', sumGrams(parts.map((p) => p.meltFeeGrams)), docSign, baseMille);
    pushIf(summary, 'مجموع سود', sumGrams(parts.map((p) => p.profitGrams)), docSign, baseMille);
    pushIf(summary, 'تخفیف', sumGrams(parts.map((p) => p.discountShareGrams)), -docSign, baseMille);
    pushIf(summary, 'مالیات', sumGrams(parts.map((p) => p.taxGrams)), docSign, baseMille);

    // ── تسویه‌ی داخل همین سند (دریافت‌های فاکتور / پرداخت‌های خرید) ──
    for (const entry of opts.embeddedSettlements || []) {
      const p = goldSettlementParts(entry, { rate, units: unitsOf(entry) });
      if (p.needsRate) needsRate = true;
      net += -docSign * p.totalGrams;
      rows.push({
        seq: rows.length + 1,
        description: p.isCash
          ? `${kind === 'sale' ? 'دریافت' : 'پرداخت'} نقدی ${accountNames.get(entry.accountId) || ''}`.trim()
          : lineTitle(entry, kind === 'sale' ? 'ورود' : 'خروج', productNames.get(entry.productId)),
        note: joinNotes(labNote(entry, unitsOf(entry)), entry.description || ''),
        karatMille: p.karatMille,
        grams: p.totalGrams,
        sign: -docSign,
        ratePerGram: p.isCash ? rate || null : num(entry.ratePerGram) || null,
        amountIRR: p.isCash ? p.amountIRR : null,
      });
    }
  } else if (kind === 'saleReturn') {
    (doc.lines || []).forEach((line) => {
      const p = goldLineParts(line, { rate, units, mode: 'sale' });
      if (p.needsRate) needsRate = true;
      net += docSign * p.totalGrams;
      rows.push({
        seq: rows.length + 1,
        description: lineTitle(line, 'ورود', productNames.get(line.productId)),
        note: 'برگشت از فروش',
        karatMille: p.karatMille,
        grams: p.baseGrams,
        sign: docSign,
        ratePerGram: null,
        amountIRR: null,
      });
    });
  } else if (kind === 'settlement') {
    // سند تسویه چندخطی است: هر خط یک رکورد مستقل در receipts/payments
    const batch = opts.settlementDocs || [doc];
    // Phase 22: جهت از خودِ سند (ورود به ما ⇒ طرف حساب بستانکار)، نه از نوع طرف حساب.
    const inbound = settlementDirectionOf(doc) === 'in';
    for (const entry of batch) {
      if (entry.status === 'voided') continue;
      if (entry.method === 'discount') {
        const p = goldSettlementParts({ method: 'cash', valueIRR: entry.valueIRR }, { rate, units: unitsOf(entry) });
        if (p.needsRate) needsRate = true;
        net += (inbound ? -1 : 1) * p.totalGrams;
        rows.push({
          seq: rows.length + 1,
          description: 'تخفیف تسویه',
          note: entry.description || '',
          karatMille: p.karatMille,
          grams: p.totalGrams,
          sign: inbound ? -1 : 1,
          ratePerGram: rate || null,
          amountIRR: p.amountIRR,
        });
        continue;
      }
      const p = goldSettlementParts(entry, { rate, units: unitsOf(entry) });
      if (p.needsRate) needsRate = true;
      net += (inbound ? -1 : 1) * p.totalGrams;
      rows.push({
        seq: rows.length + 1,
        description: p.isCash
          ? `${inbound ? 'دریافت' : 'پرداخت'} نقدی ${accountNames.get(entry.accountId) || ''}`.trim()
          : lineTitle(entry, inbound ? 'ورود' : 'خروج', productNames.get(entry.productId)),
        note: joinNotes(labNote(entry, unitsOf(entry)), entry.description || ''),
        karatMille: p.karatMille,
        grams: p.totalGrams,
        sign: inbound ? -1 : 1,
        ratePerGram: p.isCash ? rate || null : num(entry.ratePerGram) || null,
        amountIRR: p.isCash ? p.amountIRR : null,
      });
    }
  }

  const netGrams = round2(net);

  return { rows, summary, netGrams, side: sideOf(netGrams), needsRate };
}

function pushIf(list, description, grams, sign, baseMille) {
  if (grams > 0) list.push({ description, karatMille: baseMille, grams, sign });
}

/**
 * نرمال‌سازی جمع ردیف‌های از قبل گِردشده. Phase 22: سه رقم (مقادیر دو رقمیِ اسناد
 * قدیمی دقیقاً همان می‌مانند). نام قدیمی برای سازگاری با صادرکننده‌ها حفظ شده است.
 */
function round2(v) {
  return normalizeGrams(v);
}

/** ارقام فارسی با ممیز «/» — همان سبک نمونه. */
function fa(value) {
  const s = String(value).replace('.', '/');
  return s.replace(/[0-9]/g, (dg) => '۰۱۲۳۴۵۶۷۸۹'[Number(dg)]);
}

// ─────────────────────── مانده‌ی طلایی طرف حساب ───────────────────────

/** همه‌ی اسناد معتبر یک طرف حساب که روی مانده‌ی طلایی اثر دارند. */
export async function partyGoldDocuments(partyType, partyId) {
  const map = PARTY_MAP[partyType];
  if (!map) throw new Error(`نوع طرف حساب نامعتبر است: ${partyType}`);

  const invoices = (await getByIndex(map.docStore, map.docIndex, partyId)).filter(
    (row) => row.status !== 'voided' && !row.deletedAt
  );

  // Phase 22: هر دو Store — سند تسویه‌ی معکوس در Store مقابل می‌نشیند.
  const settlements = (await partySettlementDocs(partyType, partyId)).map((e) => e.doc).filter(
    // فقط اسناد تسویه‌ی مستقل — خطوط داخل فاکتور با خودِ فاکتور شمرده می‌شوند
    (row) => row.source === 'settlement' && row.status !== 'voided'
  );

  const returns =
    partyType === 'customer'
      ? (await getByIndex('saleReturns', 'customerId', partyId)).filter((r) => r.status !== 'voided')
      : [];

  return { invoices, settlements, returns };
}

/**
 * مانده‌ی طلایی طرف حساب تا **پیش از** یک سند مشخص.
 * ترتیب: تاریخ سند، سپس شماره‌ی سند (همان قاعده‌ی FIFO فاز ۱۱) تا نتیجه هرگز
 * به ترتیب تصادفی خواندن از IndexedDB وابسته نباشد.
 */
export async function goldBalanceBefore(partyType, partyId, cutoff, opts = {}) {
  const { invoices, settlements, returns } = await partyGoldDocuments(partyType, partyId);

  const entries = [];
  const invoiceKind = partyType === 'customer' ? 'sale' : 'purchase';

  for (const inv of invoices) {
    entries.push({ doc: inv, kind: invoiceKind, embedded: await embeddedOf(inv, partyType) });
  }
  for (const s of settlements) entries.push({ doc: s, kind: 'settlement', embedded: [] });
  for (const r of returns) entries.push({ doc: r, kind: 'saleReturn', embedded: [] });

  const before = entries.filter((e) => isBefore(e.doc, cutoff));
  let total = 0;
  // اسنادی که هیچ «فی» ندارند نمی‌توانند مبلغ ریالی‌شان را به طلا تبدیل کنند.
  // این‌ها **پنهان نمی‌شوند**: شماره‌شان برگردانده می‌شود تا برگه صریحاً بگوید
  // مانده‌ی «قبل» ناقص است. یک مانده‌ی کمی‌غلط که به‌نظر درست بیاید، از یک
  // مانده‌ی صریحاً ناقص بسیار خطرناک‌تر است.
  const missingRate = [];
  for (const e of before) {
    const rate = sheetRateOf(e.doc, { units: unitsOf(e.doc) });
    const { netGrams, needsRate } = docGoldRows(e.doc, e.kind, {
      rate,
      embeddedSettlements: e.embedded,
      settlementDocs: e.kind === 'settlement' ? await batchOf(e.doc, partyType) : null,
    });
    if (needsRate) missingRate.push(e.doc.number || e.doc.id);
    total += netGrams;
  }
  const grams = round2(total);
  return {
    grams: Math.abs(grams),
    signed: grams,
    side: sideOf(grams),
    incomplete: missingRate.length > 0,
    missingRateDocs: missingRate,
  };
}

async function embeddedOf(invoice, partyType) {
  const store = partyType === 'customer' ? 'receipts' : 'payments';
  const ids = partyType === 'customer' ? invoice.receiptIds : invoice.paymentIds;
  const rows = await Promise.all((ids || []).map((id) => get(store, id)));
  return rows.filter((r) => r && r.status !== 'voided');
}

async function batchOf(doc, partyType) {
  void partyType;
  const store = settlementStoreOf(settlementDirectionOf(doc));
  const ids = doc.batchDocIds || [doc.id];
  const rows = await Promise.all(ids.map((id) => (id === doc.id ? doc : get(store, id))));
  return rows.filter(Boolean);
}

function isBefore(doc, cutoff) {
  if (!cutoff) return true;
  if (doc.id === cutoff.id) return false;
  const byDate = String(doc.date || '').localeCompare(String(cutoff.date || ''));
  if (byDate !== 0) return byDate < 0;
  return String(doc.number || '').localeCompare(String(cutoff.number || '')) < 0;
}

export { embeddedOf as embeddedSettlementsOf, batchOf as settlementBatchOf, round2 as roundSheet2 };
