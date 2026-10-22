// BucketDetail.js — جزئیات یک سطل انبار (Phase 10)
//
// چهار تب: خلاصه، فرمول موجودی، گردش انبار، اسناد انبار.
// هیچ عددی اینجا محاسبه نمی‌شود؛ همه از services/inventory.js می‌آید تا فرمول در دو
// جای مستقل پیاده نشود (ARCHITECTURE §4.1).
import { openModal } from '../../components/Modal.js';
import { Tabs } from '../../components/Tabs.js';
import { Table } from '../../components/Table.js';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { LoadingState } from '../../components/LoadingState.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { bucketSummary } from '../../services/inventory.js';
import { listInventoryDocs, voidInventoryDoc } from '../../services/inventoryDocs.js';
import { runVoidWithShortageGuard } from '../docs/voidGuard.js';
import { formatGrams, formatRial } from '../../utils/format.js';
import { openAdjustmentForm } from './AdjustmentForm.js';
import { openMeltForm } from './MeltForm.js';
import {
  displayDate,
  describeStock,
  describeUnrealized,
  inventoryDocStatusBadge,
  describeInventoryDoc,
  GOLD_REASON_LABELS,
  INVENTORY_DOC_KIND_LABELS,
} from './inventoryLabels.js';

function infoRow(label, value, variant = '') {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const l = document.createElement('span');
  l.className = 'detail-row__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = `detail-row__value num${variant ? ` detail-row__value--${variant}` : ''}`;
  v.textContent = value;
  row.append(l, v);
  return row;
}

/**
 * @param {string} refId شناسه‌ی سطل (`melted:18` یا `product:<id>`)
 * @returns {Promise<boolean>} true اگر چیزی تغییر کرد و صفحه‌ی پشت باید تازه شود.
 */
export function openBucketDetail(refId) {
  return new Promise((resolve) => {
    let changed = false;

    const container = document.createElement('div');
    container.appendChild(LoadingState({ label: '' }));

    const { close } = openModal({
      title: 'جزئیات سطل انبار',
      content: container,
      onClose: () => resolve(changed),
    });

    async function render() {
      container.innerHTML = '';
      container.appendChild(LoadingState({ label: '' }));

      let data;
      try {
        data = await bucketSummary(refId);
      } catch (err) {
        container.innerHTML = '';
        container.appendChild(Alert({ variant: 'danger', message: err?.message || 'بارگذاری ناموفق بود.' }));
        return;
      }

      const docs = await listInventoryDocs({ refId });
      container.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'balance-card';
      const stock = describeStock(data.grams);
      const title = document.createElement('div');
      title.className = 'balance-card__title';
      title.textContent = data.label;
      const amount = document.createElement('div');
      amount.className = `balance-card__amount num balance-card__amount--${stock.variant}`;
      amount.textContent = stock.amount;
      const caption = document.createElement('div');
      caption.className = 'balance-card__caption';
      caption.textContent = stock.text;
      head.append(title, amount, caption);
      container.appendChild(head);

      const quick = document.createElement('div');
      quick.className = 'modal__actions';
      quick.append(
        Button({
          label: 'ورود / اضافی',
          variant: 'secondary',
          onClick: async () => {
            if (await openAdjustmentForm('in', { refId })) {
              changed = true;
              render();
            }
          },
        }),
        Button({
          label: 'خروج / کسری',
          variant: 'secondary',
          onClick: async () => {
            if (await openAdjustmentForm('out', { refId })) {
              changed = true;
              render();
            }
          },
        }),
        Button({
          label: 'ذوب',
          variant: 'secondary',
          onClick: async () => {
            if (await openMeltForm({ fromRefId: refId })) {
              changed = true;
              render();
            }
          },
        })
      );
      container.appendChild(quick);

      const tabs = Tabs({
        tabs: [
          { label: 'خلاصه', render: () => renderSummary(data) },
          { label: 'فرمول موجودی', render: () => renderFormula(data) },
          { label: 'گردش انبار', render: () => renderStatement(data) },
          { label: 'اسناد انبار', render: () => renderDocs(docs) },
        ],
      });
      container.appendChild(tabs);
    }

    function renderSummary(data) {
      const wrap = document.createElement('div');
      const unrealized = describeUnrealized(data.unrealizedIRR);
      wrap.append(
        infoRow('موجودی', formatGrams(data.grams)),
        infoRow('جمع ورود', formatGrams(data.inGrams), 'success'),
        infoRow('جمع خروج', formatGrams(data.outGrams), 'danger'),
        infoRow('عیار', String(data.karat)),
        infoRow('نرخ روز هر گرم', formatRial(data.ratePerGram)),
        infoRow('ارزش روز', formatRial(data.marketValueIRR)),
        infoRow('ارزش دفتری', formatRial(data.bookValueIRR)),
        infoRow(unrealized.text, unrealized.amount, unrealized.variant)
      );
      wrap.appendChild(
        Alert({
          variant: 'info',
          message:
            'ارزش روز = وزن × نرخ جاری همان عیار. ارزش دفتری = بهای ثبت‌شده‌ی همین سطل در دفتر وجه. ' +
            'تفاوت این دو، سود یا زیانی است که هنوز تحقق نیافته.',
        })
      );
      return wrap;
    }

    function renderFormula(data) {
      const rows = data.flow.steps.filter((s) => s.count > 0);
      const table = Table({
        columns: [
          { header: 'جزء', key: 'label' },
          { header: 'ورود', numeric: true, cell: (r) => (r.inGrams ? formatGrams(r.inGrams) : '—') },
          { header: 'خروج', numeric: true, cell: (r) => (r.outGrams ? formatGrams(r.outGrams) : '—') },
          { header: 'خالص', numeric: true, cell: (r) => formatGrams(r.netGrams) },
        ],
        rows,
        emptyTitle: 'هنوز گردشی ثبت نشده',
      });

      const wrap = document.createElement('div');
      wrap.appendChild(table);
      wrap.appendChild(infoRow('موجودی فعلی (جمع اجزا)', formatGrams(data.flow.closing)));
      wrap.appendChild(
        Alert({
          variant: 'info',
          message: 'جمع همه‌ی اجزای بالا همیشه دقیقاً برابر موجودی فعلی است — هر دو از یک دفتر می‌آیند.',
        })
      );
      return wrap;
    }

    function renderStatement(data) {
      return Table({
        columns: [
          { header: 'تاریخ', cell: (r) => displayDate(r.date) },
          { header: 'بابت', cell: (r) => GOLD_REASON_LABELS[r.reason] || r.reason },
          { header: 'ورود', numeric: true, cell: (r) => (r.direction === 'IN' ? formatGrams(r.weightGrams) : '—') },
          { header: 'خروج', numeric: true, cell: (r) => (r.direction === 'OUT' ? formatGrams(r.weightGrams) : '—') },
          { header: 'مانده', numeric: true, cell: (r) => formatGrams(r.balance) },
        ],
        rows: data.statement,
        emptyTitle: 'گردشی برای این سطل ثبت نشده',
      });
    }

    function renderDocs(docs) {
      if (!docs.length) {
        return Table({ columns: [], rows: [], emptyTitle: 'سند انباری برای این سطل ثبت نشده' });
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
        meta.appendChild(date);
        if (doc.description) {
          const desc = document.createElement('span');
          desc.textContent = doc.description;
          meta.appendChild(desc);
        }
        main.append(title, meta);

        const side = document.createElement('div');
        side.className = 'entity-card__side';
        const amountEl = document.createElement('span');
        amountEl.className = 'entity-card__amount num';
        amountEl.textContent = describeInventoryDoc(doc);
        side.appendChild(amountEl);

        if (doc.status !== 'voided') {
          side.appendChild(
            Button({
              label: 'لغو',
              variant: 'ghost',
              onClick: async () => {
                const proceed = await confirmDialog({
                  title: 'لغو سند انبار',
                  message: `سند ${doc.number} باطل می‌شود و اثر آن روی موجودی و ارزش انبار برمی‌گردد. سند حذف نمی‌شود.`,
                  confirmLabel: 'بله، باطل شود',
                  danger: true,
                });
                if (!proceed) return;
                try {
                  const res = await runVoidWithShortageGuard((opts) => voidInventoryDoc(doc.id, opts));
                  if (!res.done) return;
                  changed = true;
                  showToast('سند انبار باطل شد.', { variant: 'success' });
                  render();
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

      return list;
    }

    render();
    // `close` فقط برای همسانی امضا با بقیه‌ی مودال‌ها نگه داشته می‌شود.
    void close;
  });
}
