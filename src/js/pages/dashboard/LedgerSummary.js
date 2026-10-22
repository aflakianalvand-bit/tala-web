// LedgerSummary.js — بخش «معین حساب» صفحه‌ی اصلی (Phase 26؛ UI_GUIDELINES §6.10)
//
// لایه‌ی دوم داشبورد، بلافاصله پس از «وضعیت امروز». فقط نمایش: همه‌ی اعداد از
// `services/ledgerSummary.js` می‌آیند و واژه/رنگ از جدول داده‌ای `BALANCE_WORDS`.
//
//   • یک فهرست مشترک مشتری و تأمین‌کننده با برچسب نوع؛ بزرگ‌ترین مانده‌ی مطلق اول.
//   • ۱۰ ردیف + دکمه‌ی «همه»؛ تسویه‌شده‌ها پنهان با کلید «نمایش تسویه‌شده‌ها».
//   • عدد اصلی گرم ۷۵۰ با سه رقم اعشار و واژه‌ی بد/بس کنارش؛ معادل ریالی کمرنگ «به نرخ امروز».
//   • لمس ردیف ⇒ تب «گردش حساب» همان شخص.

import { getLedgerSummary, LEDGER_SUMMARY_LIMIT } from '../../services/ledgerSummary.js';
import { customerService } from '../../services/customers.js';
import { supplierService } from '../../services/suppliers.js';
import { CUSTOMER_LABELS } from '../Customers.js';
import { SUPPLIER_LABELS } from '../Suppliers.js';
import { openPartyDetail } from '../party/PartyDetail.js';
import {
  BALANCE_WORDS,
  BASE_GRAM_DIGITS,
  PARTY_KIND_LABELS,
  PARTY_STATE_BADGES,
  BalanceText,
} from '../party/partyLabels.js';
import { Badge } from '../../components/Badge.js';
import { Switch } from '../../components/Switch.js';
import { Alert } from '../../components/Alert.js';
import { LoadingState } from '../../components/LoadingState.js';
import { formatBaseGrams, formatRial, formatNumber } from '../../utils/format.js';
import { formatJalaliDate } from '../../utils/date.js';

const PARTY_PAGES = {
  customer: { service: customerService, labels: CUSTOMER_LABELS },
  supplier: { service: supplierService, labels: SUPPLIER_LABELS },
};

/** حالت نما در سطح ماژول (مثل بازه‌ی داشبورد): برگشت به صفحه همان حالت را نشان می‌دهد. */
const view = { showAll: false, includeSettled: false };

function describeRow(row) {
  const w = BALANCE_WORDS[row.side];
  return { text: w.text, variant: w.variant, amount: formatBaseGrams(row.absGrams, BASE_GRAM_DIGITS) };
}

function rateCaption(rate) {
  if (!rate) return '';
  return rate.isToday ? 'به نرخ امروز' : `به نرخ ${formatJalaliDate(new Date(rate.effectiveDate))}`;
}

function LedgerRow(row, rate, onOpen) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ledger-row';
  btn.dataset.partyId = row.id;
  btn.dataset.side = row.side;

  const who = document.createElement('span');
  who.className = 'ledger-row__who';
  const name = document.createElement('span');
  name.className = 'ledger-row__name';
  name.textContent = row.name || row.code || '—';
  const tags = document.createElement('span');
  tags.className = 'ledger-row__tags';
  tags.appendChild(Badge({ label: PARTY_KIND_LABELS[row.kind], variant: 'neutral' }));
  const state = PARTY_STATE_BADGES[row.state];
  if (state) tags.appendChild(Badge(state));
  who.append(name, tags);

  const amounts = document.createElement('span');
  amounts.className = 'ledger-row__amounts';
  amounts.appendChild(BalanceText(describeRow(row)));
  if (row.irr !== null && row.side !== 'zero') {
    const irr = document.createElement('span');
    irr.className = 'ledger-row__irr';
    irr.textContent = `${formatRial(row.irr)} ${rateCaption(rate)}`;
    amounts.appendChild(irr);
  }

  btn.append(who, amounts);
  const word = BALANCE_WORDS[row.side].text;
  btn.setAttribute('aria-label', `${row.name}، ${PARTY_KIND_LABELS[row.kind]}: ${describeRow(row).amount} ${word} — گردش حساب`);
  btn.addEventListener('click', () => onOpen(row));
  return btn;
}

export function LedgerSummarySection() {
  const el = document.createElement('section');
  el.className = 'section ledger-summary';
  el.setAttribute('aria-label', 'معین حساب اشخاص');

  const head = document.createElement('div');
  head.className = 'page-header';
  const h2 = document.createElement('h2');
  h2.className = 'section__title';
  h2.textContent = 'معین حساب';
  head.appendChild(h2);
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'btn btn--ghost ledger-summary__more';
  head.appendChild(moreBtn);
  el.appendChild(head);

  const totalsEl = document.createElement('div');
  totalsEl.className = 'ledger-summary__totals';
  el.appendChild(totalsEl);

  const list = document.createElement('div');
  list.className = 'ledger-summary__list';
  el.appendChild(list);

  const settledSwitch = Switch({
    label: 'نمایش تسویه‌شده‌ها',
    checked: view.includeSettled,
    onChange: (checked) => {
      view.includeSettled = checked;
      refresh();
    },
  });
  settledSwitch.classList.add('ledger-summary__switch');
  el.appendChild(settledSwitch);

  moreBtn.addEventListener('click', () => {
    view.showAll = !view.showAll;
    refresh();
  });

  async function openRow(row) {
    const page = PARTY_PAGES[row.kind];
    const changed = await openPartyDetail({ service: page.service, labels: page.labels, id: row.id, initialTab: 'statement' });
    if (changed) await refresh();
  }

  async function refresh() {
    list.innerHTML = '';
    list.appendChild(LoadingState({ label: '' }));
    let data;
    try {
      data = await getLedgerSummary({ includeSettled: view.includeSettled });
    } catch (err) {
      console.error('[Dashboard] getLedgerSummary', err);
      list.innerHTML = '';
      list.appendChild(Alert({ variant: 'danger', message: 'خواندن معین حساب ناموفق بود.' }));
      return;
    }
    list.innerHTML = '';
    totalsEl.innerHTML = '';

    const { totals } = data;
    totalsEl.append(
      BalanceText({ ...BALANCE_WORDS.debit, amount: `${formatNumber(totals.debitCount, { maximumFractionDigits: 0 })} نفر · ${formatBaseGrams(totals.debitGrams, BASE_GRAM_DIGITS)}` }),
      BalanceText({ ...BALANCE_WORDS.credit, amount: `${formatNumber(totals.creditCount, { maximumFractionDigits: 0 })} نفر · ${formatBaseGrams(totals.creditGrams, BASE_GRAM_DIGITS)}` })
    );

    if (!data.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'ledger-summary__empty';
      empty.textContent = data.settledCount
        ? `حساب همه‌ی ${formatNumber(data.settledCount, { maximumFractionDigits: 0 })} شخص تسویه است.`
        : 'هنوز مانده‌ای برای هیچ شخصی ثبت نشده است.';
      list.appendChild(empty);
    }

    const visible = view.showAll ? data.rows : data.rows.slice(0, LEDGER_SUMMARY_LIMIT);
    for (const row of visible) list.appendChild(LedgerRow(row, data.rate, openRow));

    const hidden = data.rows.length - visible.length;
    moreBtn.hidden = data.rows.length <= LEDGER_SUMMARY_LIMIT;
    moreBtn.textContent = view.showAll ? 'کمتر' : `همه (${formatNumber(data.rows.length, { maximumFractionDigits: 0 })})`;
    moreBtn.setAttribute('aria-expanded', String(view.showAll));
    if (hidden > 0) moreBtn.setAttribute('aria-label', `نمایش همه‌ی ${data.rows.length} ردیف معین`);
    else moreBtn.removeAttribute('aria-label');

    if (!data.rate && data.rows.length) {
      const note = document.createElement('div');
      note.className = 'ledger-summary__note';
      note.textContent = 'نرخ روز ثبت نشده؛ معادل ریالی نمایش داده نمی‌شود.';
      list.appendChild(note);
    }
  }

  el.refresh = refresh;
  return el;
}
