// statementSheet.js — صورت‌حساب ریز شخص: گردش گرم ۷۵۰ به تفکیک ماه با بد/بس (Phase 31).
// فقط‌خواندنی و روی همان gramsStatement؛ هیچ فرمول مانده‌ی تازه‌ای ندارد.
import { get } from '../db/repo.js';
import { formatJalaliDate, toDate } from '../utils/date.js';
import { gramsStatement } from './ledger.js';
import { balanceSideOf } from './ledgerSummary.js';
import { roundBaseGrams } from './goldTotals.js';
import { getSettings } from './settings.js';
import { SHEET_DEFAULTS } from './docSheet.js';
import { buildDocResolver } from './reports/docRefs.js';

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const STORE = { customer: 'customers', supplier: 'suppliers' };

/**
 * @returns {{party, header, months:Array<{key,label,rows,debit,credit,closing,closingSide}>,
 *            debit, credit, closing, closingSide, kindLabel}}
 *   ستون بد = بدهکارشدن طرف، بس = بستانکارشدن طرف؛ مانده عدد مطلق با جهت است.
 */
export async function buildPartyStatement(kind, id) {
  const [party, statement, resolve, settings] = await Promise.all([get(STORE[kind], id), gramsStatement(kind, id), buildDocResolver(), getSettings()]);
  const months = new Map();
  let debit = 0;
  let credit = 0;
  for (const r of statement.rows) {
    const jalali = formatJalaliDate(toDate(r.date)); // ۱۴۰۵/۰۷/۲۶
    const [year, month] = jalali.split('/');
    const key = `${year}/${month}`;
    if (!months.has(key)) {
      months.set(key, { key, label: `${MONTHS[Number(month) - 1]} ${year}`, rows: [], debit: 0, credit: 0, closing: 0, closingSide: 'zero' });
    }
    const m = months.get(key);
    const side = balanceSideOf(kind, r.balance);
    m.rows.push({ date: jalali, doc: resolve(r.transactionId).label, debit: r.debitGrams, credit: r.creditGrams, balance: Math.abs(r.balance), side });
    m.debit = roundBaseGrams(m.debit + r.debitGrams);
    m.credit = roundBaseGrams(m.credit + r.creditGrams);
    m.closing = Math.abs(r.balance);
    m.closingSide = side;
    debit = roundBaseGrams(debit + r.debitGrams);
    credit = roundBaseGrams(credit + r.creditGrams);
  }
  return {
    party: { name: party?.name || '', code: party?.code || '', phone: party?.phone || '' },
    kindLabel: kind === 'supplier' ? 'تأمین‌کننده' : 'مشتری',
    header: { title: settings.sheetTitle || SHEET_DEFAULTS.sheetTitle, invocation: settings.sheetInvocation || SHEET_DEFAULTS.sheetInvocation },
    printedAt: formatJalaliDate(new Date()),
    months: [...months.values()],
    debit,
    credit,
    closing: Math.abs(statement.closing),
    closingSide: balanceSideOf(kind, statement.closing),
  };
}
