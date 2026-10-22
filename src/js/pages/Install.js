// Install.js — صفحه‌ی «نصب روی آیفون» (Phase 16)
//
// این صفحه سه سؤالی را جواب می‌دهد که کاربر بدون آن‌ها نمی‌فهمد برنامه در
// چه وضعیتی است — و هر سه در این برنامه پیامد مالی دارند:
//
//   ۱) الان از کجا اجرا می‌شوم؟ (صفحه‌ی اصلی یا داخل مرورگر)
//      مهم است چون داده‌ی این دو، دو انبار جدا هستند.
//   ۲) آفلاین کار می‌کنم؟ (Service Worker فعال است یا نه و چرا)
//   ۳) داده‌ام ماندگار است؟ (ماندگاری Storage + فضای مصرفی)
//
// اصل حاکم بر متن‌های این صفحه: هیچ ادعای اطمینان‌بخشِ نادرست. «ماندگاری»
// تضمین Apple نیست و اینجا هم به‌عنوان تضمین معرفی نمی‌شود؛ تنها راهکار
// قطعی برای نجات داده، فایل پشتیبان است و صفحه همین را می‌گوید.

import { navigate } from '../router.js';
import { Button } from '../components/Button.js';
import { Alert } from '../components/Alert.js';
import { Select } from '../components/Select.js';
import { showToast } from '../components/Toast.js';
import { formatNumber } from '../utils/format.js';
import { pwaStatus, requestPersistentStorage, isStandalone } from '../services/pwa.js';
import { viewerEnvironment, setViewerPreference } from '../utils/viewerInsets.js';

function card(title, subtitle = '') {
  const el = document.createElement('section');
  el.className = 'card card--shadow';
  el.style.marginBottom = 'var(--space-3)';
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

function statusItem(label, value, tone = '') {
  const el = document.createElement('div');
  el.className = 'status-item' + (tone ? ` status-item--${tone}` : '');
  const l = document.createElement('span');
  l.className = 'status-item__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'status-item__value';
  v.textContent = value;
  el.append(l, v);
  return el;
}

function step(num, htmlParts) {
  const el = document.createElement('div');
  el.className = 'install-step';
  const n = document.createElement('div');
  n.className = 'install-step__num';
  n.textContent = formatNumber(num, { maximumFractionDigits: 0, persianDigits: true });
  const body = document.createElement('div');
  body.className = 'install-step__body';
  // متن به‌صورت قطعه‌قطعه ساخته می‌شود تا هیچ HTML ای از داده تولید نشود.
  for (const part of htmlParts) {
    if (typeof part === 'string') body.appendChild(document.createTextNode(part));
    else {
      const b = document.createElement('b');
      b.textContent = part.b;
      body.appendChild(b);
    }
  }
  el.append(n, body);
  return el;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${formatNumber(n, { maximumFractionDigits: 0 })} بایت`;
  if (n < 1024 * 1024) return `${formatNumber(n / 1024, { maximumFractionDigits: 1 })} کیلوبایت`;
  if (n < 1024 * 1024 * 1024) return `${formatNumber(n / (1024 * 1024), { maximumFractionDigits: 1 })} مگابایت`;
  return `${formatNumber(n / (1024 * 1024 * 1024), { maximumFractionDigits: 2 })} گیگابایت`;
}

const SW_REASONS = {
  insecure:
    'این آدرس روی HTTPS نیست. Safari حالت آفلاین را فقط روی https یا localhost فعال می‌کند. '
    + 'برنامه همچنان کار می‌کند ولی بدون اینترنت بالا نمی‌آید.',
  unsupported: 'این مرورگر از حالت آفلاین (Service Worker) پشتیبانی نمی‌کند.',
  error: 'ثبت حالت آفلاین با خطا مواجه شد. یک بار برنامه را ببندید و دوباره باز کنید.',
  unknown: 'حالت آفلاین در این محیط فعال نیست.',
};

export default async function InstallPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'نصب روی آیفون';
  header.appendChild(h1);
  wrap.appendChild(header);

  const status = await pwaStatus();

  // ─────────────── ۱) وضعیت نصب ───────────────
  const modeCard = card('وضعیت فعلی');
  if (status.standalone) {
    modeCard.appendChild(
      Alert({
        variant: 'success',
        message: 'برنامه از صفحه‌ی اصلی اجرا شده است — همان حالتی که برای استفاده‌ی روزمره توصیه می‌شود.',
      })
    );
  } else if (status.state === 'ios-other-browser') {
    modeCard.appendChild(
      Alert({
        variant: 'warning',
        message: 'روی آیفون فقط Safari می‌تواند برنامه را به صفحه‌ی اصلی اضافه کند. این آدرس را در Safari باز کنید.',
      })
    );
  } else {
    modeCard.appendChild(
      Alert({
        variant: 'info',
        message: 'برنامه داخل مرورگر باز است. با افزودن به صفحه‌ی اصلی، تمام‌صفحه و آفلاین اجرا می‌شود.',
      })
    );
  }
  wrap.appendChild(modeCard);

  // ─────────────── ۲) راهنمای افزودن به صفحه‌ی اصلی ───────────────
  if (!status.standalone) {
    const guide = card(
      'افزودن به صفحه‌ی اصلی',
      'این کار برنامه را مثل یک اپلیکیشن واقعی روی صفحه‌ی گوشی می‌گذارد: بدون نوار آدرس، تمام‌صفحه و بدون نیاز به اینترنت.'
    );
    const steps = document.createElement('div');
    steps.className = 'install-steps';
    steps.appendChild(step(1, ['در Safari، دکمه‌ی ', { b: 'اشتراک‌گذاری' }, ' (مربع با پیکان رو به بالا) در پایین صفحه را لمس کنید.']));
    steps.appendChild(step(2, ['کمی به پایین بروید و ', { b: 'Add to Home Screen' }, ' (افزودن به صفحه‌ی اصلی) را بزنید.']));
    steps.appendChild(step(3, ['نام را روی ', { b: 'طلا' }, ' بگذارید و ', { b: 'Add' }, ' را بزنید.']));
    steps.appendChild(step(4, ['از این به بعد برنامه را فقط از آیکون صفحه‌ی اصلی باز کنید، نه از داخل Safari.']));
    guide.appendChild(steps);

    guide.appendChild(
      Alert({
        variant: 'warning',
        message:
          'مهم: نسخه‌ی داخل Safari و نسخه‌ی صفحه‌ی اصلی، دو انبار داده‌ی جداگانه دارند. '
          + 'اگر تا الان داده‌ای در Safari ثبت کرده‌اید، پیش از جابه‌جایی یک فایل پشتیبان بگیرید و بعد از نصب، همان را بازگردانی کنید.',
      })
    );
    wrap.appendChild(guide);
  }

  // ─────────────── ۲.۵) تناسب صفحه در مرورگر میهمان (Phase 20) ───────────────
  // وقتی برنامه از داخل اپلیکیشن دیگری باز می‌شود (Documents، مرورگر داخلی
  // تلگرام/اینستاگرام)، آن اپلیکیشن نوار ابزار خودش را روی صفحه‌ی وب می‌اندازد
  // و دکمه‌ی «برگشت» میزبان روی دکمه‌ی «بستن» مودال ما می‌افتد. تشخیص خودکار
  // است ولی از روی User Agent — و هیچ تشخیص UA ای صددرصد نیست؛ پس کلید دستی
  // هم لازم است.
  const viewer = viewerEnvironment();
  const viewerCard = card(
    'تناسب صفحه در مرورگر میهمان',
    'بعضی اپلیکیشن‌ها (مثل Documents) نوار ابزار خودشان را روی صفحه می‌اندازند. در آن حالت برنامه بالا و پایین صفحه فضای بیشتری کنار می‌گذارد تا دکمه‌ها زیر نوار میزبان پنهان نشوند.'
  );
  const viewerList = document.createElement('div');
  viewerList.className = 'status-list';
  viewerList.appendChild(statusItem('تشخیص خودکار', viewer.detected ? 'مرورگر میهمان' : 'مرورگر معمولی'));
  viewerList.appendChild(
    statusItem('وضعیت فعلی', viewer.active ? 'فضای اضافی روشن' : 'فضای اضافی خاموش', viewer.active ? 'ok' : '')
  );
  viewerCard.appendChild(viewerList);

  const viewerSelect = Select({
    label: 'حالت',
    value: viewer.preference,
    options: [
      { value: 'auto', label: 'خودکار (پیشنهادشده)' },
      { value: 'on', label: 'همیشه روشن' },
      { value: 'off', label: 'همیشه خاموش' },
    ],
    hint: 'اگر دکمه‌های بالا یا پایین صفحه زیر نوار اپلیکیشن میزبان می‌روند، «همیشه روشن» را انتخاب کنید.',
    onChange: (value) => {
      const next = setViewerPreference(value);
      showToast(next.active ? 'فضای اضافی روشن شد.' : 'فضای اضافی خاموش شد.', { variant: 'success' });
      navigate('/install');
    },
  });
  const viewerHolder = document.createElement('div');
  viewerHolder.style.marginTop = 'var(--space-3)';
  viewerHolder.appendChild(viewerSelect);
  viewerCard.appendChild(viewerHolder);
  wrap.appendChild(viewerCard);

  // ─────────────── ۳) وضعیت آفلاین ───────────────
  const offlineCard = card('کار بدون اینترنت');
  const offlineList = document.createElement('div');
  offlineList.className = 'status-list';

  if (status.swSupported && status.controlled) {
    offlineList.appendChild(statusItem('حالت آفلاین', 'فعال', 'ok'));
    if (status.version) {
      offlineList.appendChild(statusItem('نسخه‌ی کدِ ذخیره‌شده', String(status.version.version)));
      offlineList.appendChild(
        statusItem(
          'فایل‌های آماده‌ی آفلاین',
          `${formatNumber(status.version.cachedCount, { maximumFractionDigits: 0 })} از ${formatNumber(status.version.expected, { maximumFractionDigits: 0 })}`,
          status.version.cachedCount >= status.version.expected ? 'ok' : 'warn'
        )
      );
    }
  } else if (status.swSupported) {
    offlineList.appendChild(statusItem('حالت آفلاین', 'در حال آماده‌سازی', 'warn'));
    offlineCard.appendChild(
      Alert({ variant: 'info', message: 'یک بار برنامه را ببندید و دوباره باز کنید تا کش آفلاین کامل شود.' })
    );
  } else {
    offlineList.appendChild(statusItem('حالت آفلاین', 'غیرفعال', 'bad'));
    offlineCard.appendChild(Alert({ variant: 'warning', message: SW_REASONS[status.swReason] || SW_REASONS.unknown }));
  }
  offlineList.appendChild(statusItem('اتصال فعلی', status.online ? 'آنلاین' : 'آفلاین'));
  offlineCard.appendChild(offlineList);
  wrap.appendChild(offlineCard);

  // ─────────────── ۴) ماندگاری داده ───────────────
  const storageCard = card(
    'ماندگاری داده روی این دستگاه',
    'تمام دفاتر مالی و موجودی طلا فقط داخل همین گوشی ذخیره می‌شوند و هیچ نسخه‌ای روی سرور نیست.'
  );
  const storageList = document.createElement('div');
  storageList.className = 'status-list';

  if (status.persisted === true) {
    storageList.appendChild(statusItem('وضعیت ماندگاری', 'ماندگار', 'ok'));
  } else if (status.persisted === false) {
    storageList.appendChild(statusItem('وضعیت ماندگاری', 'ماندگار نشده', 'warn'));
  } else {
    storageList.appendChild(statusItem('وضعیت ماندگاری', 'این مرورگر گزارش نمی‌دهد'));
  }

  if (status.estimate) {
    storageList.appendChild(statusItem('فضای مصرف‌شده', formatBytes(status.estimate.usage)));
    storageList.appendChild(statusItem('سقف فضای در دسترس', formatBytes(status.estimate.quota)));
  }
  storageCard.appendChild(storageList);

  if (status.estimate && status.estimate.quota > 0) {
    const meter = document.createElement('div');
    meter.className = 'storage-meter';
    const fill = document.createElement('div');
    fill.className = 'storage-meter__fill';
    fill.style.width = `${Math.min(100, Math.max(1, status.estimate.percent)).toFixed(1)}%`;
    meter.appendChild(fill);
    storageCard.appendChild(meter);
  }

  if (status.persisted !== true) {
    const persistBtn = Button({
      label: 'درخواست ماندگاری داده',
      variant: 'secondary',
      fullWidth: true,
      icon: '🔒',
      onClick: async () => {
        persistBtn.disabled = true;
        const granted = await requestPersistentStorage();
        persistBtn.disabled = false;
        if (granted === true) {
          showToast('ماندگاری داده فعال شد.', { variant: 'success' });
          navigate('/install');
        } else if (granted === false) {
          showToast('مرورگر درخواست را نپذیرفت. فایل پشتیبان همچنان تنها راه مطمئن است.', { variant: 'warning' });
        } else {
          showToast('این مرورگر از ماندگاری داده پشتیبانی نمی‌کند.', { variant: 'warning' });
        }
      },
    });
    const holder = document.createElement('div');
    holder.style.marginTop = 'var(--space-3)';
    holder.appendChild(persistBtn);
    storageCard.appendChild(holder);
  }
  wrap.appendChild(storageCard);

  // ─────────────── ۵) هشدار قطعی درباره‌ی از دست رفتن داده ───────────────
  const riskCard = card('چه چیزی داده را از بین می‌برد؟');
  const riskList = document.createElement('ul');
  riskList.className = 'install-steps';
  for (const text of [
    'حذف آیکون برنامه از صفحه‌ی اصلی — داده‌ی برنامه هم با آن پاک می‌شود.',
    'پاک‌کردن تاریخچه و داده‌های سایت‌ها در تنظیمات Safari.',
    'کم‌آمدن فضای گوشی، وقتی ماندگاری فعال نباشد.',
    'عوض‌کردن گوشی — داده به‌طور خودکار منتقل نمی‌شود.',
  ]) {
    const li = document.createElement('li');
    li.className = 'install-step__body';
    li.textContent = '• ' + text;
    riskList.appendChild(li);
  }
  riskCard.appendChild(riskList);
  riskCard.appendChild(
    Alert({
      variant: 'danger',
      message: 'در هر چهار حالت بالا، تنها چیزی که داده را برمی‌گرداند فایل پشتیبان است. آن را روی iCloud یا کامپیوتر نگه دارید.',
    })
  );
  const backupBtn = Button({
    label: 'رفتن به پشتیبان‌گیری',
    variant: 'primary',
    fullWidth: true,
    icon: '💾',
    onClick: () => navigate('/backup'),
  });
  const backupHolder = document.createElement('div');
  backupHolder.style.marginTop = 'var(--space-3)';
  backupHolder.appendChild(backupBtn);
  riskCard.appendChild(backupHolder);
  wrap.appendChild(riskCard);

  return wrap;
}

/** برای بنر داشبورد — آیا نمایش دعوت به نصب معنا دارد؟ */
export function shouldOfferInstall() {
  return !isStandalone();
}
