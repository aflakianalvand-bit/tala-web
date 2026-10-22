// Products.js — کالا و انواع طلا (Phase 3: CRUD کامل، جستجو، فیلتر، Soft Delete، جزئیات، تاریخچه)
// طبق اصل معماری، این صفحه هرگز مستقیماً روی IndexedDB نمی‌نویسد — همه چیز از طریق
// services/products.js عبور می‌کند (شامل تولید کد خودکار و ثبت اتمیک auditLog).
import { Button } from '../components/Button.js';
import { Input } from '../components/Input.js';
import { Select } from '../components/Select.js';
import { Badge } from '../components/Badge.js';
import { EmptyState } from '../components/EmptyState.js';
import { LoadingState } from '../components/LoadingState.js';
import { listProducts } from '../services/products.js';
import { TYPE_LABELS, TYPE_BADGE_VARIANT, TYPE_OPTIONS, productStatusBadge } from './products/productLabels.js';
import { formatGrams } from '../utils/format.js';
import { openProductForm } from './products/ProductForm.js';
import { openProductDetail } from './products/ProductDetail.js';

const STATUS_OPTIONS = [
  { value: 'active', label: 'فعال' },
  { value: 'inactive', label: 'غیرفعال' },
  { value: 'deleted', label: 'حذف‌شده' },
  { value: 'all', label: 'همه' },
];

function renderProductCard(product, onOpen) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'product-card';

  const main = document.createElement('div');
  main.className = 'product-card__main';

  const title = document.createElement('div');
  title.className = 'product-card__title';
  const name = document.createElement('span');
  name.className = 'product-card__name';
  name.textContent = product.name;
  const codeBadge = Badge({ label: product.code, variant: 'neutral' });
  title.append(name, codeBadge);

  const meta = document.createElement('div');
  meta.className = 'product-card__meta';
  meta.appendChild(Badge({ label: TYPE_LABELS[product.type] || product.type, variant: TYPE_BADGE_VARIANT[product.type] }));
  const karatSpan = document.createElement('span');
  karatSpan.textContent = `عیار ${product.karat}`;
  const weightSpan = document.createElement('span');
  weightSpan.className = 'num';
  weightSpan.textContent = formatGrams(product.weightGrams);
  meta.append(karatSpan, weightSpan);

  main.append(title, meta);

  const side = document.createElement('div');
  side.className = 'product-card__side';
  const status = productStatusBadge(product);
  side.appendChild(Badge({ label: status.label, variant: status.variant }));

  card.append(main, side);
  card.addEventListener('click', () => onOpen(product));
  return card;
}

export default async function ProductsPage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'کالا';
  header.appendChild(h1);
  const addBtn = Button({ label: 'افزودن کالا', variant: 'primary', icon: '+' });
  header.appendChild(addBtn);
  wrap.appendChild(header);

  const subtitle = document.createElement('div');
  subtitle.className = 'page-header__subtitle';
  subtitle.style.marginBottom = 'var(--space-4)';
  subtitle.textContent = 'طلای ساخته‌شده، آبشده و متفرقه';
  wrap.appendChild(subtitle);

  const filters = document.createElement('div');
  filters.className = 'product-filters';

  const state = { search: '', type: 'all', status: 'active' };

  const searchField = Input({
    placeholder: 'جستجو بر اساس نام یا کد…',
    onInput: (value) => {
      state.search = value;
      scheduleRefresh();
    },
  });

  const filterRow = document.createElement('div');
  filterRow.className = 'product-filters__row';
  const typeFilter = Select({
    options: [{ value: 'all', label: 'همه انواع' }, ...TYPE_OPTIONS],
    value: 'all',
    onChange: (value) => {
      state.type = value;
      refresh();
    },
  });
  const statusFilter = Select({
    options: STATUS_OPTIONS,
    value: 'active',
    onChange: (value) => {
      state.status = value;
      refresh();
    },
  });
  filterRow.append(typeFilter, statusFilter);

  filters.append(searchField, filterRow);
  wrap.appendChild(filters);

  const listContainer = document.createElement('div');
  wrap.appendChild(listContainer);

  let debounceTimer = null;
  function scheduleRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refresh, 250);
  }

  async function openCreate() {
    const saved = await openProductForm({});
    if (saved) refresh();
  }

  async function openDetail(product) {
    const changed = await openProductDetail(product);
    if (changed) refresh();
  }

  async function refresh() {
    listContainer.innerHTML = '';
    listContainer.appendChild(LoadingState({ label: '' }));
    let products;
    try {
      products = await listProducts(state);
    } catch (err) {
      console.error('[ProductsPage] listProducts', err);
      listContainer.innerHTML = '';
      listContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری کالاها' }));
      return;
    }

    listContainer.innerHTML = '';
    if (!products.length) {
      listContainer.appendChild(
        EmptyState({
          icon: '💍',
          title: 'کالایی یافت نشد',
          description: state.search || state.type !== 'all' || state.status !== 'active'
            ? 'با این جستجو/فیلتر کالایی پیدا نشد.'
            : 'برای شروع، یک کالای جدید اضافه کنید.',
          actionLabel: 'افزودن کالا',
          onAction: openCreate,
        })
      );
      return;
    }

    const list = document.createElement('div');
    list.className = 'product-list';
    for (const product of products) {
      list.appendChild(renderProductCard(product, openDetail));
    }
    listContainer.appendChild(list);
  }

  addBtn.addEventListener('click', openCreate);

  await refresh();
  return wrap;
}
