// Dashboard.js — داشبورد مدیریتی (Phase 13)
//
// ═══════════════════════════════════════════════════════════════════════════
// هدف صریح فاز: «مدیر در ۱۰ ثانیه وضعیت کسب‌وکار را بفهمد. از شلوغی جلوگیری کن.»
// چیدمان از همین یک جمله می‌آید و سه لایه دارد، به ترتیب اضطرار:
//
//   ۱) وضعیت لحظه‌ای — طلا و پول همین حالا: موجودی طلا (کارت قهرمان)، ارزش،
//      صندوق، مطالبات، بدهی. این اعداد بازه ندارند؛ «الان» هستند.
//   ۱٫۵) معین حساب (Phase 26) — مانده‌ی اشخاص به گرم ۷۵۰ با بد/بس؛ لمس ⇒ گردش حساب.
//   ۲) عملکرد دوره — با کلید امروز / ماه جاری / سال جاری: فروش، خرید، سود
//      تقریبی، میانگین اجرت، تعداد اسناد.
//   ۳) هشدار سررسید (Phase 12، دست‌نخورده) — تنها بخشی که «اقدام» می‌خواهد، پس
//      لمس هر ردیف مستقیماً سند را باز می‌کند.
//
// ضد شلوغی: هیچ عددی دو بار نمایش داده نمی‌شود. وقتی بازه روی «امروز» است،
// کارت‌های تکراری «فروش امروز/خرید امروز» ساخته نمی‌شوند؛ وقتی چیزی برای هشدار
// نیست، بخش هشدار یک خط سبز است نه یک جدول خالی. هر کارت که مقصدی دارد لمسی است
// تا داشبورد نقطه‌ی شروع ناوبری باشد، نه یک تابلوی بن‌بست.
//
// همه‌ی اعداد از `services/dashboard.js` می‌آیند؛ این فایل هیچ محاسبه‌ای ندارد.
// ═══════════════════════════════════════════════════════════════════════════

import { Alert } from '../components/Alert.js';
import { Button } from '../components/Button.js';
import { backupReminder, backupReminderDays, pendingMigrationBackup } from '../services/backup.js';
import { LoadingState } from '../components/LoadingState.js';
import { formatJalaliDateLong } from '../utils/date.js';
import { formatRial, formatRialCompact, formatGrams, formatNumber, formatBaseGrams } from '../utils/format.js';
import { navigate } from '../router.js';
import { getDueAlerts, calendarDayIndex } from '../services/dueDates.js';
import { getDashboard, DASHBOARD_PERIODS, DEFAULT_PERIOD } from '../services/dashboard.js';
import { summaryItem } from './docs/docFormParts.js';
import { DueGroup } from './dueDates/DueItemCard.js';
import { KpiTile, ChipRow } from './dashboard/KpiTile.js';
import { InstallBanner } from './install/InstallBanner.js'; // Phase 16
import { NavTiles } from './nav/NavTiles.js'; // Phase 25
import { LedgerSummarySection } from './dashboard/LedgerSummary.js'; // Phase 26
import { childrenOf } from '../navigation.js';

/**
 * بازه‌ی انتخاب‌شده در سطح ماژول نگه داشته می‌شود (نه در Storage): کاربری که به
 * فروش می‌رود و برمی‌گردد همان بازه را می‌بیند، ولی بستن برنامه پیش‌فرض را
 * برمی‌گرداند. همان الگویی که صفحه‌ی گزارش‌ها دارد.
 */
let selectedPeriod = DEFAULT_PERIOD;

function section(title, { action = null, ariaLabel = '' } = {}) {
  const el = document.createElement('section');
  el.className = 'section';
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  const head = document.createElement('div');
  head.className = 'page-header';
  const h2 = document.createElement('h2');
  h2.className = 'section__title';
  h2.textContent = title;
  head.appendChild(h2);
  if (action) head.appendChild(action);
  el.appendChild(head);
  return el;
}

function grid(tiles) {
  const el = document.createElement('div');
  el.className = 'kpi-grid';
  tiles.filter(Boolean).forEach((t) => el.appendChild(t));
  return el;
}

// ────────────────────────── کارت قهرمان: موجودی طلا ──────────────────────────

function GoldHero(inv) {
  const card = document.createElement('div');
  card.className = 'gold-hero kpi-card--tap';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  const go = () => navigate('/inventory');
  card.addEventListener('click', go);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  });

  const label = document.createElement('div');
  label.className = 'gold-hero__label';
  label.textContent = 'موجودی طلا';

  const value = document.createElement('div');
  value.className = 'gold-hero__value';
  value.textContent = formatGrams(inv.totalGrams);

  const sub = document.createElement('div');
  sub.className = 'gold-hero__sub';
  sub.textContent = formatRialCompact(inv.marketValueIRR);
  sub.title = `ارزش روز: ${formatRial(inv.marketValueIRR)}`;

  card.append(label, value, sub);

  card.appendChild(
    ChipRow(
      inv.byType.map((t) => ({
        label: t.label,
        value: formatGrams(t.grams),
        title: `${t.label}: ${formatGrams(t.grams)} — ارزش روز ${formatRial(t.marketValueIRR)}`,
      }))
    )
  );

  if (inv.totalGrams === 0) {
    const note = document.createElement('div');
    note.className = 'gold-hero__note';
    note.textContent = 'هنوز طلایی در انبار ثبت نشده است.';
    card.appendChild(note);
  }

  return card;
}

// ────────────────────────── کلید بازه ──────────────────────────

function PeriodSwitch(current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'period-switch';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'بازه‌ی عملکرد');
  for (const p of DASHBOARD_PERIODS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `period-switch__btn${p.key === current ? ' period-switch__btn--active' : ''}`;
    btn.textContent = p.label;
    btn.dataset.period = p.key;
    btn.setAttribute('aria-pressed', String(p.key === current));
    btn.addEventListener('click', () => {
      if (p.key !== current) onChange(p.key);
    });
    wrap.appendChild(btn);
  }
  return wrap;
}

// ────────────────────────── بخش هشدار سررسید (Phase 12) ──────────────────────────

function DueAlertsSection() {
  const el = document.createElement('section');
  el.className = 'section due-alerts';
  el.setAttribute('aria-label', 'هشدار سررسید');
  let renderedDay = null;

  async function refresh() {
    el.innerHTML = '';
    el.appendChild(LoadingState({ label: '' }));
    let alerts;
    try {
      alerts = await getDueAlerts();
    } catch (err) {
      console.error('[Dashboard] getDueAlerts', err);
      el.innerHTML = '';
      el.appendChild(Alert({ variant: 'danger', message: 'بارگذاری هشدارهای سررسید ناموفق بود.' }));
      return;
    }
    renderedDay = calendarDayIndex(new Date());
    el.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'page-header due-alerts__head';
    const h2 = document.createElement('h2');
    h2.className = 'section__title';
    h2.textContent = 'هشدار سررسید';
    head.append(h2, Button({ label: 'همه سررسیدها', variant: 'secondary', onClick: () => navigate('/due-dates') }));
    el.appendChild(head);

    const bar = document.createElement('div');
    bar.className = 'summary-bar';
    bar.append(
      summaryItem('سررسید گذشته', String(alerts.overdue.length), alerts.overdue.length ? 'danger' : ''),
      summaryItem('امروز', String(alerts.today.length), alerts.today.length ? 'danger' : ''),
      summaryItem(`${alerts.nearDays} روز آینده`, String(alerts.near.length)),
      summaryItem('مانده دریافتنی', formatBaseGrams(alerts.summary.total.receivableGrams)),
      summaryItem('مانده پرداختنی', formatBaseGrams(alerts.summary.total.payableGrams))
    );
    el.appendChild(bar);

    if (!alerts.count) {
      el.appendChild(
        Alert({
          variant: 'success',
          message: alerts.nearDays
            ? `هیچ سررسید گذشته، امروز یا ${alerts.nearDays} روز آینده‌ای ندارید.`
            : 'هیچ سررسید گذشته یا امروزی ندارید.',
        })
      );
      return;
    }

    if (alerts.overdue.length) {
      el.appendChild(DueGroup({ title: 'سررسید گذشته', items: alerts.overdue, onChanged: refresh, variant: 'overdue' }));
    }
    if (alerts.today.length) {
      el.appendChild(DueGroup({ title: 'سررسید امروز', items: alerts.today, onChanged: refresh, variant: 'today' }));
    }
    if (alerts.near.length) {
      el.appendChild(
        DueGroup({ title: `${alerts.nearDays} روز مانده`, items: alerts.near, onChanged: refresh, variant: 'near' })
      );
    }
  }

  function onVisible() {
    if (!el.isConnected) {
      document.removeEventListener('visibilitychange', onVisible);
      return;
    }
    if (document.visibilityState === 'visible' && renderedDay !== calendarDayIndex(new Date())) refresh();
  }
  document.addEventListener('visibilitychange', onVisible);

  el.refresh = refresh;
  return el;
}

// ────────────────────────── بخش‌های KPI ──────────────────────────

function NowSection(data) {
  const el = section('وضعیت امروز', { ariaLabel: 'وضعیت لحظه‌ای' });

  el.appendChild(GoldHero(data.inventory));

  const { receivables, payables, cash, inventory } = data;

  el.appendChild(
    grid([
      KpiTile({
        label: 'ارزش موجودی (نرخ روز)',
        value: formatRialCompact(inventory.marketValueIRR),
        caption: `${formatNumber(inventory.bucketCount, { maximumFractionDigits: 0 })} سطل انبار`,
        title: formatRial(inventory.marketValueIRR),
        onClick: () => navigate('/inventory'),
      }),
      KpiTile({
        label: 'موجودی صندوق‌ها',
        value: formatRialCompact(cash.totalIRR),
        caption: `${formatNumber(cash.accounts.length, { maximumFractionDigits: 0 })} حساب فعال`,
        variant: cash.totalIRR < 0 ? 'danger' : '',
        title: formatRial(cash.totalIRR),
        onClick: () => navigate('/accounts'),
      }),
      KpiTile({
        label: 'مطالبات از مشتریان',
        // (Phase 19) عدد اصلی گرم ۷۵۰ است؛ معادل ریالی در زیرنویس.
        value: formatBaseGrams(receivables.positiveGrams),
        caption: `${receivables.positiveParties} مشتری بدهکار · ${formatRialCompact(receivables.positiveIRR)}`,
        variant: receivables.positiveGrams ? 'warning' : '',
        title: formatRial(receivables.positiveIRR),
        onClick: () => navigate('/customers'),
      }),
      KpiTile({
        label: 'بدهی به تأمین‌کنندگان',
        value: formatBaseGrams(payables.positiveGrams),
        caption: `${payables.positiveParties} تأمین‌کننده طلبکار · ${formatRialCompact(payables.positiveIRR)}`,
        variant: payables.positiveGrams ? 'danger' : '',
        title: formatRial(payables.positiveIRR),
        onClick: () => navigate('/suppliers'),
      }),
    ])
  );

  return el;
}

function PerformanceSection(data, onPeriodChange) {
  const el = section('عملکرد', {
    ariaLabel: 'عملکرد دوره',
    action: Button({ label: 'گزارش‌ها', variant: 'secondary', onClick: () => navigate('/reports') }),
  });
  el.appendChild(PeriodSwitch(data.period.key, onPeriodChange));

  const rangeLabel = document.createElement('div');
  rangeLabel.className = 'period-switch__range';
  rangeLabel.textContent = data.period.rangeLabel;
  el.appendChild(rangeLabel);

  const isToday = data.period.key === 'today';
  const { sales, purchases, profit, wage } = data;
  const p = data.period.label;

  const tiles = [];

  // کارت‌های «امروز» فقط وقتی ساخته می‌شوند که بازه چیز دیگری باشد — وگرنه
  // دقیقاً همان دو عدد زیرشان تکرار می‌شدند.
  if (!isToday) {
    tiles.push(
      KpiTile({
        label: 'فروش امروز',
        value: formatRialCompact(sales.today.netIRR),
        caption: `${sales.today.count} فاکتور · ${formatGrams(sales.today.netWeightGrams)}`,
        variant: sales.today.netIRR ? 'success' : 'muted',
        title: formatRial(sales.today.netIRR),
        onClick: () => navigate('/sales'),
      }),
      KpiTile({
        label: 'خرید امروز',
        value: formatRialCompact(purchases.today.netIRR),
        caption: `${purchases.today.count} سند · ${formatGrams(purchases.today.netWeightGrams)}`,
        variant: 'muted',
        title: formatRial(purchases.today.netIRR),
        onClick: () => navigate('/purchases'),
      })
    );
  }

  tiles.push(
    KpiTile({
      label: `فروش ${p}`,
      value: formatRialCompact(sales.period.netIRR),
      caption: sales.period.returnIRR
        ? `پس از ${formatRialCompact(sales.period.returnIRR)} برگشت`
        : formatGrams(sales.period.netWeightGrams),
      variant: sales.period.netIRR ? 'success' : 'muted',
      title: formatRial(sales.period.netIRR),
      onClick: () => navigate('/sales'),
    }),
    KpiTile({
      label: `خرید ${p}`,
      value: formatRialCompact(purchases.period.netIRR),
      caption: formatGrams(purchases.period.netWeightGrams),
      variant: 'muted',
      title: formatRial(purchases.period.netIRR),
      onClick: () => navigate('/purchases'),
    }),
    KpiTile({
      label: `سود تقریبی ${p}`,
      value: formatRialCompact(profit.periodIRR),
      caption: 'اجرت + سود + کارمزد، منهای اجرت خرید',
      variant: profit.periodIRR > 0 ? 'success' : profit.periodIRR < 0 ? 'danger' : 'muted',
      title: `${formatRial(profit.periodIRR)} — بهای خودِ طلا و نوسان قیمت در این عدد نیست.`,
    }),
    KpiTile({
      label: 'میانگین اجرت',
      value: wage.avgPerGramIRR === null ? '—' : formatNumber(wage.avgPerGramIRR, { maximumFractionDigits: 0 }),
      numeric: wage.avgPerGramIRR !== null,
      caption: wage.avgPerGramIRR === null ? 'فروشی در این بازه نبوده' : `ریال بر گرم · ${formatGrams(wage.weightGrams)}`,
      title: wage.avgPerGramIRR === null ? '' : `کل اجرت ${formatRial(wage.totalIRR)} ÷ ${formatGrams(wage.weightGrams)}`,
    }),
    KpiTile({
      label: `تعداد سند ${p}`,
      value: formatNumber(sales.period.count, { maximumFractionDigits: 0 }),
      numeric: true,
      caption: sales.period.returnCount
        ? `فاکتور فروش · ${purchases.period.count} سند خرید · ${sales.period.returnCount} برگشت از فروش`
        : `فاکتور فروش · ${purchases.period.count} سند خرید`,
      wide: true,
      onClick: () => navigate('/sales'),
    })
  );

  el.appendChild(grid(tiles));
  return el;
}

// ────────────────────────── صفحه ──────────────────────────

export default async function DashboardPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'داشبورد';
  header.appendChild(h1);
  wrap.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent = formatJalaliDateLong();
  wrap.appendChild(subtitle);

  // ─────────────── بخش‌های زیر داشبورد (Phase 25) ───────────────
  // گزارش‌ها، انبار، سررسیدها و حساب‌ها از نوار پایین به اینجا آمدند: یک ردیف
  // فشرده بالای صفحه، تا نه گم شوند و نه کارت‌های وضعیت را پایین هل بدهند.
  wrap.appendChild(NavTiles(childrenOf('/dashboard').map((p) => p.path), { variant: 'strip', label: 'بخش‌های داشبورد' }));

  // ─────────────── دعوت به نصب روی صفحه‌ی اصلی (Phase 16) ───────────────
  // بالای صفحه ولی بالای کارت طلا نه: تا وقتی برنامه داخل مرورگر باز است،
  // نه آفلاین کار می‌کند و نه داده‌اش ماندگار است — پس یک‌بار دیده‌شدن لازم
  // است. پس از نصب (یا بستنِ دستی) دیگر ساخته نمی‌شود.
  const installBanner = InstallBanner();
  if (installBanner) wrap.appendChild(installBanner);

  // میزبان KPIها: با تعویض بازه فقط همین بخش دوباره ساخته می‌شود، نه کل صفحه —
  // بخش هشدار سررسید (که ممکن است باز و اسکرول‌شده باشد) دست نمی‌خورد.
  const kpiHost = document.createElement('div');
  wrap.appendChild(kpiHost);

  // (Phase 26) معین حساب: لایه‌ی دوم، بلافاصله پس از «وضعیت امروز». یک بار ساخته
  // می‌شود و با تعویض بازه فقط جابه‌جا می‌شود، نه دوباره خوانده (بازه ندارد؛ «الان» است).
  const ledgerSection = LedgerSummarySection();

  const dueSection = DueAlertsSection();
  wrap.appendChild(dueSection);

  // ─────────────── یادآوری پشتیبان‌گیری (Phase 15) ───────────────
  // پایین صفحه و از جنس «یادآوری»، نه «هشدار عملیاتی»: سررسید گذشته پول واقعی
  // است و باید بالاتر بماند. اگر ساخت یادآوری شکست بخورد، داشبورد سالم می‌ماند.
  const backupHost = document.createElement('div');
  wrap.appendChild(backupHost);

  async function renderBackupReminder() {
    try {
      const days = await backupReminderDays();
      const reminder = await backupReminder({ days });
      backupHost.innerHTML = '';
      // (Phase 22) پس از ارتقای داده: پشتیبان خودکارِ پیش از ارتقا باید به فایل تبدیل شود.
      const pending = await pendingMigrationBackup();
      if (pending) {
        const migrationAlert = Alert({
          variant: 'warning',
          message:
            `برنامه به‌روز شد و پیش از تبدیل داده (نسخه‌ی ${pending.fromVersion} به ${pending.toVersion}) یک پشتیبان خودکار ` +
            `از ${pending.totalRecords} رکورد ساخته شد. برای امنیت بیشتر، آن را از صفحه‌ی «پشتیبان» به‌صورت فایل ذخیره کنید.`,
        });
        migrationAlert.style.cursor = 'pointer';
        migrationAlert.setAttribute('role', 'button');
        migrationAlert.tabIndex = 0;
        migrationAlert.addEventListener('click', () => navigate('/backup'));
        backupHost.appendChild(migrationAlert);
      }
      if (!reminder.enabled || !reminder.due) return;
      const alert = Alert({
        variant: 'warning',
        message: reminder.last
          ? `${reminder.daysSince} روز از آخرین پشتیبان گذشته است. برای تهیه‌ی پشتیبان به «بیشتر ← پشتیبان و خروجی» بروید.`
          : 'هنوز پشتیبانی تهیه نکرده‌اید. داده‌ی برنامه فقط روی همین دستگاه ذخیره می‌شود.',
      });
      alert.style.cursor = 'pointer';
      alert.setAttribute('role', 'button');
      alert.tabIndex = 0;
      alert.addEventListener('click', () => navigate('/backup'));
      backupHost.appendChild(alert);
    } catch (err) {
      console.error('[Dashboard] backupReminder', err);
    }
  }

  async function renderKpis() {
    kpiHost.innerHTML = '';
    kpiHost.appendChild(LoadingState({ label: 'در حال محاسبه‌ی وضعیت کسب‌وکار…' }));
    let data;
    try {
      data = await getDashboard({ period: selectedPeriod });
    } catch (err) {
      console.error('[Dashboard] getDashboard', err);
      kpiHost.innerHTML = '';
      kpiHost.appendChild(Alert({ variant: 'danger', message: 'محاسبه‌ی شاخص‌های داشبورد ناموفق بود.' }));
      return;
    }
    kpiHost.innerHTML = '';
    kpiHost.appendChild(NowSection(data));
    kpiHost.appendChild(ledgerSection);
    kpiHost.appendChild(
      PerformanceSection(data, (key) => {
        selectedPeriod = key;
        renderKpis();
      })
    );
  }

  await Promise.all([renderKpis(), ledgerSection.refresh(), dueSection.refresh(), renderBackupReminder()]);
  return wrap;
}
