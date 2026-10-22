// Operations.js — صفحه‌ی «عملیات» (Phase 25)
//
// آیتم برجسته‌ی نوار پایین (+). هر سندی که برنامه می‌تواند ثبت کند از همین
// صفحه یک یا دو لمس فاصله دارد:
//   فروش · خرید · تسویه · ذوب/اصلاح انبار · واریز/برداشت/انتقال
// و «فهرست اسناد» (فاکتورهای فروش، اسناد خرید) پایین همین صفحه.
//
// هیچ فرم تازه‌ای ساخته نشد: هر کاشی همان فرم موجودِ صفحه‌ی تخصصی را باز
// می‌کند (openSaleForm، openSettlementForm، …). پس اعتبارسنجی، گارد ثبت دوباره،
// Snapshot و تراکنش اتمیک عیناً همان است که تست‌های فازهای ۶ تا ۲۳ پوشش می‌دهند.
import { navigate } from '../router.js';
import { openModal } from '../components/Modal.js';
import { Input } from '../components/Input.js';
import { EmptyState } from '../components/EmptyState.js';
import { openSaleForm } from './sales/SaleForm.js';
import { openPurchaseForm } from './purchases/PurchaseForm.js';
import { openSettlementForm } from './party/SettlementForm.js';
import { openAdjustmentForm } from './inventory/AdjustmentForm.js';
import { openMeltForm } from './inventory/MeltForm.js';
import { openCashFlowForm } from './accounts/CashFlowForm.js';
import { openTransferForm } from './accounts/TransferForm.js';
import { listCustomers } from '../services/customers.js';
import { listSuppliers } from '../services/suppliers.js';
import { NavTiles } from './nav/NavTiles.js';
import { childrenOf } from '../navigation.js';

/** پس از ثبت موفق، کاربر به فهرستی می‌رود که سند تازه در آن دیده می‌شود. */
async function thenGo(promise, path) {
  const saved = await promise;
  if (saved && path) navigate(path);
  return saved;
}

/**
 * برگه‌ی انتخاب: چند دکمه‌ی بزرگ؛ لمس هر کدام برگه را می‌بندد و کارش را اجرا می‌کند.
 * خروجی برای تست: { close, modalEl }.
 */
export function openChooser(title, options) {
  const list = document.createElement('div');
  list.className = 'op-choices';
  let handle = null;
  for (const opt of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'op-choice';
    b.dataset.choice = opt.key;
    const icon = document.createElement('span');
    icon.className = 'op-choice__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = opt.icon;
    const text = document.createElement('span');
    text.className = 'op-choice__text';
    const t = document.createElement('span');
    t.className = 'op-choice__title';
    t.textContent = opt.label;
    text.appendChild(t);
    if (opt.hint) {
      const h = document.createElement('span');
      h.className = 'op-choice__hint';
      h.textContent = opt.hint;
      text.appendChild(h);
    }
    b.append(icon, text);
    b.addEventListener('click', () => {
      handle.close();
      opt.run();
    });
    list.appendChild(b);
  }
  handle = openModal({ title, content: list });
  return handle;
}

/**
 * انتخاب طرف حساب برای تسویه: نوع (مشتری / تأمین‌کننده) + جستجو + فهرست.
 * جهت عادی ثبت می‌شود (دریافت از مشتری / پرداخت به تأمین‌کننده)؛ جهت معکوس
 * مثل قبل از صفحه‌ی خودِ شخص در دسترس است.
 */
export function openPartyPicker() {
  const body = document.createElement('div');
  body.className = 'party-picker';

  const seg = document.createElement('div');
  seg.className = 'period-switch';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'نوع طرف حساب');
  const TYPES = [
    { key: 'customer', label: 'دریافت از مشتری' },
    { key: 'supplier', label: 'پرداخت به تأمین‌کننده' },
  ];
  let type = 'customer';
  const segBtns = TYPES.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'period-switch__btn';
    b.setAttribute('role', 'radio');
    b.dataset.type = t.key;
    b.textContent = t.label;
    b.addEventListener('click', () => {
      type = t.key;
      sync();
      load();
    });
    seg.appendChild(b);
    return b;
  });

  const search = Input({ label: 'جستجو', placeholder: 'نام، کد یا موبایل' });
  const list = document.createElement('div');
  list.className = 'menu-list party-picker__list';
  list.setAttribute('aria-live', 'polite');
  body.append(seg, search, list);

  const handle = openModal({ title: 'تسویه — انتخاب طرف حساب', content: body });
  handle.modalEl.classList.add('modal--full');

  function sync() {
    segBtns.forEach((b) => {
      const on = b.dataset.type === type;
      b.classList.toggle('period-switch__btn--active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const lister = type === 'supplier' ? listSuppliers : listCustomers;
    let rows = [];
    try {
      rows = await lister({ search: search.getInput().value, status: 'active' });
    } catch (err) {
      console.error('[Operations] party list', err);
    }
    if (mine !== seq) return; // پاسخ جست‌وجوی قدیمی‌تر
    list.innerHTML = '';
    if (!rows.length) {
      list.appendChild(
        EmptyState({
          icon: type === 'supplier' ? '🏭' : '👥',
          title: type === 'supplier' ? 'تأمین‌کننده‌ی فعالی پیدا نشد' : 'مشتری فعالی پیدا نشد',
          description: 'از «تنظیمات» می‌توانید شخص جدید تعریف کنید.',
        })
      );
      return;
    }
    for (const p of rows.slice(0, 60)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-list__item party-picker__item';
      b.dataset.partyId = p.id;
      const name = document.createElement('span');
      name.textContent = p.name;
      const code = document.createElement('span');
      code.className = 'party-picker__code num';
      code.textContent = p.code || '';
      b.append(name, code);
      b.addEventListener('click', () => {
        const chosenType = type;
        handle.close();
        openSettlementForm(chosenType, p.id);
      });
      list.appendChild(b);
    }
  }

  let timer = null;
  search.getInput().addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(load, 200);
  });

  sync();
  load();
  return handle;
}

/** کاشی‌های ثبت سند — ترتیب = ترتیب نمایش (در RTL اولی بالا-راست). */
export const OPERATION_TILES = [
  {
    key: 'sale',
    label: 'فروش',
    hint: 'فاکتور فروش جدید',
    icon: '🧾',
    run: () => thenGo(openSaleForm(), '/sales'),
  },
  {
    key: 'purchase',
    label: 'خرید',
    hint: 'سند خرید جدید',
    icon: '🛒',
    run: () => thenGo(openPurchaseForm({}), '/purchases'),
  },
  {
    key: 'settlement',
    label: 'تسویه',
    hint: 'دریافت و پرداخت با اشخاص',
    icon: '🤝',
    run: () => openPartyPicker(),
  },
  {
    key: 'inventory',
    label: 'ذوب / اصلاح انبار',
    hint: 'ذوب، ورود و خروج انبار',
    icon: '⚖️',
    run: () =>
      openChooser('ذوب / اصلاح انبار', [
        { key: 'melt', icon: '🔥', label: 'ذوب', hint: 'تبدیل با درصد افت', run: () => thenGo(openMeltForm({}), '/inventory') },
        { key: 'adj-in', icon: '⬇️', label: 'ورود به انبار', hint: 'مانده ابتدای دوره، اضافی انبار، ورود مستقیم', run: () => thenGo(openAdjustmentForm('in', {}), '/inventory') },
        { key: 'adj-out', icon: '⬆️', label: 'خروج از انبار', hint: 'کسری انبار، خروج مستقیم', run: () => thenGo(openAdjustmentForm('out', {}), '/inventory') },
      ]),
  },
  {
    key: 'cash',
    label: 'صندوق و بانک',
    hint: 'واریز، برداشت، انتقال',
    icon: '💵',
    run: () =>
      openChooser('صندوق و بانک', [
        { key: 'deposit', icon: '⬇️', label: 'واریز', hint: 'ورود وجه به یک حساب', run: () => thenGo(openCashFlowForm('in'), '/accounts') },
        { key: 'withdraw', icon: '⬆️', label: 'برداشت', hint: 'خروج وجه از یک حساب', run: () => thenGo(openCashFlowForm('out'), '/accounts') },
        { key: 'transfer', icon: '🔁', label: 'انتقال بین حساب‌ها', hint: 'صندوق ← بانک و …', run: () => thenGo(openTransferForm({}), '/accounts') },
      ]),
  },
];

export default function OperationsPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'عملیات';
  header.appendChild(h1);
  wrap.appendChild(header);

  const create = document.createElement('section');
  create.className = 'section';
  const h2 = document.createElement('h2');
  h2.className = 'section__title';
  h2.textContent = 'ثبت سند';
  create.appendChild(h2);

  const tiles = document.createElement('div');
  tiles.className = 'op-tiles';
  for (const tile of OPERATION_TILES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `op-tile op-tile--${tile.key}`;
    b.dataset.op = tile.key;
    b.setAttribute('aria-label', `${tile.label} — ${tile.hint}`);
    const icon = document.createElement('span');
    icon.className = 'op-tile__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = tile.icon;
    const title = document.createElement('span');
    title.className = 'op-tile__title';
    title.textContent = tile.label;
    const hint = document.createElement('span');
    hint.className = 'op-tile__hint';
    hint.textContent = tile.hint;
    b.append(icon, title, hint);
    b.addEventListener('click', () => tile.run());
    tiles.appendChild(b);
  }
  create.appendChild(tiles);
  wrap.appendChild(create);

  const lists = document.createElement('section');
  lists.className = 'section';
  const h2b = document.createElement('h2');
  h2b.className = 'section__title';
  h2b.textContent = 'فهرست اسناد';
  lists.append(h2b, NavTiles(childrenOf('/operations').map((p) => p.path), { variant: 'grid', label: 'فهرست اسناد' }));
  wrap.appendChild(lists);

  return wrap;
}
