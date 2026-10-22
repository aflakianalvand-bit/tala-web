// suppliers.js — سرویس تأمین‌کنندگان (Phase 5)
//
// منطق واقعی در services/party.js است (همان پایه‌ای که مشتری روی آن ساخته شده).
// این فایل فقط پیکربندی «تأمین‌کننده» + نام‌گذاری دامنه‌ای است.
//
// ═══════════════════════════════════════════════════════════════════════════
// جهت مانده تأمین‌کننده (ACCOUNTING_RULES §2 و §3.1):
//   supplierBalance = Σcredit − Σdebit  (علامت −۱ در ledger.js)
//   مثبت  ⇒ ما به تأمین‌کننده بدهکاریم (او بستانکار است) — بدهی ما
//   منفی  ⇒ ما به او پیش‌پرداخت داده‌ایم (او بدهکار ماست)
// هیچ عدد مالی روی رکورد تأمین‌کننده ذخیره نمی‌شود؛ همه در لحظه از Ledger می‌آید.
// ═══════════════════════════════════════════════════════════════════════════

import { createPartyService, normalizePhone, PartyValidationError, PartyDeleteBlockedError } from './party.js';

const service = createPartyService({
  store: 'suppliers',
  kind: 'supplier',
  codePrefix: 'SU',
  docStore: 'purchases', // سند تجاری تأمین‌کننده: خرید ما از او
  docIndex: 'supplierId',
  payStore: 'payments', // سند تسویه: پرداخت ما به او
  label: 'تأمین‌کننده',
});

export { normalizePhone };

export const SupplierValidationError = PartyValidationError;
export const SupplierDeleteBlockedError = PartyDeleteBlockedError;

export const nextSupplierCode = () => service.nextCode();
export const getSupplier = (id) => service.getOne(id);
export const createSupplier = (input) => service.create(input);
export const updateSupplier = (id, input) => service.update(id, input);
export const softDeleteSupplier = (id, opts) => service.softDelete(id, opts);
export const restoreSupplier = (id) => service.restore(id);
export const checkDeletable = (id) => service.checkDeletable(id);
export const getSupplierHistory = (id) => service.getHistory(id);
export const findSuppliersByPhone = (phone, opts) => service.findByPhone(phone, opts);
export const listSuppliers = (opts) => service.list(opts);

/**
 * خلاصه‌ی صفحه جزئیات تأمین‌کننده.
 * علاوه بر نام‌های عمومی party، نام‌های دامنه‌ای (purchases/payments/openPurchases/debt)
 * هم برگردانده می‌شوند تا صفحه با واژگان کسب‌وکار کار کند.
 *
 * `debt` مقدار **مشتق‌شده از Ledger** است (فقط بخش مثبت مانده = بدهی واقعی ما)،
 * نه جمع ستون‌های جدول فاکتورها.
 */
export async function getSupplierSummary(id) {
  const base = await service.getSummary(id);
  return {
    ...base,
    supplier: base.party,
    purchases: base.documents,
    payments: base.payments,
    openPurchases: base.openDocuments,
    debt: base.balance > 0 ? base.balance : 0,
    prepaid: base.balance < 0 ? -base.balance : 0,
  };
}

export { service as supplierService };
