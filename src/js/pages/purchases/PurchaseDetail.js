// PurchaseDetail.js — صفحه جزئیات سند خرید (Phase 6)
// پنج تب: خلاصه، اقلام، پرداخت‌ها، دفاتر (اثر واقعی سند)، تاریخچه.
// تب «دفاتر» عمداً وجود دارد: کاربر باید بتواند ببیند این سند دقیقاً چه چیزی را
// در موجودی طلا و بدهی تغییر داده است — نه اینکه به یک عدد ذخیره‌شده اعتماد کند.
import { finenessOf } from '../../services/units.js';
import { openModal } from '../../components/Modal.js';
import { Button } from '../../components/Button.js';
import { Badge } from '../../components/Badge.js';
import { Tabs } from '../../components/Tabs.js';
import { Table } from '../../components/Table.js';
import { Alert } from '../../components/Alert.js';
import { LoadingState } from '../../components/LoadingState.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { showToast } from '../../components/Toast.js';
import { getPurchaseSummary, voidPurchase } from '../../services/purchases.js';
import { runVoidWithShortageGuard } from '../docs/voidGuard.js';
import { formatRial, formatGrams } from '../../utils/format.js';
import { openDocSheet } from '../docs/DocSheet.js';
import { openPurchaseForm } from './PurchaseForm.js';
import {
  GOLD_TYPE_LABELS,
  PAYMENT_MODE_LABELS,
  PAY_METHOD_LABELS,
  GOLD_REASON_LABELS,
  MONEY_REASON_LABELS,
  LEDGER_KIND_LABELS,
  purchaseStatusBadge,
  displayDate,
  displayDateLong,
  describeDueDate,
  describeLine,
  describeGoldEntry,
} from './purchaseLabels.js';

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const l = document.createElement('span');
  l.className = 'detail-row__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'detail-row__value';
  if (value instanceof Node) v.appendChild(value);
  else v.textContent = value ?? '—';
  row.append(l, v);
  return row;
}

function amountRow(label, value, variant = '') {
  const row = detailRow(label, formatRial(value));
  if (variant) row.querySelector('.detail-row__value').classList.add(`text-${variant}`);
  return row;
}

/**
 * جزئیات سند را باز می‌کند.
 * @returns {Promise<boolean>} true اگر سند تغییر کرده باشد (لغو/اصلاح) تا فهرست بازخوانی شود
 */
export async function openPurchaseDetail(purchaseId) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.appendChild(LoadingState({ label: '' }));
    let changed = false;

    const { modalEl, close } = openModal({
      title: 'جزئیات سند خرید',
      content: body,
      onClose: () => resolve(changed),
    });
    modalEl.classList.add('modal--full'); // (Phase 12) همین مودال، نه اولین مودال صفحه

    async function refresh() {
      let data;
      try {
        data = await getPurchaseSummary(purchaseId);
      } catch (err) {
        console.error('[PurchaseDetail] load', err);
        body.innerHTML = '';
        body.appendChild(Alert({ variant: 'danger', message: 'بارگذاری سند ناموفق بود.' }));
        return;
      }

      const { purchase, dueItem, supplier, payments, dueDate, goldEntries, moneyEntries, history } = data;
      const status = purchaseStatusBadge(purchase);
      body.innerHTML = '';

      // ── سربرگ ──
      const head = document.createElement('div');
      head.className = 'entity-head';
      const name = document.createElement('div');
      name.className = 'entity-head__name';
      name.textContent = `${purchase.number} — ${supplier?.name || purchase.supplierNameSnapshot || 'تأمین‌کننده حذف‌شده'}`;
      const badges = document.createElement('div');
      badges.className = 'entity-head__badges';
      badges.append(
        Badge({ label: status.label, variant: status.variant }),
        Badge({ label: PAYMENT_MODE_LABELS[purchase.paymentMode] || purchase.paymentMode, variant: 'neutral' }),
        Badge({ label: displayDate(purchase.date), variant: 'neutral' })
      );
      head.append(name, badges);
      body.appendChild(head);

      if (purchase.status === 'voided') {
        body.appendChild(
          Alert({
            variant: 'warning',
            message: purchase.replacedByPurchaseId
              ? 'این سند اصلاح شده است: اثر مالی آن کاملاً برگردانده شده و سند جایگزین ثبت شده است.'
              : `این سند باطل شده است و هیچ اثری روی موجودی و بدهی ندارد.${purchase.voidNote ? ` توضیح: ${purchase.voidNote}` : ''}`,
          })
        );
      }

      // ── تب‌ها ──
      const tabs = Tabs({
        tabs: [
          {
            label: 'خلاصه',
            render: () => {
              const wrap = document.createElement('div');
              wrap.append(
                detailRow('تأمین‌کننده', supplier ? `${supplier.name} (${supplier.code})` : purchase.supplierNameSnapshot),
                detailRow('تاریخ', displayDateLong(purchase.date)),
                detailRow('وزن کل', formatGrams(purchase.totalWeightGrams)),
                amountRow('بهای طلا', purchase.totalGoldPriceIRR),
                amountRow('اجرت', purchase.totalWageIRR),
                amountRow('مبلغ کل', purchase.grandTotalIRR),
                amountRow('پرداخت نقدی', purchase.paidCashIRR),
                detailRow('پرداخت طلا', `${formatGrams(purchase.paidGoldGrams)} (${formatRial(purchase.paidGoldValueIRR)})`),
                amountRow('باقیمانده', purchase.remainingIRR, purchase.remainingIRR > 0 ? 'danger' : 'success')
              );

              if (dueDate) {
                const described = describeDueDate(dueItem || dueDate);
                const badge = Badge({ label: described.text, variant: described.variant });
                const dueLine = document.createElement('span');
                dueLine.append(document.createTextNode(`${displayDate(dueDate.dueDate)} `), badge);
                wrap.appendChild(detailRow('سررسید', dueLine));
                // (Phase 12) مانده‌ی امروزِ سررسید — مشتق از تخصیص‌ها، نه Snapshot لحظه‌ی ثبت.
                if (dueItem && dueItem.state !== 'voided') {
                  wrap.appendChild(
                    amountRow('مانده‌ی امروزِ سررسید', dueItem.remainingIRR, dueItem.remainingIRR > 0 ? 'danger' : 'success')
                  );
                }
              }

              if (purchase.description) wrap.appendChild(detailRow('توضیحات', purchase.description));
              if (purchase.amendsPurchaseId) {
                wrap.appendChild(detailRow('این سند، اصلاحِ سند قبلی است', 'بله'));
              }
              return wrap;
            },
          },
          {
            label: 'اقلام',
            badge: purchase.lines.length,
            render: () =>
              Table({
                columns: [
                  { header: 'نوع', cell: (l) => describeLine(l, purchase) },
                  { header: 'وزن', numeric: true, cell: (l) => formatGrams(l.weightGrams) },
                  { header: 'نرخ', numeric: true, cell: (l) => formatRial(l.ratePerGram) },
                  { header: 'اجرت', numeric: true, cell: (l) => formatRial(l.wageIRR) },
                  { header: 'مبلغ قلم', numeric: true, cell: (l) => formatRial(l.lineTotalIRR) },
                ],
                rows: purchase.lines,
                emptyTitle: 'قلمی ثبت نشده است',
              }),
          },
          {
            label: 'پرداخت‌ها',
            badge: payments.length,
            render: () =>
              Table({
                columns: [
                  { header: 'شماره', key: 'number' },
                  { header: 'روش', cell: (p) => PAY_METHOD_LABELS[p.method] || p.method },
                  {
                    header: 'شرح',
                    cell: (p) =>
                      p.method === 'gold'
                        ? describeGoldEntry(p)
                        : '—',
                  },
                  { header: 'مبلغ', numeric: true, cell: (p) => formatRial(p.valueIRR) },
                  { header: 'وضعیت', cell: (p) => (p.status === 'voided' ? 'باطل' : 'تأییدشده') },
                ],
                rows: payments,
                emptyTitle: 'پرداختی ثبت نشده است',
                emptyDesc: 'این خرید به‌صورت رسیدی ثبت شده است.',
              }),
          },
          {
            label: 'دفاتر',
            badge: goldEntries.length + moneyEntries.length,
            render: () => {
              const wrap = document.createElement('div');

              const goldTitle = document.createElement('div');
              goldTitle.className = 'section__title';
              goldTitle.textContent = 'دفتر طلا';
              wrap.appendChild(goldTitle);
              wrap.appendChild(
                Table({
                  columns: [
                    { header: 'جهت', cell: (e) => (e.direction === 'IN' ? 'ورود' : 'خروج') },
                    { header: 'بابت', cell: (e) => GOLD_REASON_LABELS[e.reason] || e.reason },
                    { header: 'محل', cell: (e) => `${LEDGER_KIND_LABELS[e.accountRef.kind] || e.accountRef.kind}` },
                    { header: 'وزن', numeric: true, cell: (e) => formatGrams(e.weightGrams) },
                  ],
                  rows: goldEntries,
                  emptyTitle: 'رکورد طلایی ثبت نشده است',
                })
              );

              const moneyTitle = document.createElement('div');
              moneyTitle.className = 'section__title';
              moneyTitle.textContent = 'دفتر وجه';
              wrap.appendChild(moneyTitle);
              wrap.appendChild(
                Table({
                  columns: [
                    { header: 'بابت', cell: (e) => MONEY_REASON_LABELS[e.reason] || e.reason },
                    { header: 'محل', cell: (e) => LEDGER_KIND_LABELS[e.accountRef.kind] || e.accountRef.kind },
                    { header: 'بدهکار', numeric: true, cell: (e) => (e.debit ? formatRial(e.debit) : '—') },
                    { header: 'بستانکار', numeric: true, cell: (e) => (e.credit ? formatRial(e.credit) : '—') },
                  ],
                  rows: moneyEntries,
                  emptyTitle: 'رکورد وجهی ثبت نشده است',
                })
              );

              const note = document.createElement('div');
              note.className = 'doc-line__note';
              note.textContent =
                'موجودی طلا و بدهی تأمین‌کننده از همین رکوردها محاسبه می‌شوند؛ هیچ عددی جداگانه ذخیره نشده است.';
              wrap.appendChild(note);
              return wrap;
            },
          },
          {
            label: 'تاریخچه',
            badge: history.length,
            render: () =>
              Table({
                columns: [
                  { header: 'رویداد', cell: (h) => (h.action === 'create' ? 'ثبت' : h.action === 'void' ? 'ابطال' : h.action) },
                  { header: 'تاریخ', cell: (h) => displayDate(h.timestamp) },
                ],
                rows: history,
                emptyTitle: 'تاریخچه‌ای ثبت نشده است',
              }),
          },
        ],
      });
      body.appendChild(tabs);

      // ── اقدامات ──
      // برگه‌ی چاپ برای سند باطل‌شده هم در دسترس است؛ خودِ برگه وضعیت ابطال را می‌نویسد.
      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      actions.appendChild(
        Button({
          label: 'برگه سند (چاپ)',
          variant: 'secondary',
          onClick: () => openDocSheet({ kind: 'purchase', id: purchase.id }),
        })
      );
      if (purchase.status !== 'voided') {
        actions.append(
          Button({
            label: 'اصلاح سند',
            variant: 'secondary',
            onClick: async () => {
              const saved = await openPurchaseForm({ purchase });
              if (saved) {
                changed = true;
                close();
              }
            },
          }),
          Button({
            label: 'لغو سند',
            variant: 'danger',
            onClick: async () => {
              const confirmed = await confirmDialog({
                title: 'لغو سند خرید',
                message:
                  'با لغو این سند، تمام اثرات آن روی موجودی طلا، بدهی تأمین‌کننده و حساب‌ها معکوس می‌شود. ' +
                  'سند حذف نمی‌شود و در تاریخچه باقی می‌ماند. ادامه می‌دهید؟',
                confirmLabel: 'بله، لغو کن',
                danger: true,
              });
              if (!confirmed) return;
              try {
                const res = await runVoidWithShortageGuard((opts) => voidPurchase(purchase.id, opts));
                if (!res.done) return;
                changed = true;
                showToast(`سند ${purchase.number} باطل شد.`, { variant: 'success' });
                await refresh();
              } catch (err) {
                console.error('[PurchaseDetail] void', err);
                showToast(err?.message || 'لغو سند ناموفق بود.', { variant: 'danger' });
              }
            },
          })
        );
      }
      body.appendChild(actions);
    }

    refresh();
  });
}
