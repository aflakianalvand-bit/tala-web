// saleLabels.js — واژگان اختصاصی ماژول فروش (Phase 7)
// واژگان مشترک با خرید در pages/docs/docLabels.js است؛ اینجا فقط چیزهایی که
// مخصوص فاکتور فروش و سند برگشت‌اند تعریف می‌شوند.
export {
  GOLD_TYPE_LABELS,
  GOLD_TYPE_OPTIONS,
  GOLD_TYPE_BADGE_VARIANT,
  PAYMENT_MODE_LABELS,
  PAYMENT_MODE_OPTIONS,
  WAGE_TYPE_OPTIONS,
  PAY_METHOD_LABELS,
  GOLD_REASON_LABELS,
  MONEY_REASON_LABELS,
  LEDGER_KIND_LABELS,
  displayDate,
  displayDateLong,
  describeDueDate,
  describeLine,
  describeGoldEntry,
} from '../docs/docLabels.js';

export const SALE_STATUS_LABELS = {
  open: 'باز',
  settled: 'تسویه‌شده',
  voided: 'باطل‌شده',
};

export const SALE_STATUS_VARIANT = {
  open: 'warning',
  settled: 'success',
  voided: 'danger',
};

export const RETURN_STATUS_LABELS = {
  none: '',
  partial: 'برگشت جزئی',
  full: 'برگشت کامل',
};

export function saleStatusBadge(sale) {
  const status = sale?.status || 'open';
  return { label: SALE_STATUS_LABELS[status] || status, variant: SALE_STATUS_VARIANT[status] || 'neutral' };
}

/** نشان برگشت (فقط وقتی برگشتی وجود دارد). */
export function returnBadge(sale) {
  const status = sale?.returnStatus || 'none';
  if (status === 'none') return null;
  return { label: RETURN_STATUS_LABELS[status], variant: status === 'full' ? 'danger' : 'warning' };
}
