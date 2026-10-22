// DueDates.js — صفحه‌ی «سررسیدها» (Phase 12)
// فهرست کامل سررسیدهای دریافتنی و پرداختنی با وضعیت زمانیِ مشتق‌شده.
// این صفحه هیچ وضعیتی نمی‌نویسد؛ همه‌چیز از services/dueDates.js خوانده می‌شود.
import { Select } from '../components/Select.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadingState } from '../components/LoadingState.js';
import { listDueItems, summarizeDueItems, getAlertDays } from '../services/dueDates.js';
import { formatRial } from '../utils/format.js';
import { summaryItem } from './docs/docFormParts.js';
import { DueItemCard } from './dueDates/DueItemCard.js';

const STATE_OPTIONS = [
  { value: 'open', label: 'همه‌ی تسویه‌نشده‌ها' },
  { value: 'alerts', label: 'فقط هشدارها (گذشته، امروز، نزدیک)' },
  { value: 'overdue', label: 'سررسید گذشته' },
  { value: 'today', label: 'امروز' },
  { value: 'near', label: 'نزدیک' },
  { value: 'future', label: 'آینده' },
  { value: 'settled', label: 'تسویه‌شده' },
];

const DIRECTION_OPTIONS = [
  { value: 'all', label: 'دریافتنی و پرداختنی' },
  { value: 'receivable', label: 'دریافتنی (مشتریان)' },
  { value: 'payable', label: 'پرداختنی (تأمین‌کنندگان)' },
];

/** فیلتر خالص روی آیتم‌های موتور — برای تست هم صادر می‌شود. */
export function filterDueItems(items, { state = 'open', direction = 'all' } = {}) {
  return items.filter((it) => {
    if (direction !== 'all' && it.direction !== direction) return false;
    if (state === 'open') return it.state !== 'settled' && it.state !== 'voided';
    if (state === 'alerts') return it.alert;
    return it.state === state;
  });
}

export default async function DueDatesPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'سررسیدها';
  header.appendChild(h1);
  wrap.appendChild(header);

  const nearDays = await getAlertDays();
  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent = nearDays
    ? `سررسیدهای ${nearDays} روز آینده «نزدیک» محسوب می‌شوند (قابل تغییر در تنظیمات).`
    : 'هشدار «نزدیک» در تنظیمات غیرفعال است؛ فقط سررسیدهای امروز و گذشته هشدار دارند.';
  wrap.appendChild(subtitle);

  const state = { state: 'open', direction: 'all' };

  const filters = document.createElement('div');
  filters.className = 'product-filters';
  const row = document.createElement('div');
  row.className = 'product-filters__row';
  row.append(
    Select({
      label: 'وضعیت',
      options: STATE_OPTIONS,
      value: state.state,
      onChange: (v) => {
        state.state = v;
        refresh();
      },
    }),
    Select({
      label: 'نوع',
      options: DIRECTION_OPTIONS,
      value: state.direction,
      onChange: (v) => {
        state.direction = v;
        refresh();
      },
    })
  );
  filters.appendChild(row);
  wrap.appendChild(filters);

  const summaryBar = document.createElement('div');
  summaryBar.className = 'summary-bar';
  wrap.appendChild(summaryBar);

  const listContainer = document.createElement('div');
  wrap.appendChild(listContainer);

  async function refresh() {
    listContainer.innerHTML = '';
    listContainer.appendChild(LoadingState({ label: '' }));
    let items;
    try {
      items = await listDueItems({ includeSettled: state.state === 'settled', nearDays });
    } catch (err) {
      console.error('[DueDatesPage] listDueItems', err);
      listContainer.innerHTML = '';
      summaryBar.innerHTML = '';
      listContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری سررسیدها' }));
      return;
    }

    const rows = filterDueItems(items, state);
    const { total } = summarizeDueItems(rows);
    const settledView = state.state === 'settled';
    summaryBar.innerHTML = '';
    summaryBar.append(
      summaryItem('تعداد', String(total.count)),
      summaryItem(settledView ? 'دریافتنی' : 'مانده دریافتنی', formatRial(settledView ? sumAmount(rows, 'receivable') : total.receivableIRR)),
      summaryItem(settledView ? 'پرداختنی' : 'مانده پرداختنی', formatRial(settledView ? sumAmount(rows, 'payable') : total.payableIRR))
    );

    listContainer.innerHTML = '';
    if (!rows.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '📅',
          title: 'سررسیدی با این فیلتر وجود ندارد',
          description: 'سررسید فاکتورهای رسیدی و ترکیبی اینجا نمایش داده می‌شود.',
        })
      );
      return;
    }
    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const it of rows) list.appendChild(DueItemCard(it, { onChanged: refresh }));
    listContainer.appendChild(list);
  }

  await refresh();
  return wrap;
}

function sumAmount(rows, direction) {
  return rows.filter((r) => r.direction === direction).reduce((s, r) => s + r.amountIRR, 0);
}
