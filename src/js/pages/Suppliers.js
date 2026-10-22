// Suppliers.js — تأمین‌کنندگان (Phase 5)
// تمام رفتار در کامپوننت‌های مشترک party است؛ این فایل فقط واژگان دامنه‌ی «تأمین‌کننده» را تعریف می‌کند.
import { createPartyListPage } from './party/PartyListPage.js';
import { supplierService } from '../services/suppliers.js';

/**
 * واژگان دامنه‌ی تأمین‌کننده.
 * توجه به وارونگی معنایی نسبت به مشتری: مانده مثبت تأمین‌کننده یعنی **ما بدهکاریم**
 * (او بستانکار است)، در حالی که مانده مثبت مشتری یعنی **او بدهکار است**.
 * در هر دو حالت مثبت = «اثر مالی باز» و با رنگ هشدار نمایش داده می‌شود
 * (ACCOUNTING_RULES §2، UI_GUIDELINES §6.1).
 */
export const SUPPLIER_LABELS = {
  kind: 'supplier',
  entity: 'تأمین‌کننده',
  icon: '🏭',

  // صفحه فهرست
  pageTitle: 'تأمین‌کنندگان',
  pageSubtitle: 'بدهی ما به هر تأمین‌کننده از گردش دفاتر محاسبه می‌شود.',
  addAction: 'افزودن تأمین‌کننده',
  emptyTitle: 'تأمین‌کننده‌ای یافت نشد',
  emptyFilteredDesc: 'با این جستجو/فیلتر تأمین‌کننده‌ای پیدا نشد.',
  emptyFirstDesc: 'برای شروع، اولین تأمین‌کننده را اضافه کنید.',
  loadErrorTitle: 'خطا در بارگذاری تأمین‌کنندگان',
  docWord: 'خرید',
  noDocLabel: 'بدون خرید',
  summaryPositiveLabel: 'بدهی ما به تأمین‌کنندگان',
  summaryNegativeLabel: 'پیش‌پرداخت‌های ما',
  countLabel: 'تعداد تأمین‌کننده',

  statusFilterOptions: [
    { value: 'active', label: 'فعال' },
    { value: 'positive', label: 'بستانکار (بدهی ما)' },
    { value: 'negative', label: 'بدهکار (پیش‌پرداخت)' },
    { value: 'inactive', label: 'غیرفعال' },
    { value: 'deleted', label: 'حذف‌شده' },
    { value: 'all', label: 'همه' },
  ],

  // فرم
  addTitle: 'افزودن تأمین‌کننده',
  editTitle: 'ویرایش تأمین‌کننده',
  activeLabel: 'تأمین‌کننده فعال است',
  activeHint: 'تأمین‌کننده غیرفعال در فهرست پیش‌فرض و فرم‌های خرید پیشنهاد نمی‌شود.',

  // صفحه جزئیات
  detailTitle: 'جزئیات تأمین‌کننده',
  docCountLabel: 'تعداد خرید',
  lastDocLabel: 'آخرین خرید',
  docsTabLabel: 'خریدها',
  paymentsTabLabel: 'پرداخت‌ها',
  openTabLabel: 'بدهی',
  openBalanceCardTitle: 'بدهی ما',
  docsEmptyTitle: 'خریدی از این تأمین‌کننده ثبت نشده',
  docsEmptyDesc: 'فاکتورهای خرید از این تأمین‌کننده اینجا نمایش داده می‌شوند.',
  paymentsEmptyTitle: 'پرداختی به این تأمین‌کننده ثبت نشده',
  paymentsEmptyDesc: 'پرداخت وجه نقد، بانک یا طلا به این تأمین‌کننده اینجا فهرست می‌شود.',
  openEmptyTitle: 'بدهی بازی وجود ندارد',
  openEmptyDesc: 'فاکتورهای خرید رسیدی/ترکیبی تسویه‌نشده اینجا نمایش داده می‌شوند.',
  statementEmptyDesc: 'با ثبت اولین خرید یا پرداخت، گردش حساب این تأمین‌کننده اینجا نمایش داده می‌شود.',
  goldStatementEmptyDesc: 'پرداخت/دریافت طلا با این تأمین‌کننده اینجا نمایش داده می‌شود.',
  statementNote:
    'مانده‌ها همیشه از روی دفاتر (Ledger) محاسبه می‌شوند و مانده‌ی هر فاکتور از تخصیص‌های پرداخت.',

  // Phase 11 — تسویه و تخصیص
  settleAction: 'ثبت پرداخت',
  reverseSettleAction: 'دریافت از تأمین‌کننده',
  settleWord: 'پرداخت',
  unallocatedCardTitle: 'علی‌الحساب نزد تأمین‌کننده',
  unallocatedNote: 'پرداخت‌شده ولی هنوز بابت فاکتور مشخصی حساب نشده.',
};

export default createPartyListPage({ service: supplierService, labels: SUPPLIER_LABELS });
