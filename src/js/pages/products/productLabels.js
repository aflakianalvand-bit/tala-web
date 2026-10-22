// productLabels.js — نگاشت برچسب‌های فارسی و کمک‌توابع نمایش، مشترک بین لیست/فرم/جزئیات کالا
// (طبق قانون «از تکرار منطق جلوگیری کن» — ARCHITECTURE.md §4)

export const TYPE_LABELS = {
  manufactured: 'ساخته‌شده',
  melted: 'آبشده',
  misc: 'متفرقه',
};

export const TYPE_BADGE_VARIANT = {
  manufactured: 'success',
  melted: 'warning',
  misc: 'neutral',
};

export const WAGE_TYPE_LABELS = {
  percent: 'درصدی',
  perGram: 'مبلغ به ازای هر گرم',
};

export const UNIT_LABELS = {
  piece: 'عدد',
  gram: 'گرم',
};

export const TYPE_OPTIONS = Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }));
export const WAGE_TYPE_OPTIONS = Object.entries(WAGE_TYPE_LABELS).map(([value, label]) => ({ value, label }));
export const UNIT_OPTIONS = Object.entries(UNIT_LABELS).map(([value, label]) => ({ value, label }));

export const FIELD_LABELS = {
  code: 'کد کالا',
  name: 'نام',
  type: 'نوع طلا',
  karat: 'عیار',
  weightGrams: 'وزن (گرم)',
  unit: 'واحد',
  wageType: 'نوع اجرت',
  wageValue: 'اجرت',
  profitPercent: 'سود (٪)',
  taxPercent: 'مالیات (٪)',
  priceToday: 'قیمت روز (پیش‌فرض)',
  description: 'توضیحات',
  active: 'وضعیت',
  deletedAt: 'حذف نرم',
};

/** یک مقدار خام رکورد کالا را برای نمایش انسانی فرمت می‌کند (بدون اعمال گرد‌کردن مالی). */
export function formatFieldValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  switch (key) {
    case 'type':
      return TYPE_LABELS[value] || value;
    case 'wageType':
      return WAGE_TYPE_LABELS[value] || value;
    case 'unit':
      return UNIT_LABELS[value] || value;
    case 'active':
      return value ? 'فعال' : 'غیرفعال';
    case 'deletedAt':
      return value ? 'بله' : 'خیر';
    default:
      return String(value);
  }
}

export function productStatusBadge(product) {
  if (product.deletedAt) return { label: 'حذف‌شده', variant: 'danger' };
  if (!product.active) return { label: 'غیرفعال', variant: 'warning' };
  return { label: 'فعال', variant: 'success' };
}
