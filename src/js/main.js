// main.js — نقطه ورود برنامه: راه‌اندازی DB، ثبت مسیرها، رندر اسکلت اصلی
import { openDatabase } from './db/db.js';
import { registerRoute, setDefaultRoute, startRouter } from './router.js';
import { renderHeader } from './components/Header.js';
import { renderBottomNav } from './components/BottomNav.js';
import { showUpdateBar } from './components/UpdateBar.js';
import { registerServiceWorker, applyUpdate } from './services/pwa.js';
import { startViewportSync, startFocusAssist } from './utils/viewport.js';
import { startViewerInsets } from './utils/viewerInsets.js';
import { startTheme } from './utils/theme.js';

import DashboardPage from './pages/Dashboard.js';
import ProductsPage from './pages/Products.js';
import CustomersPage from './pages/Customers.js';
import SuppliersPage from './pages/Suppliers.js';
import PurchasesPage from './pages/Purchases.js';
import SalesPage from './pages/Sales.js';
import AccountsPage from './pages/Accounts.js';
import InventoryPage from './pages/Inventory.js';
import DueDatesPage from './pages/DueDates.js';
import ReportsPage from './pages/Reports.js';
import BackupPage from './pages/Backup.js';
import InstallPage from './pages/Install.js'; // Phase 16
import SettingsPage from './pages/Settings.js';
import MorePage from './pages/More.js';
import PricePage from './pages/Price.js'; // Phase 25
import OperationsPage from './pages/Operations.js'; // Phase 25

async function bootstrap() {
  // Phase 24 — تم پیش از هر چیز (حتی پیش از باز شدن پایگاه‌داده) تا صفحه‌ی
  // خطای احتمالی و اولین فریم هم با تم درست دیده شوند.
  startTheme();

  try {
    await openDatabase();
  } catch (err) {
    console.error('[main] راه‌اندازی پایگاه‌داده ناموفق بود:', err);
    document.body.innerHTML =
      '<div class="fatal-error">خطا در راه‌اندازی پایگاه‌داده. لطفاً از مرورگری با پشتیبانی IndexedDB استفاده کنید یا صفحه را دوباره بارگذاری کنید.</div>';
    return;
  }

  setDefaultRoute('/dashboard');
  registerRoute('/dashboard', DashboardPage);
  registerRoute('/products', ProductsPage);
  registerRoute('/customers', CustomersPage);
  registerRoute('/suppliers', SuppliersPage);
  registerRoute('/purchases', PurchasesPage);
  registerRoute('/sales', SalesPage);
  registerRoute('/accounts', AccountsPage);
  registerRoute('/inventory', InventoryPage);
  registerRoute('/due-dates', DueDatesPage); // Phase 12
  registerRoute('/reports', ReportsPage);
  registerRoute('/backup', BackupPage); // Phase 15
  registerRoute('/install', InstallPage); // Phase 16
  registerRoute('/settings', SettingsPage);
  registerRoute('/more', MorePage); // Phase 25: «همه‌ی بخش‌ها» (مسیر قدیمی حفظ شد)
  registerRoute('/price', PricePage); // Phase 25
  registerRoute('/operations', OperationsPage); // Phase 25

  // Phase 20 — رزرو فضای نوار ابزار اپلیکیشن میزبان **پیش از** رندر هدر،
  // تا هدر از همان اولین فریم با ارتفاع درست ساخته شود و رابط نپرد.
  startViewerInsets();

  document.getElementById('app-header').appendChild(renderHeader());
  document.getElementById('app-bottom-nav').appendChild(renderBottomNav());

  // Phase 16 — همگام‌سازی با صفحه‌کلید مجازی iOS پیش از رندر اولین صفحه،
  // تا فرم‌ها از همان ابتدا مقدار درست --kb-inset را داشته باشند.
  startViewportSync();
  startFocusAssist();

  await startRouter();

  // ثبت Service Worker عمداً **بعد از** رندر اولین صفحه انجام می‌شود:
  // پیش‌کش ۱۱۷ فایل، پهنای باند و پردازنده می‌خواهد و نباید با بارگذاری
  // اولیه‌ی برنامه رقابت کند.
  registerServiceWorker({
    onUpdateReady: () => showUpdateBar({ onApply: applyUpdate }),
  });
}

bootstrap();
