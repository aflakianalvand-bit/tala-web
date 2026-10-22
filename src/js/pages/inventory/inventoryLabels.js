// inventoryLabels.js — واژگان فارسی ماژول انبار طلا (Phase 10)
import { formatGrams, formatRial } from '../../utils/format.js';
import { GOLD_ACCOUNT_TYPE_LABELS, GRAM_EPS, IRR_EPS } from '../../services/inventory.js';
import { INVENTORY_CATEGORIES } from '../../services/inventoryDocs.js';

export { GOLD_ACCOUNT_TYPE_LABELS };
export { displayDate, displayDateLong, GOLD_REASON_LABELS, GOLD_TYPE_LABELS, GOLD_TYPE_OPTIONS } from '../docs/docLabels.js';

export const GOLD_TYPE_ICONS = {
  melted: '🥇',
  misc: '🪙',
  manufactured: '💍',
};

export const INVENTORY_DOC_KIND_LABELS = {
  adjustment: 'اصلاح موجودی',
  melt: 'ذوب / تبدیل',
};

export const INVENTORY_DOC_STATUS_LABELS = {
  confirmed: 'ثبت‌شده',
  voided: 'باطل‌شده',
};

export const INVENTORY_DOC_STATUS_VARIANT = {
  confirmed: 'success',
  voided: 'danger',
};

export const INVENTORY_CATEGORY_OPTIONS = INVENTORY_CATEGORIES.map((c) => ({
  value: c.key,
  label: c.label,
  direction: c.direction,
  hint: c.hint,
}));

export function inventoryDocStatusBadge(doc) {
  const status = doc?.status || 'confirmed';
  return {
    label: INVENTORY_DOC_STATUS_LABELS[status] || status,
    variant: INVENTORY_DOC_STATUS_VARIANT[status] || 'neutral',
  };
}

/**
 * توصیف موجودی یک سطل.
 * موجودی منفی «غیرممکن» نیست (INVENTORY_RULES §۵: هشدار، نه بلاک) اما باید بصری
 * برجسته بماند تا کاربر بداند یک واقعیت غیرعادی ثبت شده است.
 */
export function describeStock(grams) {
  const amount = formatGrams(Math.abs(grams));
  if (Math.abs(grams) < GRAM_EPS) return { amount: formatGrams(0), text: 'بدون موجودی', variant: 'neutral' };
  if (grams > 0) return { amount, text: 'موجودی انبار', variant: 'success' };
  return { amount: `${amount}−`, text: 'موجودی منفی (کسری)', variant: 'danger' };
}

/** توصیف تفاوت ارزش روز و ارزش دفتری (سود/زیان تحقق‌نیافته). */
export function describeUnrealized(value) {
  if (Math.abs(value) < IRR_EPS) return { text: 'بدون تفاوت', variant: 'neutral', amount: formatRial(0) };
  if (value > 0) return { text: 'سود تحقق‌نیافته', variant: 'success', amount: formatRial(value) };
  return { text: 'زیان تحقق‌نیافته', variant: 'danger', amount: formatRial(Math.abs(value)) };
}

/** خلاصه‌ی یک‌خطی از یک سند انبار برای فهرست. */
export function describeInventoryDoc(doc) {
  if (doc.kind === 'melt') {
    return `${formatGrams(doc.weightGrams)} ← ${formatGrams(doc.outputWeightGrams)} (افت ${formatGrams(doc.lossGrams)})`;
  }
  const sign = doc.direction === 'IN' ? '+' : '−';
  return `${sign}${formatGrams(doc.weightGrams)}`;
}
