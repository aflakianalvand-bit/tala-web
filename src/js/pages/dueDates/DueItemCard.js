// DueItemCard.js — کارت لمسیِ یک سررسید/هشدار (Phase 12)
// مشترک بین داشبورد، صفحه‌ی سررسیدها و تب سررسید طرف حساب — تا «لمس هشدار ⇒ ورود به سند»
// فقط یک‌جا تعریف شود.
import { Badge } from '../../components/Badge.js';
import { formatRial, formatBaseGrams } from '../../utils/format.js';
import { openSaleDetail } from '../sales/SaleDetail.js';
import { openPurchaseDetail } from '../purchases/PurchaseDetail.js';
import {
  DUE_STATE_LABELS,
  DUE_STATE_VARIANT,
  DUE_SOURCE_LABELS,
  dueDaysText,
  displayDate,
} from '../docs/docLabels.js';

/**
 * سند مبدأ سررسید را مستقیماً باز می‌کند (جزئیات فاکتور فروش یا سند خرید).
 * @returns {Promise<boolean>} true اگر سند در همان صفحه تغییر کرده باشد (لغو/برگشت).
 */
export function openDueSource(item) {
  if (item.sourceType === 'sale') return openSaleDetail(item.sourceId);
  if (item.sourceType === 'purchase') return openPurchaseDetail(item.sourceId);
  return Promise.resolve(false);
}

/**
 * @param {object}   item      خروجی services/dueDates.js → listDueItems
 * @param {object}   [opts]
 * @param {Function} [opts.onChanged]  پس از بستن سند، اگر تغییری رخ داده بود
 * @param {boolean}  [opts.showParty=true]
 */
export function DueItemCard(item, { onChanged, showParty = true } = {}) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `entity-card due-card due-card--${item.state}`;
  card.dataset.dueId = item.id;
  card.dataset.state = item.state;
  card.setAttribute(
    'aria-label',
    `${DUE_STATE_LABELS[item.state]}: ${item.partyName}، ${DUE_SOURCE_LABELS[item.sourceType]} ${item.docNumber}`
  );

  const main = document.createElement('div');
  main.className = 'entity-card__main';

  const title = document.createElement('div');
  title.className = 'entity-card__title';
  const name = document.createElement('span');
  name.className = 'entity-card__name';
  name.textContent = showParty ? item.partyName : `${DUE_SOURCE_LABELS[item.sourceType]}`;
  title.append(name, Badge({ label: item.docNumber, variant: 'neutral' }));

  const meta = document.createElement('div');
  meta.className = 'entity-card__meta';
  const kind = document.createElement('span');
  kind.textContent = item.direction === 'receivable' ? 'دریافتنی' : 'پرداختنی';
  const date = document.createElement('span');
  date.textContent = `سررسید ${displayDate(item.dueDate)}`;
  const days = document.createElement('span');
  days.className = 'due-card__days';
  days.textContent = dueDaysText(item);
  meta.append(kind, date, days);

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'entity-card__side';
  const amount = document.createElement('span');
  const settled = item.state === 'settled' || item.state === 'voided';
  amount.className = `entity-card__amount num ${
    settled ? 'entity-card__amount--neutral' : item.direction === 'receivable' ? 'entity-card__amount--success' : 'entity-card__amount--danger'
  }`;
  // (Phase 19) واحد رسمی سررسید: گرم ۷۵۰ (معادل ریالی در title کارت می‌ماند).
  amount.textContent = formatBaseGrams(settled ? item.amountGrams : item.remainingGrams);
  amount.title = formatRial(settled ? item.amountIRR : item.remainingIRR);
  side.append(amount, Badge({ label: DUE_STATE_LABELS[item.state], variant: DUE_STATE_VARIANT[item.state] }));
  if (!settled && item.paidIRR > 0) {
    const paid = document.createElement('span');
    paid.className = 'entity-card__amount-label num';
    paid.textContent = `از ${formatRial(item.amountIRR)}`;
    side.appendChild(paid);
  }

  card.append(main, side);
  card.addEventListener('click', async () => {
    const changed = await openDueSource(item);
    if (changed && onChanged) onChanged();
  });
  return card;
}

/** فهرست کارت‌ها با عنوان گروه (برای داشبورد). */
export function DueGroup({ title, items, onChanged, variant = '' }) {
  const section = document.createElement('section');
  section.className = `section due-group${variant ? ` due-group--${variant}` : ''}`;
  const h = document.createElement('h2');
  h.className = 'section__title';
  h.textContent = `${title} (${items.length})`;
  const list = document.createElement('div');
  list.className = 'entity-list';
  for (const it of items) list.appendChild(DueItemCard(it, { onChanged }));
  section.append(h, list);
  return section;
}
