// service-worker.js — لایه‌ی آفلاین برنامه (بازنویسی کامل در Phase 16)
//
// ─────────────── سه قاعده‌ی این فایل ───────────────
//
// ۱) **پیش‌کش کامل، نه تدریجی.** تا Phase 15 فقط ۱۲ فایل پیش‌کش می‌شد و بقیه
//    «هر وقت کاربر رفت» کش می‌شدند. یعنی کاربری که برنامه را نصب می‌کرد و
//    فردا بدون اینترنت اولین فاکتور فروشش را می‌زد، به فایلی می‌رسید که هرگز
//    کش نشده بود. حالا کل برنامه در لحظه‌ی نصب کش می‌شود.
//
// ۲) **کش نسخه‌دار.** نام کش شامل هش محتوای کل برنامه است (SW_VERSION، تولید
//    خودکار). هر تغییر در کد ⇒ نام کش جدید ⇒ کش قدیمی حذف می‌شود. این همان
//    «تصمیم باز شماره ۳۱» است که تا Phase 15 حل نشده بود: کاربر روی PWA
//    نصب‌شده، کد فازهای جدید را تا پاک‌کردن دستی کش نمی‌دید.
//
// ۳) **به‌روزرسانی با اجازه‌ی کاربر، نه وسط کار.** نسخه‌ی جدید بی‌صدا دانلود
//    و در حالت waiting می‌ماند. برنامه یک نوار «نسخه‌ی جدید آماده است»
//    نشان می‌دهد و فقط با لمس کاربر جابه‌جا می‌شود. جایگزینی خودکار وسط ثبت
//    یک فاکتور نیمه‌تمام، داده‌ی فرم را از بین می‌برد.
//
// ⚠️ IndexedDB هیچ ارتباطی با این فایل ندارد. داده‌ی مالی در کش نیست و
//    پاک‌شدن کش هیچ رکوردی را حذف نمی‌کند.

/* === PRECACHE:BEGIN — تولید خودکار توسط tools/build-sw.mjs — دستی ویرایش نکنید === */
const SW_VERSION = 'ff65dd0f6f18';

// فایل‌های بحرانی: اگر حتی یکی از این‌ها پیش‌کش نشود، نصب نسخه‌ی جدید
// عمداً شکست می‌خورد و نسخه‌ی قبلی سرِ کار می‌ماند (نیمه‌کش = برنامه‌ی خراب).
const PRECACHE_CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/css/base.css',
  './src/css/components.css',
  './src/css/fonts.css',
  './src/css/layout.css',
  './src/css/print.css',
  './src/css/variables.css',
  './src/js/components/Alert.js',
  './src/js/components/Badge.js',
  './src/js/components/BottomNav.js',
  './src/js/components/Button.js',
  './src/js/components/Card.js',
  './src/js/components/ConfirmDialog.js',
  './src/js/components/EmptyState.js',
  './src/js/components/Header.js',
  './src/js/components/Input.js',
  './src/js/components/JalaliDatePicker.js',
  './src/js/components/KaratInput.js',
  './src/js/components/LabInput.js',
  './src/js/components/LoadingState.js',
  './src/js/components/Modal.js',
  './src/js/components/Select.js',
  './src/js/components/Switch.js',
  './src/js/components/Table.js',
  './src/js/components/Tabs.js',
  './src/js/components/Textarea.js',
  './src/js/components/ThemeSwitch.js',
  './src/js/components/Toast.js',
  './src/js/components/UpdateBar.js',
  './src/js/db/db.js',
  './src/js/db/repo.js',
  './src/js/db/schema.js',
  './src/js/main.js',
  './src/js/navigation.js',
  './src/js/pages/_placeholder.js',
  './src/js/pages/accounts/AccountDetail.js',
  './src/js/pages/accounts/AccountForm.js',
  './src/js/pages/accounts/accountLabels.js',
  './src/js/pages/accounts/CashFlowForm.js',
  './src/js/pages/accounts/TransferForm.js',
  './src/js/pages/Accounts.js',
  './src/js/pages/Backup.js',
  './src/js/pages/Customers.js',
  './src/js/pages/dashboard/KpiTile.js',
  './src/js/pages/dashboard/LedgerSummary.js',
  './src/js/pages/Dashboard.js',
  './src/js/pages/docs/docFormParts.js',
  './src/js/pages/docs/docLabels.js',
  './src/js/pages/docs/DocSheet.js',
  './src/js/pages/docs/voidGuard.js',
  './src/js/pages/dueDates/DueItemCard.js',
  './src/js/pages/DueDates.js',
  './src/js/pages/install/InstallBanner.js',
  './src/js/pages/Install.js',
  './src/js/pages/inventory/AdjustmentForm.js',
  './src/js/pages/inventory/BucketDetail.js',
  './src/js/pages/inventory/inventoryLabels.js',
  './src/js/pages/inventory/MeltForm.js',
  './src/js/pages/Inventory.js',
  './src/js/pages/More.js',
  './src/js/pages/nav/NavTiles.js',
  './src/js/pages/Operations.js',
  './src/js/pages/party/AllocationForm.js',
  './src/js/pages/party/PartyDetail.js',
  './src/js/pages/party/PartyForm.js',
  './src/js/pages/party/partyLabels.js',
  './src/js/pages/party/PartyListPage.js',
  './src/js/pages/party/SettlementForm.js',
  './src/js/pages/Price.js',
  './src/js/pages/products/ProductDetail.js',
  './src/js/pages/products/ProductForm.js',
  './src/js/pages/products/productLabels.js',
  './src/js/pages/Products.js',
  './src/js/pages/purchases/PurchaseDetail.js',
  './src/js/pages/purchases/PurchaseForm.js',
  './src/js/pages/purchases/purchaseLabels.js',
  './src/js/pages/Purchases.js',
  './src/js/pages/reports/reportFormat.js',
  './src/js/pages/reports/ReportView.js',
  './src/js/pages/Reports.js',
  './src/js/pages/sales/SaleDetail.js',
  './src/js/pages/sales/SaleForm.js',
  './src/js/pages/sales/saleLabels.js',
  './src/js/pages/sales/SaleReturnForm.js',
  './src/js/pages/Sales.js',
  './src/js/pages/settings/LabManager.js',
  './src/js/pages/Settings.js',
  './src/js/pages/Suppliers.js',
  './src/js/router.js',
  './src/js/services/accounts.js',
  './src/js/services/allocations.js',
  './src/js/services/backup.js',
  './src/js/services/cashFlow.js',
  './src/js/services/customers.js',
  './src/js/services/dashboard.js',
  './src/js/services/docNumber.js',
  './src/js/services/docSheet.js',
  './src/js/services/dueDates.js',
  './src/js/services/excelExport.js',
  './src/js/services/goldAccount.js',
  './src/js/services/goldEquivalent.js',
  './src/js/services/goldTotals.js',
  './src/js/services/inventory.js',
  './src/js/services/inventoryDocs.js',
  './src/js/services/labs.js',
  './src/js/services/ledger.js',
  './src/js/services/ledgerSummary.js',
  './src/js/services/party.js',
  './src/js/services/postings.js',
  './src/js/services/priceRates.js',
  './src/js/services/pricing.js',
  './src/js/services/products.js',
  './src/js/services/purchases.js',
  './src/js/services/pwa.js',
  './src/js/services/reports/docRefs.js',
  './src/js/services/reports/financialReports.js',
  './src/js/services/reports/index.js',
  './src/js/services/reports/inventoryReports.js',
  './src/js/services/reports/invoiceReports.js',
  './src/js/services/reports/model.js',
  './src/js/services/sales.js',
  './src/js/services/settings.js',
  './src/js/services/settlement.js',
  './src/js/services/settlements.js',
  './src/js/services/suppliers.js',
  './src/js/services/transfers.js',
  './src/js/services/units.js',
  './src/js/utils/date.js',
  './src/js/utils/dateRange.js',
  './src/js/utils/decimal.js',
  './src/js/utils/download.js',
  './src/js/utils/format.js',
  './src/js/utils/id.js',
  './src/js/utils/jalaliCalendar.js',
  './src/js/utils/theme.js',
  './src/js/utils/viewerInsets.js',
  './src/js/utils/viewport.js',
  './src/js/utils/xlsx.js',
  './src/fonts/Vazirmatn-Bold.woff2',
  './src/fonts/Vazirmatn-Regular.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

// فایل‌های غیربحرانی (Splash Screen ها): تلاش می‌شود ولی شکستشان مانع نصب نیست.
const PRECACHE_OPTIONAL = [
  './icons/splash/splash-1125x2436.png',
  './icons/splash/splash-1170x2532.png',
  './icons/splash/splash-1179x2556.png',
  './icons/splash/splash-1242x2688.png',
  './icons/splash/splash-1284x2778.png',
  './icons/splash/splash-1290x2796.png',
  './icons/splash/splash-750x1334.png',
  './icons/splash/splash-828x1792.png',
];
/* === PRECACHE:END === */

const CACHE_PREFIX = 'tala-';
const CACHE_NAME = CACHE_PREFIX + SW_VERSION;
const OFFLINE_FALLBACK = './index.html';

// ─────────────────────────── نصب ───────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // `cache: 'reload'` تضمین می‌کند فایل‌ها از شبکه بیایند نه از کش HTTP
      // مرورگر — وگرنه نسخه‌ی جدید می‌توانست با محتوای قدیمی پر شود.
      const requests = PRECACHE_CORE.map((url) => new Request(url, { cache: 'reload' }));

      // addAll اتمیک است: اگر یک فایل بحرانی نیاید، کل نصب شکست می‌خورد و
      // نسخه‌ی قبلی سرِ کار می‌ماند. این عمدی است — نصبِ نیمه‌کاره یعنی
      // برنامه‌ای که آفلاین وسط کار می‌شکند.
      await cache.addAll(requests);

      // Splash Screen ها: تلاش بدون ریسک شکست نصب.
      await Promise.all(
        PRECACHE_OPTIONAL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
    })()
  );
  // skipWaiting عمداً اینجا صدا زده نمی‌شود — قاعده‌ی ۳ بالا.
});

// ─────────────────────────── فعال‌سازی ───────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ─────────────────────────── واکشی ───────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // درخواست ناوبری (باز کردن برنامه): همیشه از کش پاسخ بده تا برنامه در
  // حالت آفلاین و با اینترنت ضعیف بلافاصله باز شود. مسیریابی Hash است،
  // پس همه‌ی صفحه‌ها از همین index.html می‌آیند.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(OFFLINE_FALLBACK, { ignoreSearch: true });
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return new Response(
            '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">' +
              '<body style="font-family:Tahoma;padding:2rem;text-align:center">' +
              'برنامه هنوز برای کار آفلاین آماده نشده است. یک بار با اینترنت باز کنید.' +
              '</body></html>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // بقیه‌ی فایل‌های هم‌مبدأ: Cache-first.
  // چون کل برنامه پیش‌کش شده و نام کش با هر تغییر کد عوض می‌شود، محتوای کش
  // هیچ‌وقت کهنه نمی‌ماند؛ پس Cache-first هم سریع‌ترین و هم درست‌ترین راهبرد است.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: false });
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return new Response('', { status: 503, statusText: 'offline' });
      }
    })()
  );
});

// ─────────────────────────── پیام‌ها ───────────────────────────
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  // کاربر روی «به‌روزرسانی» زده است.
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // صفحه‌ی «نصب روی آیفون» نسخه و تعداد فایل‌های کش‌شده را نمایش می‌دهد.
  if (data.type === 'VERSION' && event.ports && event.ports[0]) {
    const port = event.ports[0];
    (async () => {
      let cachedCount = 0;
      try {
        const cache = await caches.open(CACHE_NAME);
        cachedCount = (await cache.keys()).length;
      } catch {
        /* اگر Cache Storage در دسترس نباشد، صفر گزارش می‌شود */
      }
      port.postMessage({
        version: SW_VERSION,
        cacheName: CACHE_NAME,
        expected: PRECACHE_CORE.length + PRECACHE_OPTIONAL.length,
        cachedCount,
      });
    })();
  }
});
