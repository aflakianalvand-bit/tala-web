// Inventory.js — صفحه‌ی «انبار طلا» (Phase 10)
//
// این صفحه هرگز مستقیماً روی IndexedDB نمی‌نویسد و هیچ فرمولی را دوباره پیاده نمی‌کند؛
// همه چیز از services/inventory.js (خواندن) و services/inventoryDocs.js (نوشتن) می‌آید.
//
// سه نما: سطل‌ها (با وزن و ارزش)، فرمول موجودی (اجزای گردش)، اسناد انبار.
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';
import { Badge } from '../components/Badge.js';
import { Table } from '../components/Table.js';
import { Alert } from '../components/Alert.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadingState } from '../components/LoadingState.js';
import { showToast } from '../components/Toast.js';
import { confirmDialog } from '../components/ConfirmDialog.js';
import {
  listBuckets,
  totalsByType,
  totalsByKarat,
  grandTotal,
  inventoryFlow,
  GOLD_ACCOUNT_TYPES,
} from '../services/inventory.js';
import { listInventoryDocs, voidInventoryDoc } from '../services/inventoryDocs.js';
import { runVoidWithShortageGuard } from './docs/voidGuard.js';
import { formatGrams, formatRial } from '../utils/format.js';
import { openAdjustmentForm } from './inventory/AdjustmentForm.js';
import { openMeltForm } from './inventory/MeltForm.js';
import { openBucketDetail } from './inventory/BucketDetail.js';
import {
  GOLD_ACCOUNT_TYPE_LABELS,
  GOLD_TYPE_ICONS,
  INVENTORY_DOC_KIND_LABELS,
  displayDate,
  describeInventoryDoc,
  inventoryDocStatusBadge,
} from './inventory/inventoryLabels.js';

const VIEW_OPTIONS = [
  { value: 'buckets', label: 'موجودی سطل‌ها' },
  { value: 'formula', label: 'فرمول موجودی' },
  { value: 'docs', label: 'اسناد انبار' },
];

const TYPE_OPTIONS = [
  { value: 'all', label: 'همه‌ی انواع' },
  ...GOLD_ACCOUNT_TYPES.map((t) => ({ value: t, label: GOLD_ACCOUNT_TYPE_LABELS[t] })),
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

function bucketCard(row, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'entity-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const name = document.createElement('span');
  name.className = 'entity-card__name';
  name.textContent = `${GOLD_TYPE_ICONS[row.goldType] || '🥇'} ${row.label}`;
  title.appendChild(name);
  if (row.productCode) title.appendChild(Badge({ label: row.productCode, variant: 'neutral' }));

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';
  const value = document.createElement('span');
  value.textContent = `ارزش روز ${formatRial(row.marketValueIRR)}`;
  const book = document.createElement('span');
  book.textContent = `دفتری ${formatRial(row.bookValueIRR)}`;
  const flow = document.createElement('span');
  flow.textContent = `ورود ${formatGrams(row.inGrams)} • خروج ${formatGrams(row.outGrams)}`;
  meta.append(value, book, flow);

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const amount = document.createElement('span');
  const negative = row.grams < -0.0005;
  amount.className = `entity-card__amount num${negative ? ' entity-card__amount--danger' : ''}`;
  amount.textContent = formatGrams(row.grams);
  const label = document.createElement('span');
  label.className = 'entity-card__amount-label';
  label.textContent = negative ? 'کسری' : 'موجودی';
  side.append(amount, label);

  card.append(main, side);
  card.addEventListener('click', () => onOpen(row));
  return card;
}

export default async function InventoryPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'انبار طلا';
  header.appendChild(h1);
  wrap.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent =
    'موجودی هیچ‌جا ذخیره نشده است؛ هر عدد این صفحه در لحظه از دفتر طلا محاسبه می‌شود.';
  wrap.appendChild(subtitle);

  const state = { view: 'buckets', goldType: 'all', search: '', includeEmpty: false };

  const quickBar = document.createElement('div');
  quickBar.className = 'modal__actions';
  quickBar.append(
    Button({
      label: 'ورود / اضافی',
      variant: 'secondary',
      onClick: async () => {
        if (await openAdjustmentForm('in', {})) refresh();
      },
    }),
    Button({
      label: 'خروج / کسری',
      variant: 'secondary',
      onClick: async () => {
        if (await openAdjustmentForm('out', {})) refresh();
      },
    }),
    Button({
      label: 'ذوب',
      variant: 'secondary',
      onClick: async () => {
        if (await openMeltForm({})) refresh();
      },
    })
  );
  wrap.appendChild(quickBar);

  const filters = document.createElement('div');
  filters.className = 'product-filters';
  const searchField = Input({
    placeholder: 'جستجو در سطل‌های انبار…',
    onInput: (value) => {
      state.search = value;
      scheduleRefresh();
    },
  });
  const filterRow = document.createElement('div');
  filterRow.className = 'product-filters__row';
  filterRow.append(
    Select({
      options: VIEW_OPTIONS,
      value: state.view,
      onChange: (value) => {
        state.view = value;
        refresh();
      },
    }),
    Select({
      options: TYPE_OPTIONS,
      value: state.goldType,
      onChange: (value) => {
        state.goldType = value;
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

  async function openDetail(row) {
    if (await openBucketDetail(row.refId)) refresh();
  }

  async function refresh() {
    listContainer.innerHTML = '';
    listContainer.appendChild(LoadingState({ label: '' }));
    summaryBar.innerHTML = '';

    try {
      if (state.view === 'buckets') await renderBuckets();
      else if (state.view === 'formula') await renderFormula();
      else await renderDocs();
    } catch (err) {
      console.error('[InventoryPage] refresh', err);
      listContainer.innerHTML = '';
      listContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری انبار' }));
    }
  }

  async function renderBuckets() {
    const rows = await listBuckets({
      goldType: state.goldType,
      search: state.search,
      includeEmpty: state.includeEmpty,
    });
    const total = grandTotal(rows);
    const byType = totalsByType(rows);
    const byKarat = totalsByKarat(rows);

    summaryBar.append(
      summaryItem('جمع وزن', formatGrams(total.grams)),
      summaryItem('ارزش روز', formatRial(total.marketValueIRR), 'success'),
      summaryItem('ارزش دفتری', formatRial(total.bookValueIRR))
    );
    for (const t of byType) {
      if (Math.abs(t.grams) < 0.0005 && !state.includeEmpty) continue;
      summaryBar.appendChild(summaryItem(t.label, formatGrams(t.grams)));
    }

    listContainer.innerHTML = '';

    if (byKarat.length) {
      const karatBar = document.createElement('div');
      karatBar.className = 'summary-bar';
      for (const k of byKarat) karatBar.appendChild(summaryItem(`عیار ${k.karat}`, formatGrams(k.grams)));
      listContainer.appendChild(karatBar);
    }

    if (!rows.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '🥇',
          title: 'انبار خالی است',
          description:
            'سطل‌های انبار خودکار از گردش اسناد ساخته می‌شوند. برای شروع، مانده ابتدای دوره‌ی انبار را ثبت کنید.',
          actionLabel: 'ثبت مانده ابتدای دوره',
          onAction: async () => {
            if (await openAdjustmentForm('in', {})) refresh();
          },
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';
    for (const row of rows) list.appendChild(bucketCard(row, openDetail));
    listContainer.appendChild(list);

    const toggle = Button({
      label: state.includeEmpty ? 'پنهان‌کردن سطل‌های خالی' : 'نمایش سطل‌های خالی',
      variant: 'ghost',
      onClick: () => {
        state.includeEmpty = !state.includeEmpty;
        refresh();
      },
    });
    listContainer.appendChild(toggle);
  }

  async function renderFormula() {
    const [flow, rows] = await Promise.all([
      inventoryFlow({ goldType: state.goldType }),
      listBuckets({ goldType: state.goldType, includeEmpty: true }),
    ]);
    const total = grandTotal(rows);

    summaryBar.append(
      summaryItem('جمع اجزای فرمول', formatGrams(flow.closing)),
      summaryItem('موجودی واقعی', formatGrams(total.grams), flow.balanced ? 'success' : 'danger')
    );

    listContainer.innerHTML = '';
    listContainer.appendChild(
      Table({
        columns: [
          { header: 'جزء فرمول', key: 'label' },
          { header: 'ورود', numeric: true, cell: (r) => (r.inGrams ? formatGrams(r.inGrams) : '—') },
          { header: 'خروج', numeric: true, cell: (r) => (r.outGrams ? formatGrams(r.outGrams) : '—') },
          { header: 'خالص', numeric: true, cell: (r) => formatGrams(r.netGrams) },
          { header: 'تعداد', numeric: true, cell: (r) => String(r.count) },
        ],
        rows: flow.steps.filter((s) => s.count > 0),
        emptyTitle: 'هنوز هیچ گردشی در انبار ثبت نشده',
      })
    );
    listContainer.appendChild(
      Alert({
        variant: flow.balanced ? 'info' : 'danger',
        message: flow.balanced
          ? 'مانده ابتدای دوره + خرید + طلای دریافتی + برگشت از فروش − فروش − طلای پرداختی − خروج − ذوب ± اصلاح = موجودی فعلی.'
          : 'هشدار: جمع اجزای فرمول با موجودی واقعی نمی‌خواند. این یعنی رکوردی با «بابت» ناشناخته در دفتر وجود دارد.',
      })
    );
  }

  async function renderDocs() {
    const docs = await listInventoryDocs({ search: state.search });

    const confirmed = docs.filter((d) => d.status !== 'voided');
    summaryBar.append(
      summaryItem('اسناد ثبت‌شده', String(confirmed.length)),
      summaryItem('اصلاح موجودی', String(confirmed.filter((d) => d.kind === 'adjustment').length)),
      summaryItem('ذوب', String(confirmed.filter((d) => d.kind === 'melt').length)),
      summaryItem('باطل‌شده', String(docs.length - confirmed.length))
    );

    listContainer.innerHTML = '';
    if (!docs.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '📋',
          title: 'سند انباری ثبت نشده',
          description: 'اصلاح موجودی، مانده ابتدای دوره، ورود/خروج مستقیم و ذوب — همه اینجا ثبت می‌شوند.',
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'entity-list';

    for (const doc of docs) {
      const card = document.createElement('div');
      card.className = 'entity-card';

      const main = document.createElement('div');
      main.className = 'entity-card__main';

      const title = document.createElement('div');
      title.className = 'entity-card__title';
      const name = document.createElement('span');
      name.className = 'entity-card__name';
      name.textContent = doc.categoryLabel || INVENTORY_DOC_KIND_LABELS[doc.kind] || doc.kind;
      title.append(name, Badge({ label: doc.number, variant: 'neutral' }));
      const status = inventoryDocStatusBadge(doc);
      if (doc.status === 'voided') title.appendChild(Badge({ label: status.label, variant: status.variant }));

      const meta = document.createElement('div');
      meta.className = 'entity-card__meta';
      const date = document.createElement('span');
      date.textContent = displayDate(doc.date);
      const kind = document.createElement('span');
      kind.textContent = INVENTORY_DOC_KIND_LABELS[doc.kind] || doc.kind;
      meta.append(date, kind);
      if (doc.description) {
        const desc = document.createElement('span');
        desc.textContent = doc.description;
        meta.appendChild(desc);
      }
      main.append(title, meta);

      const side = document.createElement('div');
      side.className = 'entity-card__side';
      const amount = document.createElement('span');
      amount.className = 'entity-card__amount num';
      amount.textContent = describeInventoryDoc(doc);
      side.appendChild(amount);

      if (doc.status !== 'voided') {
        side.appendChild(
          Button({
            label: 'لغو',
            variant: 'ghost',
            onClick: async () => {
              const proceed = await confirmDialog({
                title: 'لغو سند انبار',
                message: `سند ${doc.number} باطل می‌شود و اثرش روی موجودی و ارزش انبار برمی‌گردد. سند حذف نمی‌شود.`,
                confirmLabel: 'بله، باطل شود',
                danger: true,
              });
              if (!proceed) return;
              try {
                const res = await runVoidWithShortageGuard((opts) => voidInventoryDoc(doc.id, opts));
                if (!res.done) return;
                showToast('سند انبار باطل شد.', { variant: 'success' });
                refresh();
              } catch (err) {
                showToast(err?.message || 'لغو ناموفق بود.', { variant: 'danger' });
              }
            },
          })
        );
      }

      card.append(main, side);
      list.appendChild(card);
    }

    listContainer.appendChild(list);
  }

  await refresh();
  return wrap;
}
