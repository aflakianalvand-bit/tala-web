// Backup.js — صفحه‌ی «پشتیبان و خروجی» (Phase 15)
//
// این صفحه عمداً خطرناک‌ترین عملیات برنامه را در خود دارد، پس سه قاعده‌ی UI:
//   ۱) هیچ عملیات مخربی بدون **خلاصه‌ی داده + تأیید صریح** اجرا نمی‌شود.
//   ۲) پیش از هر بازگردانی/پاک‌سازی، یک نسخه‌ی اضطراری ساخته می‌شود و همان‌جا
//      دکمه‌ی بازگشت دیده می‌شود.
//   ۳) نتیجه با عدد گزارش می‌شود (چند رکورد، چند نادیده‌گرفته‌شده)، نه با «انجام شد».

import { Button } from '../components/Button.js';
import { Select } from '../components/Select.js';
import { Alert } from '../components/Alert.js';
import { Badge } from '../components/Badge.js';
import { showToast } from '../components/Toast.js';
import { confirmDialog } from '../components/ConfirmDialog.js';
import { deliverFile, pickTextFile } from '../utils/download.js';
import { XLSX_MIME } from '../utils/xlsx.js';
import { formatNumber } from '../utils/format.js';
import { displayDateLong } from './docs/docLabels.js';
import {
  createBackup,
  parseBackup,
  restoreBackup,
  integrityCheck,
  clearAllData,
  listRestorePoints,
  rollbackToRestorePoint,
  exportRestorePoint,
  lastBackupInfo,
  backupReminder,
  readAllData,
  BACKUP_STORES,
  backupReminderDays,
  BackupError,
} from '../services/backup.js';
import { buildEntitiesWorkbook, entitySheetKeys } from '../services/excelExport.js';

function card(title, subtitle = '') {
  const el = document.createElement('section');
  el.className = 'card card--shadow';
  const h = document.createElement('div');
  h.className = 'section__title';
  h.textContent = title;
  el.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'doc-line__note';
    sub.textContent = subtitle;
    el.appendChild(sub);
  }
  return el;
}

function row(labelText, valueText) {
  const el = document.createElement('div');
  el.className = 'detail-row';
  const l = document.createElement('span');
  l.className = 'detail-row__label';
  l.textContent = labelText;
  const v = document.createElement('span');
  v.className = 'detail-row__value';
  v.textContent = valueText;
  el.append(l, v);
  return el;
}

const intFa = (n) => formatNumber(n, { maximumFractionDigits: 0 });

export default async function BackupPage() {
  const wrap = document.createElement('div');
  wrap.className = 'backup-page';

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'پشتیبان و خروجی';
  header.appendChild(h1);
  wrap.appendChild(header);

  const reminderDays = await backupReminderDays();

  // ─────────────────────────── ۱) تهیه پشتیبان ───────────────────────────
  const exportCard = card(
    'تهیه فایل پشتیبان',
    'یک فایل JSON شامل تمام داده‌های برنامه: کالا، مشتری، تأمین‌کننده، خرید، فروش، دریافت و پرداخت، حساب‌ها، دفاتر، سررسیدها، تنظیمات و تاریخچه.'
  );

  const statusBox = document.createElement('div');
  exportCard.appendChild(statusBox);

  async function renderStatus() {
    statusBox.innerHTML = '';
    const [data, last, reminder] = await Promise.all([
      readAllData(),
      lastBackupInfo(),
      backupReminder({ days: reminderDays }),
    ]);
    const total = BACKUP_STORES.reduce((sum, name) => sum + (data[name]?.length || 0), 0);

    statusBox.appendChild(row('تعداد کل رکوردها', intFa(total)));
    statusBox.appendChild(row('آخرین پشتیبان', last ? displayDateLong(last.timestamp) : 'تا کنون پشتیبانی تهیه نشده است'));
    if (reminder.enabled && reminder.due) {
      statusBox.appendChild(
        Alert({
          variant: 'warning',
          message: last
            ? `${intFa(reminder.daysSince)} روز از آخرین پشتیبان گذشته است. داده‌ی این برنامه فقط روی همین دستگاه ذخیره می‌شود.`
            : 'هنوز هیچ پشتیبانی تهیه نکرده‌اید. داده‌ی این برنامه فقط روی همین دستگاه ذخیره می‌شود.',
        })
      );
    }
  }
  await renderStatus();

  const exportBtn = Button({
    label: 'ساخت فایل پشتیبان',
    variant: 'primary',
    fullWidth: true,
    icon: '💾',
    onClick: async () => {
      exportBtn.disabled = true;
      try {
        const result = await createBackup();
        await deliverFile(result.json, result.fileName, 'application/json');
        showToast(`پشتیبان با ${intFa(result.totalRecords)} رکورد ساخته شد: ${result.fileName}`, { variant: 'success' });
        await renderStatus();
      } catch (err) {
        console.error('[Backup] export', err);
        showToast('ساخت فایل پشتیبان ناموفق بود.', { variant: 'danger' });
      } finally {
        exportBtn.disabled = false;
      }
    },
  });
  exportCard.appendChild(exportBtn);
  wrap.appendChild(exportCard);

  // ─────────────────────────── ۲) خروجی Excel ───────────────────────────
  const excelCard = card(
    'خروجی Excel',
    'فایل .xlsx با یک برگه برای هر بخش. اعداد به‌صورت عدد واقعی نوشته می‌شوند، پس در Excel قابل جمع‌زدن و مرتب‌سازی‌اند.'
  );

  const entityField = Select({
    label: 'بخش',
    value: 'all',
    options: [{ value: 'all', label: 'همه‌ی بخش‌ها (یک فایل چندبرگه)' }, ...entitySheetKeys().map((s) => ({ value: s.key, label: s.name }))],
  });
  excelCard.appendChild(entityField);

  const excelBtn = Button({
    label: 'ساخت فایل Excel',
    variant: 'secondary',
    fullWidth: true,
    icon: '📊',
    onClick: async () => {
      excelBtn.disabled = true;
      try {
        const value = entityField.getSelect().value;
        const result = await buildEntitiesWorkbook(value === 'all' ? null : [value]);
        await deliverFile(result.bytes, result.fileName, XLSX_MIME);
        showToast(`فایل Excel با ${intFa(result.sheetCount)} برگه و ${intFa(result.rowCount)} ردیف ساخته شد.`, { variant: 'success' });
      } catch (err) {
        console.error('[Backup] excel', err);
        showToast('ساخت فایل Excel ناموفق بود.', { variant: 'danger' });
      } finally {
        excelBtn.disabled = false;
      }
    },
  });
  excelCard.appendChild(excelBtn);
  excelCard.appendChild(
    Alert({ variant: 'info', message: 'برای خروجی Excel هر گزارش (فروش، خرید، موجودی، مالی) از دکمه‌ی «خروجی Excel» در همان صفحه‌ی گزارش‌ها استفاده کنید.' })
  );
  wrap.appendChild(excelCard);

  // ─────────────────────────── ۳) بازگردانی ───────────────────────────
  const restoreCard = card('بازگردانی از فایل پشتیبان', 'ابتدا فایل بررسی و خلاصه‌اش نشان داده می‌شود؛ هیچ داده‌ای پیش از تأیید شما تغییر نمی‌کند.');

  // برچسب گزینه‌ها کوتاه است و توضیح به راهنمای زیر آن منتقل شد: روی عرض ۳۹۰px
  // (iPhone) متن بلندِ داخل کشویی بریده می‌شود و کاربر تفاوت دو حالت را نمی‌بیند.
  const MODE_HINTS = {
    replace: 'تمام داده‌ی فعلی پاک و با محتوای فایل جایگزین می‌شود — دیتابیس دقیقاً به وضعیت لحظه‌ی پشتیبان برمی‌گردد.',
    merge: 'فقط رکوردهایی که در برنامه نیستند اضافه می‌شوند؛ رکورد موجود هرگز بازنویسی نمی‌شود.',
  };
  const modeField = Select({
    label: 'حالت بازگردانی',
    value: 'replace',
    options: [
      { value: 'replace', label: 'جایگزینی کامل' },
      { value: 'merge', label: 'ادغام با داده‌ی فعلی' },
    ],
    hint: MODE_HINTS.replace,
    onChange: (value) => {
      const hint = modeField.querySelector('.field__hint');
      if (hint) hint.textContent = MODE_HINTS[value] || '';
    },
  });
  restoreCard.appendChild(modeField);

  const restoreResult = document.createElement('div');
  restoreResult.className = 'backup-result';

  const restoreBtn = Button({
    label: 'انتخاب فایل و بازگردانی',
    variant: 'danger',
    fullWidth: true,
    icon: '⬆️',
    onClick: async () => {
      restoreResult.innerHTML = '';
      const picked = await pickTextFile();
      if (!picked) return;

      let validated;
      try {
        validated = parseBackup(picked.text);
      } catch (err) {
        const message = err instanceof BackupError ? err.message : 'فایل انتخابی قابل خواندن نیست.';
        restoreResult.appendChild(Alert({ variant: 'danger', message }));
        return;
      }

      const mode = modeField.getSelect().value;
      const { summary, warnings } = validated;
      const detail = [
        `فایل: ${picked.name}`,
        `تاریخ ساخت: ${summary.exportedAt ? displayDateLong(summary.exportedAt) : 'نامشخص'}`,
        `تعداد رکورد: ${intFa(summary.totalRecords)}`,
        mode === 'replace'
          ? 'تمام داده‌ی فعلی برنامه پاک و با محتوای این فایل جایگزین می‌شود.'
          : 'فقط رکوردهایی که در برنامه نیستند اضافه می‌شوند؛ داده‌ی فعلی دست‌نخورده می‌ماند.',
        ...warnings,
        'پیش از انجام، یک نسخه‌ی اضطراری از وضعیت فعلی ساخته می‌شود.',
      ].join('\n');

      const okay = await confirmDialog({
        title: mode === 'replace' ? 'تأیید جایگزینی کامل' : 'تأیید ادغام',
        message: detail,
        confirmLabel: mode === 'replace' ? 'جایگزین کن' : 'ادغام کن',
        danger: mode === 'replace',
      });
      if (!okay) return;

      try {
        const result = await restoreBackup(validated.payload, { mode });
        const check = await integrityCheck(validated.payload, { mode });
        renderRestoreResult(result, check);
        showToast(`بازگردانی انجام شد: ${intFa(result.addedTotal)} رکورد.`, { variant: check.ok ? 'success' : 'warning' });
        await renderStatus();
        await renderPoints();
      } catch (err) {
        console.error('[Backup] restore', err);
        restoreResult.appendChild(Alert({ variant: 'danger', message: err instanceof BackupError ? err.message : 'بازگردانی ناموفق بود؛ داده‌ی برنامه تغییری نکرد.' }));
      }
    },
  });
  restoreCard.append(restoreBtn, restoreResult);
  wrap.appendChild(restoreCard);

  function renderRestoreResult(result, check) {
    restoreResult.innerHTML = '';
    restoreResult.appendChild(row('رکوردهای افزوده‌شده', intFa(result.addedTotal)));
    if (result.mode === 'merge') {
      restoreResult.appendChild(row('نادیده‌گرفته‌شده (از قبل موجود)', intFa(result.skippedTotal)));
    }
    if (result.conflicts.length) {
      restoreResult.appendChild(
        Alert({ variant: 'warning', message: `${intFa(result.conflicts.length)} رکورد به‌دلیل تعارض کد یکتا اضافه نشد؛ بقیه‌ی بازگردانی کامل انجام شد.` })
      );
    }
    if (result.allocationBackfill) {
      restoreResult.appendChild(Alert({ variant: 'info', message: 'این پشتیبان پیش از نسخه‌ی تخصیص ساخته شده بود؛ تخصیص فاکتورهای تسویه‌شده بازسازی شد.' }));
    }
    for (const warning of result.warnings) {
      restoreResult.appendChild(Alert({ variant: 'warning', message: warning }));
    }
    restoreResult.appendChild(
      Alert({
        variant: check.ok ? 'success' : 'danger',
        message: check.ok
          ? 'بررسی یکپارچگی: تمام رکوردهای فایل در برنامه موجودند.'
          : `بررسی یکپارچگی ایراد پیدا کرد: ${check.issues.join(' ')}`,
      })
    );
  }

  // ─────────────────────── ۴) نسخه‌ی اضطراری ───────────────────────
  const pointsCard = card(
    'نسخه‌ی اضطراری',
    'پیش از هر بازگردانی یا پاک‌سازی، و پیش از هر ارتقای داده‌ی برنامه، وضعیت همان لحظه اینجا نگه داشته می‌شود. از هر نوع فقط آخرین نسخه نگهداری می‌شود.'
  );
  const pointsBox = document.createElement('div');
  pointsCard.appendChild(pointsBox);

  async function renderPoints() {
    pointsBox.innerHTML = '';
    const points = await listRestorePoints();
    if (!points.length) {
      pointsBox.appendChild(Alert({ variant: 'info', message: 'هنوز نسخه‌ی اضطراری‌ای ساخته نشده است.' }));
      return;
    }
    for (const point of points) {
      const box = document.createElement('div');
      box.className = 'card';
      const head = document.createElement('div');
      head.className = 'entity-card__title';
      const title = document.createElement('span');
      title.textContent = displayDateLong(point.createdAt);
      head.append(
        title,
        Badge({ label: point.kindLabel || 'نسخه‌ی اضطراری', variant: point.kind === 'preMigration' ? 'warning' : 'neutral' }),
        Badge({ label: `${intFa(point.totalRecords)} رکورد`, variant: 'neutral' })
      );
      box.appendChild(head);
      box.appendChild(row('دلیل', point.reason || '—'));
      // (Phase 22) نسخه‌ی پیش از ارتقای داده داخل همین مرورگر است؛ Safari اجازه‌ی ذخیره‌ی
      // خودکار فایل را نمی‌دهد، پس با یک لمس به فایل پشتیبان تبدیل و بیرون برده می‌شود.
      box.appendChild(
        Button({
          label: 'ذخیره‌ی این نسخه به‌صورت فایل پشتیبان',
          variant: point.kind === 'preMigration' ? 'primary' : 'secondary',
          fullWidth: true,
          icon: '💾',
          onClick: async () => {
            try {
              const file = await exportRestorePoint(point.id);
              await deliverFile(file.json, file.fileName, 'application/json');
              showToast(`فایل ${file.fileName} با ${intFa(file.totalRecords)} رکورد ساخته شد.`, { variant: 'success' });
            } catch (err) {
              console.error('[Backup] export point', err);
              showToast('ساخت فایل از نسخه‌ی اضطراری ناموفق بود.', { variant: 'danger' });
            }
          },
        })
      );
      box.appendChild(
        Button({
          label: 'برگشت به این نسخه',
          variant: 'secondary',
          fullWidth: true,
          onClick: async () => {
            const okay = await confirmDialog({
              title: 'برگشت به نسخه‌ی اضطراری',
              message: `تمام داده‌ی فعلی با وضعیت ${displayDateLong(point.createdAt)} (${intFa(point.totalRecords)} رکورد) جایگزین می‌شود. این کار خودش نسخه‌ی اضطراری تازه نمی‌سازد.`,
              confirmLabel: 'برگردان',
              danger: true,
            });
            if (!okay) return;
            try {
              const done = await rollbackToRestorePoint(point.id);
              showToast(`${intFa(done.restoredRecords)} رکورد بازگردانده شد.`, { variant: 'success' });
              await renderStatus();
            } catch (err) {
              console.error('[Backup] rollback', err);
              showToast('برگشت به نسخه‌ی اضطراری ناموفق بود.', { variant: 'danger' });
            }
          },
        })
      );
      pointsBox.appendChild(box);
    }
  }
  await renderPoints();
  wrap.appendChild(pointsCard);

  // ─────────────────────── ۵) پاک‌سازی کامل ───────────────────────
  const dangerCard = card('پاک‌سازی کامل داده', 'همه‌ی اسناد، دفاتر و اطلاعات پایه حذف می‌شوند. فقط وقتی استفاده کنید که می‌خواهید از صفر شروع کنید.');
  const clearBtn = Button({
    label: 'پاک‌سازی کامل داده',
    variant: 'danger',
    fullWidth: true,
    icon: '🗑️',
    onClick: async () => {
      const data = await readAllData();
      const total = BACKUP_STORES.reduce((sum, name) => sum + (data[name]?.length || 0), 0);
      const okay = await confirmDialog({
        title: 'پاک‌سازی کامل داده',
        message: `${intFa(total)} رکورد پاک می‌شود: کالاها، مشتریان، تأمین‌کنندگان، اسناد خرید و فروش، دریافت و پرداخت، دفاتر و سررسیدها.\nپیش از پاک‌سازی یک نسخه‌ی اضطراری ساخته می‌شود، اما اگر هنوز فایل پشتیبان نگرفته‌اید، اول آن را بگیرید.`,
        confirmLabel: 'ادامه',
        danger: true,
      });
      if (!okay) return;
      const confirmAgain = await confirmDialog({
        title: 'مطمئن هستید؟',
        message: 'این عملیات همه‌ی داده‌ی کسب‌وکار را پاک می‌کند. برای ادامه تأیید کنید.',
        confirmLabel: 'پاک کن',
        danger: true,
      });
      if (!confirmAgain) return;
      try {
        const result = await clearAllData();
        showToast(`${intFa(result.clearedRecords)} رکورد پاک شد.`, { variant: 'success' });
        await renderStatus();
        await renderPoints();
      } catch (err) {
        console.error('[Backup] clear', err);
        showToast('پاک‌سازی ناموفق بود.', { variant: 'danger' });
      }
    },
  });
  dangerCard.appendChild(clearBtn);
  wrap.appendChild(dangerCard);

  return wrap;
}
