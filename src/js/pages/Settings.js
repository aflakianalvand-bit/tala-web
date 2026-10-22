// Settings.js — تنظیمات (Phase 8، بازچینی Phase 25)
//
// Phase 25: «نرخ روز طلا» به صفحه‌ی مستقل «قیمت» (pages/Price.js) رفت و بالای این
// صفحه کاشی‌های کالا، مشتریان، تأمین‌کنندگان، پشتیبان، نصب و «همه‌ی بخش‌ها» آمد.
//   «تنظیمات عمومی» → ویرایش‌پذیر: نمایش اعداد، گام ریال، جهت گِرد کردن گرم ۷۵۰،
//                    نام کاربر، هشدار سررسید. (Phase 22: گام وزن حذف شد؛ نوشتن از services/settings.js)
//
// هیچ‌کدام روی فاکتورهای گذشته اثر ندارند: مقادیر مؤثر در لحظه‌ی ثبت، داخل خود
// سند Snapshot می‌شوند (دستور پروژه §11).
import { saveGeneralSettings, findSettings, SettingsValidationError, SETTINGS_ID, DEFAULT_USER_NAME } from '../services/settings.js';
import { ROUNDING_MODE_LABELS, DEFAULT_ROUNDING_MODE } from '../services/units.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';
import { Button } from '../components/Button.js';
import { Alert } from '../components/Alert.js';
import { showToast } from '../components/Toast.js';
import { ROUNDING_DEFAULTS } from '../services/priceRates.js';
import { BACKUP_REMINDER_DEFAULT_DAYS } from '../services/backup.js';
import { LabManager } from './settings/LabManager.js';
import { ThemeSwitch } from '../components/ThemeSwitch.js';
import { NavTiles } from './nav/NavTiles.js';
import { childrenOf } from '../navigation.js';

const DEFAULTS = {
  id: SETTINGS_ID,
  numberFormat: 'en',
  dueDateAlertDaysAhead: 3,
  backupReminderDays: BACKUP_REMINDER_DEFAULT_DAYS,
  ...ROUNDING_DEFAULTS,
};

function sectionCard(title, subtitle = '') {
  const card = document.createElement('form');
  card.className = 'card card--shadow';
  const h = document.createElement('div');
  h.className = 'section__title';
  h.textContent = title;
  card.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'doc-line__note';
    sub.textContent = subtitle;
    card.appendChild(sub);
  }
  return card;
}

export default async function SettingsPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'تنظیمات';
  header.appendChild(h1);
  wrap.appendChild(header);

  // ─────────────────────────── بخش‌ها (Phase 25) ───────────────────────────
  // کالا، اشخاص، پشتیبان و نصب از منوی «بیشتر» (حذف‌شده) به اینجا آمدند.
  // نرخ روز به صفحه‌ی «قیمت» در نوار پایین رفت.
  const hub = document.createElement('section');
  hub.className = 'section';
  hub.appendChild(NavTiles(childrenOf('/settings').map((p) => p.path), { variant: 'grid', label: 'بخش‌های تنظیمات' }));
  wrap.appendChild(hub);

  let settings = await findSettings();
  if (!settings) settings = { ...DEFAULTS };

  // ─────────────────────────── ظاهر (Phase 24) ───────────────────────────
  // ترجیح نمایشیِ همین دستگاه (localStorage) — وارد پشتیبان نمی‌شود.
  // عمداً <section> نه <form>: چیزی ذخیره نمی‌کند و نباید با فرم‌های ذخیره قاطی شود.
  const lookCard = document.createElement('section');
  lookCard.className = 'card card--shadow';
  lookCard.setAttribute('aria-labelledby', 'look-title');
  const lookTitle = document.createElement('div');
  lookTitle.className = 'section__title';
  lookTitle.id = 'look-title';
  lookTitle.textContent = 'ظاهر برنامه';
  const lookSub = document.createElement('div');
  lookSub.className = 'doc-line__note';
  lookSub.textContent = 'پیش‌فرض «خودکار» است: با تنظیم روشن/تیره‌ی آیفون همراه می‌شود.';
  lookCard.append(lookTitle, lookSub, ThemeSwitch());
  wrap.appendChild(lookCard);

  // ─────────────────────────── تنظیمات عمومی ───────────────────────────
  const form = sectionCard('تنظیمات عمومی');

  const numberFormatField = Select({
    label: 'نمایش اعداد',
    value: settings.numberFormat || 'en',
    options: [
      { value: 'en', label: 'ارقام لاتین (۱۲۳۴۵۶۷۸۹۰ → 1234567890)' },
      { value: 'fa', label: 'ارقام فارسی (۱۲۳۴۵۶۷۸۹۰)' },
    ],
  });

  const roundField = Input({
    label: 'گرد کردن مبالغ (ریال)',
    value: String(settings.roundToRials ?? ROUNDING_DEFAULTS.roundToRials),
    numeric: true,
    inputmode: 'numeric',
    hint: 'فقط مبلغ نهایی هر قلم گرد می‌شود؛ اجزای میانی با دقت کامل محاسبه می‌شوند.',
  });

  // Phase 22: گام وزن حذف شد (وزن ترازو با سه رقم عیناً ثبت می‌شود). به‌جای آن، جهت
  // گِرد کردن معادل ۷۵۰ در رقم سوم اعشار — فقط روی مقادیر محاسبه‌شده.
  const gramsModeField = Select({
    label: 'گرد کردن گرم ۷۵۰ (رقم سوم اعشار)',
    value: settings.gramsRoundingMode ?? DEFAULT_ROUNDING_MODE,
    options: Object.entries(ROUNDING_MODE_LABELS).map(([value, label]) => ({ value, label })),
    hint: 'مثال «رو به بالا»: ۸٫۸۴۳۴۵ ← ۸٫۸۴۴. وزن ترازو هرگز گرد نمی‌شود؛ هر سند حالتِ روزِ ثبت خودش را نگه می‌دارد.',
  });

  const userNameField = Input({
    label: 'نام کاربر',
    value: settings.userName || DEFAULT_USER_NAME,
    hint: 'روی هر سند جدید به‌عنوان «ثبت‌کننده» ذخیره می‌شود.',
  });

  const dueAlertField = Input({
    label: 'هشدار سررسید (چند روز قبل)',
    value: String(settings.dueDateAlertDaysAhead ?? 3),
    numeric: true,
    inputmode: 'numeric',
  });

  const backupReminderField = Input({
    label: 'یادآوری پشتیبان‌گیری (هر چند روز)',
    value: String(settings.backupReminderDays ?? BACKUP_REMINDER_DEFAULT_DAYS),
    numeric: true,
    inputmode: 'numeric',
    hint: 'اگر بیش از این تعداد روز از آخرین پشتیبان بگذرد، در داشبورد هشدار داده می‌شود. صفر = خاموش.',
  });

  form.append(numberFormatField, roundField, gramsModeField, userNameField, dueAlertField, backupReminderField);
  form.appendChild(
    Alert({
      variant: 'info',
      message: 'تغییر این تنظیمات فقط روی اسناد جدید اثر دارد؛ فاکتورهای ثبت‌شده با مقادیر همان روز خود باقی می‌مانند.',
    })
  );
  form.appendChild(Button({ label: 'ذخیره تنظیمات', variant: 'primary', type: 'submit', fullWidth: true }));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveGeneralSettings({
        numberFormat: numberFormatField.getSelect().value,
        roundToRials: roundField.getValue(),
        gramsRoundingMode: gramsModeField.getSelect().value,
        userName: userNameField.getInput().value,
        dueDateAlertDaysAhead: dueAlertField.getValue(),
        backupReminderDays: backupReminderField.getValue(),
      });
      showToast('تنظیمات با موفقیت ذخیره شد.', { variant: 'success' });
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        showToast(Object.values(err.fieldErrors).join(' '), { variant: 'danger' });
        return;
      }
      console.error(err);
      showToast('ذخیره تنظیمات ناموفق بود.', { variant: 'danger' });
    }
  });

  // ─────────────────────────── آزمایشگاه‌ها (Phase 23) ───────────────────────────
  // پیش از «تنظیمات عمومی» تا فرم ذخیره‌ی تنظیمات همچنان آخرین کارت صفحه بماند.
  wrap.appendChild(LabManager(sectionCard));

  wrap.appendChild(form);
  return wrap;
}
