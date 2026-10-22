// Sales.js — فروش طلا (Phase 7: فهرست فاکتورها، ثبت، جزئیات، لغو، برگشت)
// این صفحه هرگز مستقیماً روی IndexedDB نمی‌نویسد؛ همه چیز از services/sales.js عبور می‌کند.
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';
import { Badge } from '../components/Badge.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadingState } from '../components/LoadingState.js';
import { listSales, summarizeSales } from '../services/sales.js';
import { formatRial, formatGrams } from '../utils/format.js';
import { summaryItem } from './docs/docFormParts.js';
import { openSaleForm } from './sales/SaleForm.js';
import { openSaleDetail } from './sales/SaleDetail.js';
import { saleStatusBadge, returnBadge, PAYMENT_MODE_LABELS, displayDate } from './sales/saleLabels.js';

const STATUS_OPTIONS = [
  { value: 'all', label: 'همه فاکتورها' },
  { value: 'open', label: 'باز (طلب دارد)' },
  { value: 'settled', label: 'تسویه‌شده' },
  { value: 'returned', label: 'دارای برگشت' },
  { value: 'voided', label: 'باطل‌شده' },
];

function saleCard(row, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'entity-card purchase-card sale-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const customerName = document.createElement('span');
  customerName.className = 'entity-card__name';
  customerName.textContent = row.customerName;
  title.append(customerName, Badge({ label: row.number, variant: 'neutral' }));

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
  const status = saleStatusBadge(row);
  side.append(amount, Badge({ label: status.label, variant: status.variant }));

  const ret = returnBadge(row);
  if (ret) side.appendChild(Badge({ label: ret.label, variant: ret.variant }));
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

export default async function SalesPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'فروش طلا';
  header.appendChild(h1);
  const addBtn = Button({ label: 'ثبت فروش', variant: 'primary', icon: '+' });
  header.appendChild(addBtn);
  wrap.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent = 'فروش نقدی، رسیدی و ترکیبی به مشتریان';
  wrap.appendChild(subtitle);

  const state = { search: '', status: 'all' };

  const filters = document.createElement('div');
  filters.className = 'product-filters';
  const searchField = Input({
    placeholder: 'جستجو بر اساس شماره فاکتور یا مشتری…',
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

  async function openCreate() {
    const saved = await openSaleForm();
    if (saved) refresh();
  }

  async function openDetail(row) {
    const changed = await openSaleDetail(row.id);
    if (changed) refresh();
  }

  async function refresh() {
    listContainer.innerHTML = '';
    listContainer.appendChild(LoadingState({ label: '' }));

    let rows;
    try {
      rows = await listSales(state);
    } catch (err) {
      console.error('[SalesPage] listSales', err);
      listContainer.innerHTML = '';
      summaryBar.innerHTML = '';
      listContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری فاکتورها' }));
      return;
    }

    const totals = summarizeSales(rows);
    summaryBar.innerHTML = '';
    summaryBar.append(
      summaryItem('تعداد فاکتور', String(totals.count)),
      summaryItem('وزن فروش', formatGrams(totals.totalWeightGrams)),
      summaryItem('مبلغ فروش', formatRial(totals.totalIRR)),
      summaryItem('طلب باز', formatRial(totals.openRemainingIRR), totals.openRemainingIRR > 0 ? 'danger' : '')
    );
    if (totals.returnedIRR > 0) {
      summaryBar.appendChild(summaryItem('برگشت از فروش', formatRial(totals.returnedIRR), 'danger'));
    }

    listContainer.innerHTML = '';
    if (!rows.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '💰',
          title: 'فاکتوری یافت نشد',
          description:
            state.search || state.status !== 'all'
              ? 'با این جستجو/فیلتر فاکتوری پیدا نشد.'
              : 'برای شروع، اولین فروش خود را ثبت کنید.',
          actionLabel: 'ثبت فروش',
          onAction: openCreate,
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const row of rows) list.appendChild(saleCard(row, openDetail));
    listContainer.appendChild(list);
  }

  addBtn.addEventListener('click', openCreate);

  await refresh();
  return wrap;
}
