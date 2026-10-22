// PartyListPage.js — صفحه فهرست طرف حساب (مشترک بین مشتری و تأمین‌کننده)
// این صفحه هرگز مستقیماً روی IndexedDB نمی‌نویسد و هیچ عدد مالی محاسبه نمی‌کند؛
// مانده‌ی هر کارت مقدار مشتق‌شده از services/ledger.js است، نه فیلد ذخیره‌شده.
import { Button } from '../../components/Button.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Badge } from '../../components/Badge.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadingState } from '../../components/LoadingState.js';
import { partyStatusBadge, describeBalance, displayDate } from './partyLabels.js';
import { openPartyForm } from './PartyForm.js';
import { openPartyDetail } from './PartyDetail.js';

function renderPartyCard(party, cfg, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'entity-card';

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const name = document.createElement('span');
  name.className = 'entity-card__name';
  name.textContent = party.name;
  title.append(name, Badge({ label: party.code, variant: 'neutral' }));

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';

  if (party.phone) {
    const phone = document.createElement('span');
    phone.className = 'num';
    phone.dir = 'ltr';
    phone.textContent = party.phone;
    meta.appendChild(phone);
  }

  const count = document.createElement('span');
  count.textContent = `${party.purchaseCount} ${cfg.docWord}`;
  meta.appendChild(count);

  const last = document.createElement('span');
  last.textContent = party.lastPurchaseAt
    ? `آخرین: ${displayDate(party.lastPurchaseAt)}`
    : cfg.noDocLabel;
  meta.appendChild(last);

  if (party.deletedAt || !party.active) {
    const status = partyStatusBadge(party);
    meta.appendChild(Badge({ label: status.label, variant: status.variant }));
  }

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const balance = describeBalance(party.balance, cfg.kind);
  const amount = document.createElement('span');
  amount.className = `entity-card__amount entity-card__amount--${balance.variant} num`;
  amount.textContent = balance.amount;
  const state = document.createElement('span');
  state.className = 'entity-card__amount-label';
  state.textContent = balance.text;
  side.append(amount, state);

  card.append(main, side);
  card.addEventListener('click', () => onOpen(party));
  return card;
}

/** نوار خلاصه بالای فهرست — هر دو عدد از مانده‌های مشتق‌شده جمع می‌شوند. */
function renderSummaryBar(parties, cfg) {
  const positive = parties.reduce((sum, p) => (p.balance > 0 ? sum + p.balance : sum), 0);
  const negative = parties.reduce((sum, p) => (p.balance < 0 ? sum - p.balance : sum), 0);

  const bar = document.createElement('div');
  bar.className = 'summary-bar';

  const make = (label, described) => {
    const item = document.createElement('div');
    item.className = 'summary-bar__item';
    const l = document.createElement('span');
    l.className = 'summary-bar__label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = `summary-bar__value summary-bar__value--${described.variant} num`;
    v.textContent = described.amount;
    item.append(l, v);
    return item;
  };

  bar.appendChild(make(cfg.summaryPositiveLabel, describeBalance(positive, cfg.kind)));
  bar.appendChild(make(cfg.summaryNegativeLabel, describeBalance(-negative, cfg.kind)));

  const countItem = document.createElement('div');
  countItem.className = 'summary-bar__item';
  const cl = document.createElement('span');
  cl.className = 'summary-bar__label';
  cl.textContent = cfg.countLabel;
  const cv = document.createElement('span');
  cv.className = 'summary-bar__value num';
  cv.textContent = String(parties.length);
  countItem.append(cl, cv);
  bar.appendChild(countItem);

  return bar;
}

/**
 * یک صفحه‌ی فهرست طرف حساب می‌سازد.
 * @param {object} opts
 * @param {object} opts.service سرویس ساخته‌شده با createPartyService
 * @param {object} opts.labels  واژگان دامنه
 * @returns {Function} تابع رندر صفحه، مناسب ثبت در router
 */
export function createPartyListPage({ service, labels }) {
  const cfg = labels;

  return async function PartyPage() {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'page-header';
    const h1 = document.createElement('h1');
    h1.textContent = cfg.pageTitle;
    header.appendChild(h1);
    const addBtn = Button({ label: cfg.addAction, variant: 'primary', icon: '+' });
    header.appendChild(addBtn);
    wrap.appendChild(header);

    const subtitle = document.createElement('div');
    subtitle.className = 'page-header__subtitle';
    subtitle.style.marginBottom = 'var(--space-4)';
    subtitle.textContent = cfg.pageSubtitle;
    wrap.appendChild(subtitle);

    const filters = document.createElement('div');
    filters.className = 'product-filters';

    const state = { search: '', status: 'active' };

    const searchField = Input({
      placeholder: 'جستجو بر اساس نام، کد یا موبایل…',
      onInput: (value) => {
        state.search = value;
        scheduleRefresh();
      },
    });

    const filterRow = document.createElement('div');
    filterRow.className = 'product-filters__row';
    filterRow.appendChild(
      Select({
        options: cfg.statusFilterOptions,
        value: 'active',
        onChange: (value) => {
          state.status = value;
          refresh();
        },
      })
    );

    filters.append(searchField, filterRow);
    wrap.appendChild(filters);

    const summaryContainer = document.createElement('div');
    wrap.appendChild(summaryContainer);

    const listContainer = document.createElement('div');
    wrap.appendChild(listContainer);

    let debounceTimer = null;
    function scheduleRefresh() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refresh, 250);
    }

    async function openCreate() {
      const saved = await openPartyForm({ service, labels: cfg });
      if (saved) refresh();
    }

    async function openDetail(party) {
      const changed = await openPartyDetail({ service, labels: cfg, id: party.id });
      if (changed) refresh();
    }

    async function refresh() {
      summaryContainer.innerHTML = '';
      listContainer.innerHTML = '';
      listContainer.appendChild(LoadingState({ label: '' }));

      let parties;
      try {
        parties = await service.list(state);
      } catch (err) {
        console.error(`[PartyListPage:${cfg.kind}] list`, err);
        listContainer.innerHTML = '';
        listContainer.appendChild(EmptyState({ icon: '⚠️', title: cfg.loadErrorTitle }));
        return;
      }

      listContainer.innerHTML = '';

      if (!parties.length) {
        const filtered = state.search || state.status !== 'active';
        listContainer.appendChild(
          EmptyState({
            icon: cfg.icon,
            title: cfg.emptyTitle,
            description: filtered ? cfg.emptyFilteredDesc : cfg.emptyFirstDesc,
            actionLabel: cfg.addAction,
            onAction: openCreate,
          })
        );
        return;
      }

      summaryContainer.appendChild(renderSummaryBar(parties, cfg));

      const list = document.createElement('div');
      list.className = 'entity-list';
      for (const party of parties) {
        list.appendChild(renderPartyCard(party, cfg, openDetail));
      }
      listContainer.appendChild(list);
    }

    addBtn.addEventListener('click', openCreate);

    await refresh();
    return wrap;
  };
}
