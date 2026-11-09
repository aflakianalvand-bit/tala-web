// sheetFormat.js — قالب متن اعداد برگه‌ی سند؛ مشترک بین برگه‌ی DOM و تصویر ارسالی.
import { SIDE_LABELS } from '../../services/goldAccount.js';
import { formatNumber, toPersianDigits } from '../../utils/format.js';

/** «۱۲/۶۸۳» — ارقام فارسی با ممیز «/»؛ تعداد اعشار از مدل برگه می‌آید (سند قدیمی ۲ رقم). */
export function gramsText(value, decimals) {
  const n = Number(value) || 0;
  return toPersianDigits(n.toFixed(decimals)).replace('.', '/');
}

export function sideGrams(side, grams, decimals) {
  const label = SIDE_LABELS[side] || '';
  const text = gramsText(grams, decimals);
  return label ? `${label} ${text}` : text;
}

export function rialText(value) {
  if (value === null || value === undefined || value === '') return '';
  return toPersianDigits(formatNumber(Math.round(Number(value) || 0), { maximumFractionDigits: 0 }));
}
