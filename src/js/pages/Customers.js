// Customers.js — مشتریان (Phase 4، بازسازی‌شده روی pages/party/* در Phase 5)
// تمام رفتار در کامپوننت‌های مشترک party است؛ این فایل فقط واژگان دامنه‌ی «مشتری» را تعریف می‌کند.
import { createPartyListPage } from './party/PartyListPage.js';
import { customerService } from '../services/customers.js';

/** واژگان دامنه‌ی مشتری — تنها تفاوت این ماژول با تأمین‌کننده. */
export const CUSTOMER_LABELS = {
  kind: 'customer',
  entity: 'مشتری',
  icon: '👥',

  // صفحه فهرست
  pageTitle: 'مشتریان',
  pageSubtitle: 'مانده هر مشتری از گردش دفاتر محاسبه می‌شود.',
  addAction: 'افزودن مشتری',
  emptyTitle: 'مشتری‌ای یافت نشد',
  emptyFilteredDesc: 'با این جستجو/فیلتر مشتری‌ای پیدا نشد.',
  emptyFirstDesc: 'برای شروع، اولین مشتری را اضافه کنید.',
  loadErrorTitle: 'خطا در بارگذاری مشتریان',
  docWord: 'خرید',
  noDocLabel: 'بدون خرید',
  summaryPositiveLabel: 'مطالبات از مشتریان',
  summaryNegativeLabel: 'بستانکاری مشتریان',
  countLabel: 'تعداد مشتری',

  // مانده مثبت = مشتری به ما بدهکار است (ACCOUNTING_RULES §2)
  statusFilterOptions: [
    { value: 'active', label: 'فعال' },
    { value: 'positive', label: 'بدهکار' },
    { value: 'negative', label: 'بستانکار' },
    { value: 'inactive', label: 'غیرفعال' },
    { value: 'deleted', label: 'حذف‌شده' },
    { value: 'all', label: 'همه' },
  ],

  // فرم
  addTitle: 'افزودن مشتری',
  editTitle: 'ویرایش مشتری',
  activeLabel: 'مشتری فعال است',
  activeHint: 'مشتری غیرفعال در فهرست پیش‌فرض و فرم‌های فروش پیشنهاد نمی‌شود.',

  // صفحه جزئیات
  detailTitle: 'جزئیات مشتری',
  docCountLabel: 'تعداد خرید',
  lastDocLabel: 'آخرین خرید',
  docsTabLabel: 'خریدها',
  paymentsTabLabel: 'پرداخت‌ها',
  openTabLabel: 'فاکتورهای باز',
  openBalanceCardTitle: 'مطالبات ما',
  docsEmptyTitle: 'خریدی برای این مشتری ثبت نشده',
  docsEmptyDesc: 'فاکتورهای فروش به این مشتری اینجا نمایش داده می‌شوند.',
  paymentsEmptyTitle: 'دریافتی از این مشتری ثبت نشده',
  paymentsEmptyDesc: 'دریافت وجه نقد، کارتخوان، بانک یا طلا از این مشتری اینجا فهرست می‌شود.',
  openEmptyTitle: 'فاکتور بازی وجود ندارد',
  openEmptyDesc: 'فاکتورهای رسیدی/ترکیبی تسویه‌نشده اینجا نمایش داده می‌شوند.',
  statementEmptyDesc: 'با ثبت اولین فروش یا دریافت، گردش حساب این مشتری اینجا نمایش داده می‌شود.',
  goldStatementEmptyDesc: 'دریافت/پرداخت طلا با این مشتری اینجا نمایش داده می‌شود.',
  statementNote:
    'مانده‌ها همیشه از روی دفاتر (Ledger) محاسبه می‌شوند و مانده‌ی هر فاکتور از تخصیص‌های پرداخت.',

  // Phase 11 — تسویه و تخصیص
  settleAction: 'ثبت دریافت',
  reverseSettleAction: 'پرداخت به مشتری',
  settleWord: 'دریافت',
  unallocatedCardTitle: 'علی‌الحساب مشتری',
  unallocatedNote: 'دریافت‌شده ولی هنوز بابت فاکتور مشخصی حساب نشده.',
};

export default createPartyListPage({ service: customerService, labels: CUSTOMER_LABELS });
