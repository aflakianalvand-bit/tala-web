// Header.js — نوار بالای برنامه: نام، وضعیت اتصال و کلید همیشه‌دیدنیِ پشتیبان
//
// Phase 16 دو چیز به این نوار اضافه کرد:
//
// ۱) **کلید پشتیبان.** الزام فاز این بود که پشتیبان‌گیری «کاملاً واضح» باشد.
//    تا Phase 15 فقط آیتم هفتم منوی «بیشتر» بود. در برنامه‌ای که تمام
//    دفاتر مالی‌اش روی همین گوشی است و هیچ سروری پشتش نیست، مسیر پشتیبان
//    نباید سه لمس فاصله داشته باشد. حالا در تمام صفحه‌ها یک لمس است و اگر
//    از آخرین پشتیبان زیاد گذشته باشد، خودش رنگ هشدار می‌گیرد.
//
// ۲) **وضعیت اتصال فقط وقتی مهم است دیده می‌شود.** برچسب «آنلاین» در تمام
//    عمر برنامه فضای هدر را می‌گرفت بدون اینکه چیزی به کاربر بگوید — این
//    برنامه آفلاین هم کامل کار می‌کند. حالا نقطه همیشه هست و کلمه فقط
//    هنگام آفلاین‌شدن ظاهر می‌شود.

import { navigate } from '../router.js';
import { backupReminder, backupReminderDays, lastBackupInfo } from '../services/backup.js';
import { themeState, toggleTheme, THEME_CHANGE_EVENT } from '../utils/theme.js';

let backupBtn = null;

export function renderHeader() {
  const header = document.createElement('div');
  header.className = 'app-header';

  const title = document.createElement('div');
  title.className = 'app-header__title';
  title.textContent = 'طلا';
  header.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'app-header__actions';

  // ── وضعیت اتصال ──
  const status = document.createElement('div');
  status.className = 'app-header__status';
  status.id = 'connection-status';
  const dot = document.createElement('span');
  dot.className = 'app-header__status-dot';
  const label = document.createElement('span');
  status.append(dot, label);
  actions.appendChild(status);

  function updateStatus() {
    const online = navigator.onLine !== false;
    // آفلاین‌بودن در این برنامه خطا نیست؛ فقط یک واقعیت است. برچسب را
    // فقط در همان حالت نشان می‌دهیم تا هدر شلوغ نشود.
    label.textContent = online ? '' : 'آفلاین';
    dot.classList.toggle('is-offline', !online);
    status.setAttribute('aria-label', online ? 'آنلاین' : 'آفلاین');
  }
  updateStatus();
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);

  // ── کلید تم (Phase 24) ── یک لمس: روشن ⇄ تیره. «خودکار» در تنظیمات است.
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.className = 'header-icon-btn';
  themeBtn.id = 'header-theme';
  const syncThemeBtn = () => {
    const dark = themeState().theme === 'dark';
    themeBtn.textContent = dark ? '☀️' : '🌙';
    themeBtn.setAttribute('aria-label', dark ? 'تم روشن' : 'تم تیره');
    themeBtn.title = themeBtn.getAttribute('aria-label');
  };
  syncThemeBtn();
  themeBtn.addEventListener('click', () => toggleTheme());
  window.addEventListener(THEME_CHANGE_EVENT, syncThemeBtn);
  actions.appendChild(themeBtn);

  // ── کلید پشتیبان ──
  backupBtn = document.createElement('button');
  backupBtn.type = 'button';
  backupBtn.className = 'header-backup';
  backupBtn.id = 'header-backup';
  const icon = document.createElement('span');
  icon.className = 'header-backup__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '💾';
  const text = document.createElement('span');
  text.textContent = 'پشتیبان';
  backupBtn.append(icon, text);
  backupBtn.addEventListener('click', () => navigate('/backup'));
  actions.appendChild(backupBtn);

  header.appendChild(actions);

  // وضعیت پشتیبان از IndexedDB می‌آید؛ هدر منتظر آن نمی‌ماند.
  updateBackupStatus();

  return header;
}

/**
 * رنگ و توضیح کلید پشتیبان را با واقعیت هماهنگ می‌کند.
 * از router پس از هر تغییر صفحه صدا زده می‌شود تا بلافاصله بعد از تهیه‌ی
 * پشتیبان، هشدار هدر هم خاموش شود.
 */
export async function updateBackupStatus() {
  if (!backupBtn || !backupBtn.isConnected) return;
  try {
    const days = await backupReminderDays();
    const [reminder, last] = await Promise.all([backupReminder({ days }), lastBackupInfo()]);

    backupBtn.classList.remove('header-backup--due', 'header-backup--never');
    if (!last) {
      backupBtn.classList.add('header-backup--never');
      backupBtn.setAttribute('aria-label', 'هنوز هیچ پشتیبانی تهیه نشده است — تهیه پشتیبان');
      backupBtn.title = 'هنوز هیچ پشتیبانی تهیه نشده است';
    } else if (reminder.enabled && reminder.due) {
      backupBtn.classList.add('header-backup--due');
      backupBtn.setAttribute('aria-label', 'از آخرین پشتیبان مدتی گذشته است — تهیه پشتیبان');
      backupBtn.title = 'از آخرین پشتیبان مدتی گذشته است';
    } else {
      backupBtn.setAttribute('aria-label', 'پشتیبان و خروجی');
      backupBtn.title = 'پشتیبان و خروجی';
    }
  } catch (err) {
    // نبود وضعیت پشتیبان نباید هدر را از کار بیندازد.
    console.warn('[header] خواندن وضعیت پشتیبان ناموفق بود:', err);
  }
}
