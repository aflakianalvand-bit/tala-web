// ledgerSummary.js — «معین حساب»: فهرست مانده‌ی اشخاص برای صفحه‌ی اصلی (Phase 26)
//
// ═══════════════════════════════════════════════════════════════════════════
// فقط‌خواندنی. هیچ فرمول مانده‌ی تازه‌ای اینجا نیست:
//   مانده‌ی گرم ۷۵۰ ........ ledger.gramsBalanceMap (همان موتور صفحه‌ی شخص و فهرست اشخاص)
//   جهت بد/بس ............. ledger.BALANCE_SIGN + قرارداد علامت ACCOUNTING_RULES §۱۰٫۱
//   صفر بودن ............... goldTotals.isZeroGrams (GRAM_EPS = ۰٫۰۰۰۵، ACCOUNTING_RULES §۱۲٫۲)
//   معادل ریالی ............ goldEquivalent.baseGramsToIrr × نرخ ۷۵۰ آخرین رکورد priceRates
//
// تصمیم‌های کاربر (پرسش‌های شروع Phase 26، ۱۴۰۵/۰۷/۲۶):
//   • یک فهرست مشترک مشتری و تأمین‌کننده با برچسب نوع؛ بزرگ‌ترین مانده‌ی مطلق اول.
//   • تسویه‌شده‌ها پیش‌فرض پنهان‌اند (کلید «نمایش تسویه‌شده‌ها»).
//   • شخص غیرفعال یا حذف‌شده‌ای که مانده دارد نمایش داده می‌شود، با برچسب وضعیت.
//     شخص غیرفعال/حذف‌شده‌ی تسویه‌شده هیچ‌وقت نمی‌آید (چیزی برای پیگیری ندارد).
//   • معادل ریالی «به نرخ امروز» = مانده‌ی گرم × نرخ ۷۵۰ آخرین نرخ ثبت‌شده. اگر آخرین نرخ
//     مال امروز نیست، تاریخش برگردانده می‌شود تا برچسب دروغ نگوید؛ بدون نرخ ⇒ null (نه صفر).
// ═══════════════════════════════════════════════════════════════════════════

import { getAll } from '../db/repo.js';
import { BALANCE_SIGN, gramsBalanceMap } from './ledger.js';
import { roundBaseGrams, isZeroGrams } from './goldTotals.js';
import { baseGramsToIrr } from './goldEquivalent.js';
import { getCurrentRate } from './priceRates.js';
import { toNumber } from '../utils/decimal.js';
import { dayKeyOf } from '../utils/dateRange.js';

export const PARTY_KINDS = ['customer', 'supplier'];
const STORE_OF = { customer: 'customers', supplier: 'suppliers' };

/** تعداد ردیف پیش‌فرض صفحه‌ی اصلی (تصمیم کاربر: ۱۰ + دکمه‌ی «همه»). */
export const LEDGER_SUMMARY_LIMIT = 10;

/**
 * جهت مانده روی محور §۱۰٫۱: 'debit' (طرف بدهکار = «بد»)، 'credit' (طرف بستانکار = «بس»)، 'zero'.
 * ورودی همان مانده‌ی علامت‌دار ledger برای آن نوع است (مشتری Debit−Credit، تأمین‌کننده Credit−Debit)،
 * پس علامت ledger یک بار دیگر در BALANCE_SIGN ضرب می‌شود تا به محور «+ = طرف بدهکار» برسد.
 */
export function balanceSideOf(kind, ledgerValue, eps = null) {
  const s = BALANCE_SIGN[kind];
  if (s === undefined) throw new Error(`نوع طرف حساب نامعتبر است: ${kind}`);
  const v = Number(ledgerValue) || 0;
  const zero = eps === null ? isZeroGrams(v) : Math.abs(v) < eps;
  if (zero) return 'zero';
  return s * v > 0 ? 'debit' : 'credit';
}

/** واژه‌ی هر جهت — همان واژه‌های برگه‌ی A5 (goldAccount.SIDE_LABELS) با «تسویه» برای صفر. */
export const SIDE_WORDS = Object.freeze({ debit: 'بد', credit: 'بس', zero: 'تسویه' });

/** وضعیت رکورد شخص برای برچسب ردیف. */
export function partyStateOf(party) {
  if (party?.deletedAt) return 'deleted';
  if (party && party.active === false) return 'inactive';
  return 'active';
}

/** نرخ ۷۵۰ آخرین رکورد نرخ (ریال بر گرم ۷۵۰) + آیا مال امروز است. */
async function rateInfo(today) {
  const rate = await getCurrentRate();
  const perGram = Number(rate?.ratePerGram18k) || 0;
  if (!rate || perGram <= 0) return null;
  const date = rate.effectiveDate || rate.createdAt || null;
  return {
    ratePerGram750: perGram,
    effectiveDate: date,
    isToday: date ? dayKeyOf(new Date(date)) === dayKeyOf(today) : false,
  };
}

function compareRows(a, b) {
  return (
    Math.abs(b.grams) - Math.abs(a.grams) ||
    String(a.name || '').localeCompare(String(b.name || ''), 'fa') ||
    String(a.id).localeCompare(String(b.id))
  );
}

/**
 * فهرست مانده‌ی اشخاص.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeSettled=false] ردیف‌های تسویه‌شده‌ی اشخاص فعال هم بیایند.
 * @param {Date} [opts.today] «امروز» برای برچسب نرخ (تست‌پذیری).
 * @returns {Promise<{rows: object[], totals: object, rate: object|null, settledCount: number}>}
 *   هر ردیف: `{kind, id, code, name, state, grams, absGrams, side, irr}` — `grams` همان عدد
 *   علامت‌دار ledger است و `side` جهت بد/بس؛ `irr` معادل ریالی مطلق (یا null بدون نرخ).
 */
export async function getLedgerSummary({ includeSettled = false, today = new Date() } = {}) {
  const [rate, ...perKind] = await Promise.all([
    rateInfo(today),
    ...PARTY_KINDS.map((kind) => Promise.all([getAll(STORE_OF[kind]), gramsBalanceMap(kind)])),
  ]);

  const rows = [];
  let settledCount = 0;
  const totals = { debitGrams: 0, creditGrams: 0, debitCount: 0, creditCount: 0 };

  PARTY_KINDS.forEach((kind, i) => {
    const [parties, balances] = perKind[i];
    for (const p of parties) {
      const raw = balances.get(p.id) || 0;
      const side = balanceSideOf(kind, raw);
      const grams = side === 'zero' ? 0 : raw;
      const state = partyStateOf(p);
      if (side === 'zero') {
        if (state !== 'active') continue;
        settledCount++;
        if (!includeSettled) continue;
      } else if (side === 'debit') {
        totals.debitGrams = roundBaseGrams(totals.debitGrams + Math.abs(grams));
        totals.debitCount++;
      } else {
        totals.creditGrams = roundBaseGrams(totals.creditGrams + Math.abs(grams));
        totals.creditCount++;
      }
      const absGrams = Math.abs(grams);
      rows.push({
        kind,
        id: p.id,
        code: p.code ?? '',
        name: p.name ?? '',
        state,
        grams,
        absGrams,
        side,
        irr: rate ? Math.round(toNumber(baseGramsToIrr(absGrams, rate.ratePerGram750))) : null,
      });
    }
  });

  rows.sort(compareRows);
  return { rows, totals, rate, settledCount };
}
