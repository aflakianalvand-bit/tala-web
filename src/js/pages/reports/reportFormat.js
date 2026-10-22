// reportFormat.js — قالب نمایش سلول‌های گزارش بر اساس `kind` ستون (Phase 14)
// خالص و بدون DOM تا تست‌ها مستقیم بررسی‌اش کنند.
import { COL } from '../../services/reports/model.js';
import { formatNumber, formatRial, formatGrams } from '../../utils/format.js';
import { formatJalaliDate } from '../../utils/date.js';

export const NUMERIC_KINDS = new Set([COL.IRR, COL.GRAMS, COL.COUNT, COL.KARAT, COL.RATE, COL.PERCENT]);

function isBlank(value) {
  return value === null || value === undefined || value === '';
}

/**
 * @param {string} kind نوع ستون (COL)
 * @param {*} value مقدار خام
 * @param {{total?: boolean}} opts در ردیف جمع، صفر هم نمایش داده می‌شود
 */
export function formatCell(kind, value, { total = false } = {}) {
  if (isBlank(value)) return '—';
  switch (kind) {
    case COL.DATE: {
      const d = new Date(value);
      // ردیف جمع برچسب «جمع» را در ستون تاریخ دارد — متن خام نمایش داده می‌شود.
      return Number.isNaN(d.getTime()) ? String(value) : formatJalaliDate(d);
    }
    case COL.IRR:
      if (!total && Number(value) === 0) return '—';
      return formatRial(value);
    case COL.GRAMS:
      if (!total && Number(value) === 0) return '—';
      return formatGrams(value);
    case COL.COUNT:
      return formatNumber(value, { maximumFractionDigits: 0 });
    case COL.KARAT:
      return formatNumber(value, { maximumFractionDigits: 2 });
    case COL.RATE:
      return `${formatNumber(value, { maximumFractionDigits: 0 })} ریال/گرم`;
    case COL.PERCENT:
      return `${formatNumber(value, { maximumFractionDigits: 1 })}٪`;
    default:
      return String(value);
  }
}

/** مقدار نوار خلاصه — همیشه صفر را هم نشان می‌دهد. */
export function formatSummary(item) {
  return formatCell(item.kind, item.value, { total: true });
}
