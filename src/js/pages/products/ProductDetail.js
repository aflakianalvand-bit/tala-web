// ProductDetail.js — مودال جزئیات کالا + تاریخچه تغییرات (از auditLog)
import { openModal } from '../../components/Modal.js';
import { Button } from '../../components/Button.js';
import { Badge } from '../../components/Badge.js';
import { LoadingState } from '../../components/LoadingState.js';
import { EmptyState } from '../../components/EmptyState.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { showToast } from '../../components/Toast.js';
import { getProductHistory, softDeleteProduct, restoreProduct } from '../../services/products.js';
import {
  TYPE_LABELS,
  TYPE_BADGE_VARIANT,
  FIELD_LABELS,
  formatFieldValue,
  productStatusBadge,
} from './productLabels.js';
import { formatGrams } from '../../utils/format.js';
import { formatJalaliDateLong } from '../../utils/date.js';
import { openProductForm } from './ProductForm.js';

const HISTORY_SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function diffEntry(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    if (HISTORY_SKIP_FIELDS.has(key)) continue;
    const a = before[key];
    const b = after[key];
    const av = typeof a === 'object' ? JSON.stringify(a) : a;
    const bv = typeof b === 'object' ? JSON.stringify(b) : b;
    if (av !== bv) {
      changes.push({
        field: key,
        from: formatFieldValue(key, a),
        to: formatFieldValue(key, b),
      });
    }
  }
  return changes;
}

function describeHistoryEntry(entry) {
  if (entry.action === 'create') return 'ایجاد کالا';
  if (entry.action === 'void') return 'غیرفعال‌سازی (حذف نرم)';
  if (entry.action === 'update') {
    if (entry.before?.deletedAt && !entry.after?.deletedAt) return 'بازیابی از حذف نرم';
    return 'ویرایش';
  }
  return entry.action;
}

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const l = document.createElement('span');
  l.className = 'detail-row__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'detail-row__value';
  v.textContent = value;
  row.append(l, v);
  return row;
}

function renderHistoryList(entries) {
  if (!entries.length) {
    return EmptyState({ icon: '🕒', title: 'تاریخچه‌ای ثبت نشده' });
  }
  const list = document.createElement('div');
  list.className = 'history-list';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-entry';

    const head = document.createElement('div');
    head.className = 'history-entry__head';
    const title = document.createElement('span');
    title.textContent = describeHistoryEntry(entry);
    const date = document.createElement('span');
    date.className = 'history-entry__date';
    date.textContent = entry.timestamp ? formatJalaliDateLong(new Date(entry.timestamp)) : '';
    head.append(title, date);
    item.appendChild(head);

    const changes = diffEntry(entry.before, entry.after);
    if (changes.length) {
      const changesWrap = document.createElement('div');
      changesWrap.className = 'history-entry__changes';
      for (const c of changes) {
        const line = document.createElement('div');
        line.className = 'history-entry__change';
        const fieldLabel = FIELD_LABELS[c.field] || c.field;
        line.innerHTML = `<b>${fieldLabel}:</b> ${c.from} ← ${c.to}`;
        changesWrap.appendChild(line);
      }
      item.appendChild(changesWrap);
    }

    list.appendChild(item);
  }
  return list;
}

/**
 * مودال جزئیات کالا را باز می‌کند.
 * @param {object} product
 * @returns {Promise<boolean>} true اگر کالا ویرایش/حذف‌نرم/بازیابی شد (فراخواننده باید لیست را Refresh کند).
 */
export function openProductDetail(product) {
  return new Promise((resolve) => {
    const body = document.createElement('div');

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.gap = 'var(--space-2)';
    titleRow.style.flexWrap = 'wrap';
    titleRow.style.marginBottom = 'var(--space-3)';
    titleRow.appendChild(Badge({ label: TYPE_LABELS[product.type] || product.type, variant: TYPE_BADGE_VARIANT[product.type] }));
    const status = productStatusBadge(product);
    titleRow.appendChild(Badge({ label: status.label, variant: status.variant }));
    body.appendChild(titleRow);

    const rows = document.createElement('div');
    rows.className = 'detail-rows';
    rows.appendChild(detailRow('کد کالا', product.code));
    rows.appendChild(detailRow('نام', product.name));
    rows.appendChild(detailRow('عیار', String(product.karat)));
    rows.appendChild(detailRow('وزن', formatGrams(product.weightGrams)));
    if (product.type === 'manufactured') {
      rows.appendChild(
        detailRow('اجرت', `${formatFieldValue('wageType', product.wageType)} — ${product.wageValue ?? 0}`)
      );
      rows.appendChild(detailRow('سود', `${product.profitPercent ?? 0}٪`));
      rows.appendChild(detailRow('مالیات', `${product.taxPercent ?? 0}٪`));
    }
    rows.appendChild(
      detailRow('قیمت روز (پیش‌فرض)', product.priceToday != null ? String(product.priceToday) : 'تعیین نشده')
    );
    if (product.description) {
      rows.appendChild(detailRow('توضیحات', product.description));
    }
    rows.appendChild(detailRow('تاریخ ایجاد', formatJalaliDateLong(new Date(product.createdAt))));
    if (product.updatedAt) {
      rows.appendChild(detailRow('آخرین ویرایش', formatJalaliDateLong(new Date(product.updatedAt))));
    }
    body.appendChild(rows);

    const historyTitle = document.createElement('div');
    historyTitle.className = 'section__title';
    historyTitle.style.marginTop = 'var(--space-4)';
    historyTitle.textContent = 'تاریخچه تغییرات';
    body.appendChild(historyTitle);

    const historyContainer = document.createElement('div');
    historyContainer.appendChild(LoadingState({ label: '' }));
    body.appendChild(historyContainer);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    actions.style.flexWrap = 'wrap';

    const editBtn = Button({
      label: 'ویرایش',
      variant: 'secondary',
      onClick: async () => {
        const saved = await openProductForm({ product });
        if (saved) {
          settled = true;
          close();
          resolve(true);
        }
      },
    });

    let deleteRestoreBtn;
    if (product.deletedAt) {
      deleteRestoreBtn = Button({
        label: 'بازیابی کالا',
        variant: 'primary',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'بازیابی کالا',
            message: `آیا از بازیابی کالای «${product.name}» مطمئن هستید؟`,
            confirmLabel: 'بازیابی',
          });
          if (!ok) return;
          try {
            await restoreProduct(product.id);
            showToast('کالا بازیابی شد.', { variant: 'success' });
            settled = true;
            close();
            resolve(true);
          } catch (err) {
            console.error('[ProductDetail] restore', err);
            showToast('بازیابی کالا ناموفق بود.', { variant: 'danger' });
          }
        },
      });
    } else {
      deleteRestoreBtn = Button({
        label: 'حذف (نرم)',
        variant: 'danger',
        onClick: async () => {
          const ok = await confirmDialog({
            title: 'حذف کالا',
            message: `کالای «${product.name}» غیرفعال و به‌صورت نرم حذف می‌شود (قابل بازیابی است). ادامه می‌دهید؟`,
            confirmLabel: 'حذف',
            danger: true,
          });
          if (!ok) return;
          try {
            await softDeleteProduct(product.id);
            showToast('کالا حذف (نرم) شد.', { variant: 'success' });
            settled = true;
            close();
            resolve(true);
          } catch (err) {
            console.error('[ProductDetail] soft delete', err);
            showToast('حذف کالا ناموفق بود.', { variant: 'danger' });
          }
        },
      });
    }

    actions.append(editBtn, deleteRestoreBtn);
    body.appendChild(actions);

    let settled = false;
    const { close } = openModal({
      title: 'جزئیات کالا',
      content: body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    getProductHistory(product.id)
      .then((entries) => {
        historyContainer.innerHTML = '';
        historyContainer.appendChild(renderHistoryList(entries));
      })
      .catch((err) => {
        console.error('[ProductDetail] history', err);
        historyContainer.innerHTML = '';
        historyContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری تاریخچه' }));
      });
  });
}
