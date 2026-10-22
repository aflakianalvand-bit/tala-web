// Accounts.js — حساب‌ها و صندوق (Phase 9)
// این صفحه هرگز مستقیماً روی IndexedDB نمی‌نویسد؛ همه چیز از services/accounts.js،
// services/cashFlow.js و services/transfers.js عبور می‌کند.
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';
import { Badge } from '../components/Badge.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadingState } from '../components/LoadingState.js';
import { showToast } from '../components/Toast.js';
import {
  listAccounts,
  listGoldAccounts,
  goldAccountTotals,
  ensureDefaultAccounts,
  GOLD_ACCOUNT_TYPES,
} from '../services/accounts.js';
import { listTransfers, summarizeTransfers } from '../services/transfers.js';
import { formatRial, formatGrams } from '../utils/format.js';
import { openAccountForm } from './accounts/AccountForm.js';
import { openAccountDetail } from './accounts/AccountDetail.js';
import { openTransferForm } from './accounts/TransferForm.js';
import { openCashFlowForm } from './accounts/CashFlowForm.js';
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPE_ICONS,
  GOLD_ACCOUNT_TYPE_LABELS,
  GOLD_ACCOUNT_ICONS,
  TRANSFER_KIND_LABELS,
  accountStatusBadge,
  transferStatusBadge,
  displayDate,
} from './accounts/accountLabels.js';

const VIEW_OPTIONS = [
  { value: 'money', label: 'حساب‌های وجهی' },
  { value: 'gold', label: 'حساب‌های طلا' },
  { value: 'transfers', label: 'انتقال‌ها' },
];

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

function accountCard(row, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'entity-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const name = document.createElement('span');
  name.className = 'entity-card__name';
  name.textContent = `${ACCOUNT_TYPE_ICONS[row.type] || '🏦'} ${row.name}`;
  title.appendChild(name);
  const status = accountStatusBadge(row);
  if (status.label !== 'فعال') title.appendChild(Badge({ label: status.label, variant: status.variant }));

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';
  const type = document.createElement('span');
  type.textContent = ACCOUNT_TYPE_LABELS[row.type] || row.type;
  meta.appendChild(type);
  if (row.notes) {
    const note = document.createElement('span');
    note.textContent = row.notes;
    meta.appendChild(note);
  }

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const amount = document.createElement('span');
  const negative = row.balance < -0.5;
  amount.className = `entity-card__amount num${negative ? ' entity-card__amount--danger' : ''}`;
  amount.textContent = formatRial(row.balance);
  const label = document.createElement('span');
  label.className = 'entity-card__amount-label';
  label.textContent = negative ? 'کسری' : 'موجودی';
  side.append(amount, label);

  card.append(main, side);
  card.addEventListener('click', () => onOpen(row));
  return card;
}

function goldAccountCard(row, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'entity-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const name = document.createElement('span');
  name.className = 'entity-card__name';
  name.textContent = `${GOLD_ACCOUNT_ICONS[row.goldType] || '🥇'} ${row.name}`;
  title.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';
  const type = document.createElement('span');
  type.textContent = GOLD_ACCOUNT_TYPE_LABELS[row.goldType] || row.goldType;
  const karat = document.createElement('span');
  karat.textContent = `عیار ${row.karat}`;
  meta.append(type, karat);

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const amount = document.createElement('span');
  const negative = row.grams < -0.0005;
  amount.className = `entity-card__amount num${negative ? ' entity-card__amount--danger' : ''}`;
  amount.textContent = formatGrams(row.grams);
  const label = document.createElement('span');
  label.className = 'entity-card__amount-label';
  label.textContent = 'موجودی انبار';
  side.append(amount, label);

  card.append(main, side);
  card.addEventListener('click', () => onOpen(row));
  return card;
}

function transferCard(row) {
  const card = document.createElement('div');
  card.className = 'entity-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const name = document.createElement('span');
  name.className = 'entity-card__name';
  name.textContent = `${row.fromLabel} ← ${row.toLabel}`;
  const status = transferStatusBadge(row);
  title.append(name, Badge({ label: row.number, variant: 'neutral' }));
  if (row.status === 'voided') title.appendChild(Badge({ label: status.label, variant: status.variant }));

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';
  const date = document.createElement('span');
  date.textContent = displayDate(row.date);
  const kind = document.createElement('span');
  kind.textContent = TRANSFER_KIND_LABELS[row.kind] || row.kind;
  meta.append(date, kind);
  if (row.description) {
    const desc = document.createElement('span');
    desc.textContent = row.description;
    meta.appendChild(desc);
  }

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const amount = document.createElement('span');
  amount.className = 'entity-card__amount num';
  amount.textContent = row.kind === 'money' ? formatRial(row.amountIRR) : formatGrams(row.weightGrams);
  side.appendChild(amount);

  card.append(main, side);
  return card;
}

export default async function AccountsPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'حساب‌ها و صندوق';
  header.appendChild(h1);
  const addBtn = Button({ label: 'حساب جدید', variant: 'primary', icon: '+' });
  header.appendChild(addBtn);
  wrap.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent = 'صندوق، بانک، کارتخوان و حساب‌های طلا — همه‌ی مانده‌ها از دفاتر محاسبه می‌شوند.';
  wrap.appendChild(subtitle);

  const state = { view: 'money', search: '' };

  const quickBar = document.createElement('div');
  quickBar.className = 'modal__actions';
  quickBar.append(
    Button({
      label: 'واریز',
      variant: 'secondary',
      onClick: async () => {
        if (await openCashFlowForm('in')) refresh();
      },
    }),
    Button({
      label: 'برداشت',
      variant: 'secondary',
      onClick: async () => {
        if (await openCashFlowForm('out')) refresh();
      },
    }),
    Button({
      label: 'انتقال',
      variant: 'secondary',
      onClick: async () => {
        if (await openTransferForm({ kind: state.view === 'gold' ? 'gold' : 'money' })) refresh();
      },
    })
  );
  wrap.appendChild(quickBar);

  const filters = document.createElement('div');
  filters.className = 'product-filters';
  const searchField = Input({
    placeholder: 'جستجو در حساب‌ها…',
    onInput: (value) => {
      state.search = value;
      scheduleRefresh();
    },
  });
  const filterRow = document.createElement('div');
  filterRow.className = 'product-filters__row';
  filterRow.appendChild(
    Select({
      options: VIEW_OPTIONS,
      value: state.view,
      onChange: (value) => {
        state.view = value;
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

  addBtn.addEventListener('click', async () => {
    if (await openAccountForm({})) refresh();
  });

  async function openMoneyDetail(row) {
    if (await openAccountDetail({ kind: 'account', id: row.id })) refresh();
  }

  async function openGoldDetail(row) {
    if (await openAccountDetail({ kind: 'gold', id: row.refId })) refresh();
  }

  async function refresh() {
    listContainer.innerHTML = '';
    listContainer.appendChild(LoadingState({ label: '' }));
    summaryBar.innerHTML = '';

    try {
      if (state.view === 'money') await renderMoney();
      else if (state.view === 'gold') await renderGold();
      else await renderTransfers();
    } catch (err) {
      console.error('[AccountsPage] refresh', err);
      listContainer.innerHTML = '';
      listContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری حساب‌ها' }));
    }
  }

  async function renderMoney() {
    const rows = await listAccounts({ search: state.search, status: 'all' });

    const total = rows.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
    summaryBar.append(
      summaryItem('تعداد حساب', String(rows.length)),
      summaryItem('جمع موجودی', formatRial(total), total < 0 ? 'danger' : 'success')
    );

    listContainer.innerHTML = '';
    if (!rows.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '🏦',
          title: 'حسابی یافت نشد',
          description: 'برای ثبت پرداخت و دریافت، حداقل یک حساب لازم است.',
          actionLabel: 'ساخت حساب‌های پیش‌فرض',
          onAction: async () => {
            await ensureDefaultAccounts();
            showToast('حساب‌های پیش‌فرض ساخته شدند.', { variant: 'success' });
            refresh();
          },
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const row of rows) list.appendChild(accountCard(row, openMoneyDetail));
    listContainer.appendChild(list);
  }

  async function renderGold() {
    const [rows, totals] = await Promise.all([listGoldAccounts({}), goldAccountTotals()]);
    const term = state.search.trim().toLowerCase();
    const filtered = term ? rows.filter((r) => r.name.toLowerCase().includes(term)) : rows;

    for (const type of GOLD_ACCOUNT_TYPES) {
      summaryBar.appendChild(summaryItem(GOLD_ACCOUNT_TYPE_LABELS[type], formatGrams(totals[type] || 0)));
    }

    listContainer.innerHTML = '';
    if (!filtered.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '🥇',
          title: 'حساب طلایی با موجودی وجود ندارد',
          description: 'حساب‌های طلا خودکار از گردش انبار ساخته می‌شوند؛ با ثبت اولین خرید اینجا ظاهر می‌شوند.',
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const row of filtered) list.appendChild(goldAccountCard(row, openGoldDetail));
    listContainer.appendChild(list);
  }

  async function renderTransfers() {
    const rows = await listTransfers({ search: state.search });
    const summary = summarizeTransfers(rows);

    summaryBar.append(
      summaryItem('تعداد انتقال', String(summary.count)),
      summaryItem('جمع وجه', formatRial(summary.moneyTotalIRR)),
      summaryItem('جمع طلا', formatGrams(summary.goldTotalGrams))
    );

    listContainer.innerHTML = '';
    if (!rows.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '🔁',
          title: 'انتقالی ثبت نشده',
          description: 'انتقال بین صندوق، بانک و کارتخوان — یا بین حساب‌های طلای هم‌نوع و هم‌عیار.',
          actionLabel: 'ثبت انتقال',
          onAction: async () => {
            if (await openTransferForm({})) refresh();
          },
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const row of rows) list.appendChild(transferCard(row));
    listContainer.appendChild(list);
  }

  await refresh();
  return wrap;
}
