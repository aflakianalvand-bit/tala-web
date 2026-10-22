// purchaseLabels.js — واژگان اختصاصی ماژول خرید
// واژگان مشترک با فروش/برگشت در pages/docs/docLabels.js زندگی می‌کنند (استخراج Phase 7)؛
// این فایل آن‌ها را دوباره صادر می‌کند تا importهای موجود ماژول خرید تغییر نکنند.
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

export const PURCHASE_STATUS_LABELS = {
  open: 'باز',
  settled: 'تسویه‌شده',
  voided: 'باطل‌شده',
};

export const PURCHASE_STATUS_VARIANT = {
  open: 'warning',
  settled: 'success',
  voided: 'danger',
};

export function purchaseStatusBadge(purchase) {
  const status = purchase?.status || 'open';
  return { label: PURCHASE_STATUS_LABELS[status] || status, variant: PURCHASE_STATUS_VARIANT[status] || 'neutral' };
}
