// accountLabels.js — واژگان فارسی ماژول حساب‌ها و صندوق (Phase 9)
import { formatRial, formatGrams } from '../../utils/format.js';
import { ACCOUNT_TYPE_LABELS, GOLD_ACCOUNT_TYPE_LABELS } from '../../services/accounts.js';

export { ACCOUNT_TYPE_LABELS, GOLD_ACCOUNT_TYPE_LABELS };
export { displayDate, displayDateLong, MONEY_REASON_LABELS, GOLD_REASON_LABELS, LEDGER_KIND_LABELS } from '../docs/docLabels.js';

export const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export const ACCOUNT_TYPE_ICONS = {
  cashbox: '💵',
  bank: '🏦',
  pos: '💳',
};

export const GOLD_ACCOUNT_ICONS = {
  melted: '🥇',
  misc: '🪙',
  manufactured: '💍',
};

export const TRANSFER_KIND_LABELS = {
  money: 'انتقال وجه',
  gold: 'انتقال طلا',
};

export const TRANSFER_STATUS_LABELS = {
  confirmed: 'ثبت‌شده',
  voided: 'باطل‌شده',
};

export const TRANSFER_STATUS_VARIANT = {
  confirmed: 'success',
  voided: 'danger',
};

export const CASH_DIRECTION_LABELS = {
  in: 'واریز',
  out: 'برداشت',
};

/**
 * توصیف مانده‌ی یک حساب وجهی.
 * مانده‌ی منفی صندوق «غیرممکن» نیست (تصمیم Phase 9: هشدار، نه بلاک) اما باید
 * به‌صورت بصری برجسته بماند تا کاربر بداند یک واقعیت غیرعادی را ثبت کرده است.
 */
export function describeAccountBalance(balance) {
  const amount = formatRial(Math.abs(balance));
  if (Math.abs(balance) < 0.5) return { amount: formatRial(0), text: 'بدون موجودی', variant: 'neutral' };
  if (balance > 0) return { amount, text: 'موجودی حساب', variant: 'success' };
  return { amount: `${amount}−`, text: 'موجودی منفی (کسری)', variant: 'danger' };
}

/** توصیف موجودی یک حساب طلایی (گرم). */
export function describeGoldBalance(grams) {
  const amount = formatGrams(Math.abs(grams));
  if (Math.abs(grams) < 0.0005) return { amount: formatGrams(0), text: 'بدون موجودی', variant: 'neutral' };
  if (grams > 0) return { amount, text: 'موجودی انبار', variant: 'success' };
  return { amount: `${amount}−`, text: 'موجودی منفی (کسری)', variant: 'danger' };
}

export function accountStatusBadge(account) {
  if (account?.deletedAt) return { label: 'حذف‌شده', variant: 'danger' };
  if (account?.active === false) return { label: 'غیرفعال', variant: 'warning' };
  return { label: 'فعال', variant: 'success' };
}

export function transferStatusBadge(transfer) {
  const status = transfer?.status || 'confirmed';
  return {
    label: TRANSFER_STATUS_LABELS[status] || status,
    variant: TRANSFER_STATUS_VARIANT[status] || 'neutral',
  };
}
