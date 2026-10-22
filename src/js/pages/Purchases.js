// Purchases.js — خرید طلا (Phase 6: فهرست اسناد، ثبت، جزئیات، لغو و اصلاح)
// این صفحه هرگز مستقیماً روی IndexedDB نمی‌نویسد؛ همه چیز از services/purchases.js عبور می‌کند.
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';
import { Badge } from '../components/Badge.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadingState } from '../components/LoadingState.js';
import { listPurchases, summarizePurchases } from '../services/purchases.js';
import { formatRial, formatGrams } from '../utils/format.js';
import { openPurchaseForm } from './purchases/PurchaseForm.js';
import { openPurchaseDetail } from './purchases/PurchaseDetail.js';
import { purchaseStatusBadge, PAYMENT_MODE_LABELS, displayDate } from './purchases/purchaseLabels.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'همه اسناد' },
  { value: 'open', label: 'باز (بدهی دارد)' },
  { value: 'settled', label: 'تسویه‌شده' },
  { value: 'voided', label: 'باطل‌شده' },
];

function purchaseCard(row, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'entity-card purchase-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const supplierName = document.createElement('span');
  supplierName.className = 'entity-card__name';
  supplierName.textContent = row.supplierName;
  title.append(supplierName, Badge({ label: row.number, variant: 'neutral' }));

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';
  const date = document.createElement('span');
  date.textContent = displayDate(row.date);
  const weight = document.createElement('span');
  weight.className = 'num';
  weight.textContent = formatGrams(row.totalWeightGrams);
  const mode = document.createElement('span');
  mode.textContent = PAYMENT_MODE_LABELS[row.paymentMode] || row.paymentMode;
  meta.append(date, weight, mode);

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const amount = document.createElement('span');
  amount.className = 'entity-card__amount num';
  amount.textContent = formatRial(row.grandTotalIRR);
  const status = purchaseStatusBadge(row);
  side.append(amount, Badge({ label: status.label, variant: status.variant }));
  if (row.status === 'open') {
    const remaining = document.createElement('span');
    remaining.className = 'entity-card__amount-label num';
    remaining.textContent = `باقیمانده ${formatRial(row.remainingIRR)}`;
    side.appendChild(remaining);
  }

  card.append(main, side);
  card.addEventListener('click', () => onOpen(row));
  return card;
}

export default async function PurchasesPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'خرید طلا';
  header.appendChild(h1);
  const addBtn = Button({ label: 'ثبت خرید', variant: 'primary', icon: '+' });
  header.appendChild(addBtn);
  wrap.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent = 'خرید نقدی، رسیدی و ترکیبی از تأمین‌کنندگان';
  wrap.appendChild(subtitle);

  const state = { search: '', status: 'all' };

  const filters = document.createElement('div');
  filters.className = 'product-filters';
  const searchField = Input({
    placeholder: 'جستجو بر اساس شماره سند یا تأمین‌کننده…',
    onInput: (value) => {
      state.search = value;
      scheduleRefresh();
    },
  });
  const filterRow = document.createElement('div');
  filterRow.className = 'product-filters__row';
  filterRow.appendChild(
    Select({
      options: STATUS_OPTIONS,
      value: state.status,
      onChange: (value) => {
        state.status = value;
        refresh();
      },
    })
  );
  filters.append(searchField, filterRow);
  wrap.appendChild(filters);

  const summaryBar = document.createElement('div');
  summaryBar.className = 'summary-bar';
  wrap.appendChild(summaryBar);

  const listContainer = document.createElement('div');
  wrap.appendChild(listContainer);

  let debounceTimer = null;
  function scheduleRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 250);
  }

  function summaryItem(label, value, variant = '') {
    const item = document.createElement('div');
    item.className = 'summary-bar__item';
    const l = document.createElement('span');
    l.className = 'summary-bar__label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = `summary-bar__value${variant ? ` summary-bar__value--${variant}` : ''} num`;
    v.textContent = value;
    item.append(l, v);
    return item;
  }

  async function openCreate() {
    const saved = await openPurchaseForm({});
    if (saved) refresh();
  }

  async function openDetail(row) {
    const changed = await openPurchaseDetail(row.id);
    if (changed) refresh();
  }

  async function refresh() {
    listContainer.innerHTML = '';
    listContainer.appendChild(LoadingState({ label: '' }));

    let rows;
    try {
      rows = await listPurchases(state);
    } catch (err) {
      console.error('[PurchasesPage] listPurchases', err);
      listContainer.innerHTML = '';
      summaryBar.innerHTML = '';
      listContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری اسناد خرید' }));
      return;
    }

    const totals = summarizePurchases(rows);
    summaryBar.innerHTML = '';
    summaryBar.append(
      summaryItem('تعداد سند', String(totals.count)),
      summaryItem('وزن خرید', formatGrams(totals.totalWeightGrams)),
      summaryItem('مبلغ خرید', formatRial(totals.totalIRR)),
      summaryItem('بدهی باز', formatRial(totals.openRemainingIRR), totals.openRemainingIRR > 0 ? 'danger' : '')
    );

    listContainer.innerHTML = '';
    if (!rows.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '🛒',
          title: 'سند خریدی یافت نشد',
          description:
            state.search || state.status !== 'all'
              ? 'با این جستجو/فیلتر سندی پیدا نشد.'
              : 'برای شروع، اولین خرید خود را ثبت کنید.',
          actionLabel: 'ثبت خرید',
          onAction: openCreate,
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const row of rows) list.appendChild(purchaseCard(row, openDetail));
    listContainer.appendChild(list);
  }

  addBtn.addEventListener('click', openCreate);

  await refresh();
  return wrap;
}
