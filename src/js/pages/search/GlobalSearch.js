// GlobalSearch.js — برگه‌ی جستجوی سراسری (لمس ذره‌بین در هدر).
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { EmptyState } from '../../components/EmptyState.js';
import { globalSearch } from '../../services/search.js';
import { customerService } from '../../services/customers.js';
import { supplierService } from '../../services/suppliers.js';
import { CUSTOMER_LABELS } from '../Customers.js';
import { SUPPLIER_LABELS } from '../Suppliers.js';
import { openPartyDetail } from '../party/PartyDetail.js';
import { openSaleDetail } from '../sales/SaleDetail.js';
import { openPurchaseDetail } from '../purchases/PurchaseDetail.js';

const OPENERS = {
  customer: (id) => openPartyDetail({ service: customerService, labels: CUSTOMER_LABELS, id }),
  supplier: (id) => openPartyDetail({ service: supplierService, labels: SUPPLIER_LABELS, id }),
  sale: openSaleDetail,
  purchase: openPurchaseDetail,
};

export function openGlobalSearch() {
  const body = document.createElement('div');
  body.className = 'party-picker global-search';
  const field = Input({ label: 'جستجو', placeholder: 'نام، کد، موبایل یا شماره سند' });
  const list = document.createElement('div');
  list.className = 'menu-list party-picker__list';
  list.setAttribute('aria-live', 'polite');
  body.append(field, list);
  const handle = openModal({ title: 'جستجو', content: body });
  handle.modalEl.classList.add('modal--full');

  let seq = 0;
  let timer = null;
  async function run() {
    const mine = ++seq;
    const q = field.getInput().value;
    const rows = await globalSearch(q);
    if (mine !== seq) return; // پاسخ جستجوی قدیمی‌تر
    list.innerHTML = '';
    if (!rows.length) {
      if (q.trim().length >= 2) list.appendChild(EmptyState({ title: 'چیزی پیدا نشد', description: 'نام، کد، موبایل یا شماره سند را امتحان کنید.' }));
      return;
    }
    for (const r of rows) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-list__item party-picker__item';
      b.dataset.kind = r.kind;
      const title = document.createElement('span');
      title.textContent = r.title;
      const sub = document.createElement('span');
      sub.className = 'party-picker__code';
      sub.textContent = r.subtitle;
      b.append(title, sub);
      b.addEventListener('click', () => {
        handle.close();
        OPENERS[r.kind](r.id);
      });
      list.appendChild(b);
    }
  }
  field.getInput().addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 200);
  });
  field.getInput().focus();
}
