// navigation.js — نقشه‌ی ناوبری برنامه (Phase 25)
//
// تنها منبع حقیقت برای «کدام صفحه کجای برنامه است». نوار پایین، پیوند
// بازگشت بالای صفحه‌های زیرمجموعه، کاشی‌های داشبورد/تنظیمات و صفحه‌ی
// «همه‌ی بخش‌ها» همگی از همین فهرست ساخته می‌شوند؛ پس جابه‌جا کردن یک صفحه
// یعنی تغییر یک خط همین فایل، و تست navigation.test.mjs تضمین می‌کند هر
// مسیری که در main.js ثبت شده، دقیقاً یک جای مشخص در این نقشه داشته باشد
// («هیچ صفحه‌ای گم نشود»).
//
// ساختار (تصمیم Phase 21 §6.9 + دستور Phase 25):
//   داشبورد  → گزارش‌ها، انبار طلا، سررسیدها، حساب‌ها و صندوق‌ها
//   قیمت     → (صفحه‌ی مستقل)
//   عملیات + → فاکتورهای فروش، اسناد خرید  (کاشی‌های ثبت سند روی خود صفحه)
//   تنظیمات  → کالا، مشتریان، تأمین‌کنندگان، پشتیبان، نصب، همه‌ی بخش‌ها
//
// این فایل هیچ وابستگی‌ای به services/ و db/ ندارد (فقط ظاهر و مسیر).

/** چهار آیتم نوار پایین، به ترتیب نمایش (در RTL اولی سمت راست است). */
export const NAV_TABS = [
  { path: '/dashboard', label: 'داشبورد', icon: '🏠' },
  { path: '/price', label: 'قیمت', icon: '📈' },
  { path: '/operations', label: 'عملیات', icon: '+', primary: true },
  { path: '/settings', label: 'تنظیمات', icon: '⚙️' },
];

/**
 * صفحه‌های زیرمجموعه. `parent` = کدام آیتم نوار پایین هنگام باز بودن این صفحه
 * فعال بماند و پیوند بازگشت به کجا برود. `hint` = توضیح یک‌خطی کاشی.
 */
export const NAV_PAGES = [
  // زیر داشبورد
  { path: '/reports', parent: '/dashboard', label: 'گزارش‌ها', icon: '📊', hint: 'فروش، خرید، موجودی، مالی' },
  { path: '/inventory', parent: '/dashboard', label: 'انبار طلا', icon: '⚖️', hint: 'موجودی سطل‌ها و گردش' },
  { path: '/due-dates', parent: '/dashboard', label: 'سررسیدها', icon: '⏰', hint: 'دریافتنی و پرداختنی' },
  { path: '/accounts', parent: '/dashboard', label: 'حساب‌ها و صندوق‌ها', shortLabel: 'حساب‌ها', icon: '🏦', hint: 'صندوق، بانک، کارتخوان' },

  // زیر عملیات — فهرست اسناد
  { path: '/sales', parent: '/operations', label: 'فاکتورهای فروش', icon: '🧾', hint: 'فهرست، جزئیات، برگشت' },
  { path: '/purchases', parent: '/operations', label: 'اسناد خرید', icon: '🛒', hint: 'فهرست، جزئیات، ابطال' },

  // زیر تنظیمات
  { path: '/products', parent: '/settings', label: 'کالا', icon: '💍', hint: 'کالاهای کددار' },
  { path: '/customers', parent: '/settings', label: 'مشتریان', icon: '👥', hint: 'حساب و تسویه‌ی مشتری' },
  { path: '/suppliers', parent: '/settings', label: 'تأمین‌کنندگان', icon: '🏭', hint: 'حساب و تسویه‌ی تأمین‌کننده' },
  { path: '/backup', parent: '/settings', label: 'پشتیبان و خروجی', shortLabel: 'پشتیبان', icon: '💾', hint: 'پشتیبان JSON و Excel' },
  { path: '/install', parent: '/settings', label: 'نصب روی آیفون', shortLabel: 'نصب', icon: '📲', hint: 'آفلاین و ماندگاری داده' },
  // مسیر قدیمی «بیشتر» (Phase 2 تا 24) — نقشه‌ی کامل برنامه؛ نشانک‌های قدیمی نمی‌شکنند.
  { path: '/more', parent: '/settings', label: 'همه‌ی بخش‌ها', icon: '🗂️', hint: 'نقشه‌ی کامل برنامه' },
];

const TAB_BY_PATH = new Map(NAV_TABS.map((t) => [t.path, t]));
const PAGE_BY_PATH = new Map(NAV_PAGES.map((p) => [p.path, p]));

/** هر مسیری که در نقشه آمده (چهار آیتم + زیرصفحه‌ها). */
export function allNavPaths() {
  return [...NAV_TABS.map((t) => t.path), ...NAV_PAGES.map((p) => p.path)];
}

/** آیتم نوار پایینی که این مسیر زیر آن است (خودش اگر یکی از چهار آیتم باشد). */
export function tabOf(path) {
  if (TAB_BY_PATH.has(path)) return path;
  return PAGE_BY_PATH.get(path)?.parent ?? null;
}

/** اطلاعات یک مسیر (برچسب، آیکن، والد) — برای هر دو نوع. */
export function navEntry(path) {
  return PAGE_BY_PATH.get(path) || TAB_BY_PATH.get(path) || null;
}

/** زیرصفحه‌های یک آیتم نوار پایین، به ترتیب نقشه. */
export function childrenOf(tabPath) {
  return NAV_PAGES.filter((p) => p.parent === tabPath);
}

/**
 * پیوند بازگشت برای یک مسیر: { path, label } والد، یا null برای خودِ چهار آیتم
 * (آن‌ها از نوار پایین در دسترس‌اند و بازگشت لازم ندارند).
 */
export function backTargetOf(path) {
  const page = PAGE_BY_PATH.get(path);
  if (!page) return null;
  const tab = TAB_BY_PATH.get(page.parent);
  return tab ? { path: tab.path, label: tab.label } : null;
}
