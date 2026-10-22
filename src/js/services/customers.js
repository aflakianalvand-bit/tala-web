// customers.js — سرویس مشتریان (Phase 4، بازسازی‌شده روی party.js در Phase 5)
//
// منطق واقعی در services/party.js است (دلیل این تفکیک در همان فایل توضیح داده شده).
// این فایل فقط پیکربندی «مشتری» + نام‌گذاری فارسی/دامنه‌ای است.
// API عمومی این ماژول نسبت به Phase 4 **هیچ تغییری نکرده** — تست‌های Phase 4 دست‌نخورده
// باقی ماندند و همچنان Pass می‌شوند؛ همین تضمینِ درستیِ این بازسازی است.
//
// مانده مشتری هرگز ذخیره نمی‌شود؛ همیشه از services/ledger.js مشتق می‌گردد.

import { createPartyService, normalizePhone, PartyValidationError, PartyDeleteBlockedError } from './party.js';

const service = createPartyService({
  store: 'customers',
  kind: 'customer',
  codePrefix: 'CU',
  docStore: 'sales', // «خرید مشتری» از دید ما یک سند فروش است
  docIndex: 'customerId',
  payStore: 'receipts', // «پرداخت مشتری» از دید ما یک سند دریافت است
  label: 'مشتری',
});

export { normalizePhone };

/** برای سازگاری با Phase 4، نام اختصاصی خطاها حفظ شد. */
export const CustomerValidationError = PartyValidationError;
export const CustomerDeleteBlockedError = PartyDeleteBlockedError;

export const nextCustomerCode = () => service.nextCode();
export const getCustomer = (id) => service.getOne(id);
export const createCustomer = (input) => service.create(input);
export const updateCustomer = (id, input) => service.update(id, input);
export const softDeleteCustomer = (id, opts) => service.softDelete(id, opts);
export const restoreCustomer = (id) => service.restore(id);
export const checkDeletable = (id) => service.checkDeletable(id);
export const getCustomerHistory = (id) => service.getHistory(id);
export const findCustomersByPhone = (phone, opts) => service.findByPhone(phone, opts);
export const listCustomers = (opts) => service.list(opts);

/**
 * خلاصه‌ی صفحه جزئیات مشتری.
 * علاوه بر نام‌های عمومی party، نام‌های دامنه‌ای مشتری (sales/receipts/openInvoices)
 * هم برگردانده می‌شوند تا صفحه‌ی جزئیات با واژگان کسب‌وکار کار کند.
 */
export async function getCustomerSummary(id) {
  const base = await service.getSummary(id);
  return {
    ...base,
    customer: base.party,
    sales: base.documents,
    receipts: base.payments,
    openInvoices: base.openDocuments,
  };
}

export { service as customerService };
