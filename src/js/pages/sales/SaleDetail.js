// SaleDetail.js — صفحه جزئیات فاکتور فروش (Phase 7)
// شش تب: خلاصه، اقلام، دریافت‌ها، برگشت‌ها، دفاتر، تاریخچه.
// اقدامات: ثبت برگشت (جزئی/کامل) و لغو فاکتور.
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
import { getSaleSummary, voidSale, voidSaleReturn } from '../../services/sales.js';
import { runVoidWithShortageGuard } from '../docs/voidGuard.js';
import { formatRial, formatGrams } from '../../utils/format.js';
import { openSaleReturnForm } from './SaleReturnForm.js';
import { openDocSheet } from '../docs/DocSheet.js';
import {
  GOLD_TYPE_LABELS,
  PAYMENT_MODE_LABELS,
  PAY_METHOD_LABELS,
  GOLD_REASON_LABELS,
  MONEY_REASON_LABELS,
  LEDGER_KIND_LABELS,
  saleStatusBadge,
  returnBadge,
  displayDate,
  displayDateLong,
  describeDueDate,
  describeLine,
  describeGoldEntry,
} from './saleLabels.js';

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
 * جزئیات فاکتور را باز می‌کند.
 * @returns {Promise<boolean>} true اگر سند تغییر کرده باشد (لغو/برگشت) تا فهرست بازخوانی شود
 */
export async function openSaleDetail(saleId) {
  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.appendChild(LoadingState({ label: '' }));
    let changed = false;

    const { modalEl, close } = openModal({
      title: 'جزئیات فاکتور فروش',
      content: body,
      onClose: () => resolve(changed),
    });
    modalEl.classList.add('modal--full'); // (Phase 12) همین مودال، نه اولین مودال صفحه

    async function refresh() {
      let data;
      try {
        data = await getSaleSummary(saleId);
      } catch (err) {
        console.error('[SaleDetail] load', err);
        body.innerHTML = '';
        body.appendChild(Alert({ variant: 'danger', message: 'بارگذاری فاکتور ناموفق بود.' }));
        return;
      }

      const { sale, dueItem, customer, receipts, dueDate, returns, goldEntries, moneyEntries, history } = data;
      const status = saleStatusBadge(sale);
      const retBadge = returnBadge(sale);
      body.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'entity-head';
      const name = document.createElement('div');
      name.className = 'entity-head__name';
      name.textContent = `${sale.number} — ${customer?.name || sale.customerNameSnapshot || 'مشتری حذف‌شده'}`;
      const badges = document.createElement('div');
      badges.className = 'entity-head__badges';
      badges.append(
        Badge({ label: status.label, variant: status.variant }),
        Badge({ label: PAYMENT_MODE_LABELS[sale.paymentMode] || sale.paymentMode, variant: 'neutral' }),
        Badge({ label: displayDate(sale.date), variant: 'neutral' })
      );
      if (retBadge) badges.appendChild(Badge({ label: retBadge.label, variant: retBadge.variant }));
      head.append(name, badges);
      body.appendChild(head);

      if (sale.status === 'voided') {
        body.appendChild(
          Alert({
            variant: 'warning',
            message: `این فاکتور باطل شده است؛ طلا به موجودی برگشته و هیچ طلبی از این بابت باقی نیست.${
              sale.voidNote ? ` توضیح: ${sale.voidNote}` : ''
            }`,
          })
        );
      }

      const activeReturns = returns.filter((r) => r.status !== 'voided');

      const tabs = Tabs({
        tabs: [
          {
            label: 'خلاصه',
            render: () => {
              const wrap = document.createElement('div');
              wrap.append(
                detailRow('مشتری', customer ? `${customer.name} (${customer.code})` : sale.customerNameSnapshot),
                detailRow('تاریخ', displayDateLong(sale.date)),
                detailRow('وزن کل', formatGrams(sale.totalWeightGrams)),
                amountRow('قیمت طلا', sale.totalGoldPriceIRR),
                amountRow('اجرت', sale.totalWageIRR),
                amountRow('سود', sale.totalProfitIRR),
                amountRow('تخفیف', sale.discountIRR, sale.discountIRR > 0 ? 'danger' : ''),
                amountRow('مالیات', sale.totalTaxIRR),
                amountRow('مبلغ نهایی', sale.grandTotalIRR),
                amountRow('دریافت نقدی', sale.receivedCashIRR),
                detailRow(
                  'دریافت طلا',
                  `${formatGrams(sale.receivedGoldGrams)} (${formatRial(sale.receivedGoldValueIRR)})`
                ),
                amountRow('باقیمانده', sale.remainingIRR, sale.remainingIRR > 0 ? 'danger' : 'success')
              );

              if (sale.returnStatus !== 'none') {
                wrap.append(
                  detailRow('وزن برگشتی', formatGrams(sale.returnedWeightGrams)),
                  amountRow('مبلغ برگشتی', sale.returnedAmountIRR, 'danger')
                );
              }

              if (dueDate) {
                const described = describeDueDate(dueItem || dueDate);
                const dueLine = document.createElement('span');
                dueLine.append(
                  document.createTextNode(`${displayDate(dueDate.dueDate)} `),
                  Badge({ label: described.text, variant: described.variant })
                );
                wrap.appendChild(detailRow('سررسید', dueLine));
                // (Phase 12) مانده‌ی امروزِ سررسید — مشتق از تخصیص‌ها، نه Snapshot لحظه‌ی ثبت.
                if (dueItem && dueItem.state !== 'voided') {
                  wrap.appendChild(
                    amountRow('مانده‌ی امروزِ سررسید', dueItem.remainingIRR, dueItem.remainingIRR > 0 ? 'danger' : 'success')
                  );
                }
              }

              if (sale.description) wrap.appendChild(detailRow('توضیحات', sale.description));
              return wrap;
            },
          },
          {
            label: 'اقلام',
            badge: sale.lines.length,
            render: () =>
              Table({
                columns: [
                  { header: 'نوع', cell: (l) => describeLine(l, sale) },
                  { header: 'وزن', numeric: true, cell: (l) => formatGrams(l.weightGrams) },
                  { header: 'نرخ', numeric: true, cell: (l) => formatRial(l.ratePerGram) },
                  { header: 'اجرت', numeric: true, cell: (l) => formatRial(l.wageIRR) },
                  { header: 'سود', numeric: true, cell: (l) => formatRial(l.profitIRR) },
                  { header: 'مالیات', numeric: true, cell: (l) => formatRial(l.taxIRR) },
                  { header: 'مبلغ قلم', numeric: true, cell: (l) => formatRial(l.lineTotalIRR) },
                  {
                    header: 'برگشتی',
                    numeric: true,
                    cell: (l) => (l.returnedWeightGrams ? formatGrams(l.returnedWeightGrams) : '—'),
                  },
                ],
                rows: sale.lines,
                emptyTitle: 'قلمی ثبت نشده است',
              }),
          },
          {
            label: 'دریافت‌ها',
            badge: receipts.length,
            render: () =>
              Table({
                columns: [
                  { header: 'شماره', key: 'number' },
                  { header: 'روش', cell: (r) => PAY_METHOD_LABELS[r.method] || r.method },
                  {
                    header: 'شرح',
                    cell: (r) =>
                      r.method === 'gold'
                        ? describeGoldEntry(r)
                        : '—',
                  },
                  { header: 'مبلغ', numeric: true, cell: (r) => formatRial(r.valueIRR) },
                  { header: 'وضعیت', cell: (r) => (r.status === 'voided' ? 'باطل' : 'تأییدشده') },
                ],
                rows: receipts,
                emptyTitle: 'دریافتی ثبت نشده است',
                emptyDesc: 'این فاکتور به‌صورت رسیدی ثبت شده است.',
              }),
          },
          {
            label: 'برگشت‌ها',
            badge: activeReturns.length,
            render: () => {
              const wrap = document.createElement('div');
              wrap.appendChild(
                Table({
                  columns: [
                    { header: 'شماره', key: 'number' },
                    { header: 'تاریخ', cell: (r) => displayDate(r.date) },
                    { header: 'وزن', numeric: true, cell: (r) => formatGrams(r.totalWeightGrams) },
                    { header: 'مبلغ', numeric: true, cell: (r) => formatRial(r.totalAmountIRR) },
                    { header: 'وضعیت', cell: (r) => (r.status === 'voided' ? 'باطل‌شده' : 'ثبت‌شده') },
                    {
                      header: '',
                      cell: (r) => {
                        const box = document.createElement('div');
                        box.className = 'row-actions';
                        box.appendChild(
                          Button({
                            label: 'برگه',
                            variant: 'ghost',
                            onClick: () => openDocSheet({ kind: 'saleReturn', id: r.id }),
                          })
                        );
                        if (r.status !== 'voided') {
                          box.appendChild(
                            Button({
                              label: 'لغو برگشت',
                              variant: 'ghost',
                              onClick: async () => {
                                const confirmed = await confirmDialog({
                                  title: 'لغو سند برگشت',
                                  message:
                                    'با لغو این سند برگشت، طلا دوباره از موجودی خارج و طلب مشتری بازگردانده می‌شود. ادامه می‌دهید؟',
                                  confirmLabel: 'بله، لغو کن',
                                  danger: true,
                                });
                                if (!confirmed) return;
                                try {
                                  const res = await runVoidWithShortageGuard((opts) => voidSaleReturn(r.id, opts));
                                  if (!res.done) return;
                                  changed = true;
                                  showToast(`سند برگشت ${r.number} باطل شد.`, { variant: 'success' });
                                  await refresh();
                                } catch (err) {
                                  console.error('[SaleDetail] voidReturn', err);
                                  showToast(err?.message || 'لغو سند برگشت ناموفق بود.', { variant: 'danger' });
                                }
                              },
                            })
                          );
                        }
                        return box;
                      },
                    },
                  ],
                  rows: returns,
                  emptyTitle: 'برگشتی ثبت نشده است',
                  emptyDesc: 'اگر مشتری بخشی از کالا را پس آورد، از دکمه «ثبت برگشت» استفاده کنید.',
                })
              );
              return wrap;
            },
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
                    { header: 'محل', cell: (e) => LEDGER_KIND_LABELS[e.accountRef.kind] || e.accountRef.kind },
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
                'موجودی طلا و طلب مشتری از همین رکوردها محاسبه می‌شوند؛ هیچ عددی جداگانه ذخیره نشده است. (رکوردهای اسناد برگشت در صفحه‌ی خود آن سند دیده می‌شوند.)';
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
                  {
                    header: 'رویداد',
                    cell: (h) =>
                      h.action === 'create'
                        ? 'ثبت فاکتور'
                        : h.action === 'void'
                          ? 'ابطال فاکتور'
                          : h.action === 'update'
                            ? 'به‌روزرسانی بابت برگشت'
                            : h.action,
                  },
                  { header: 'تاریخ', cell: (h) => displayDate(h.timestamp) },
                ],
                rows: history,
                emptyTitle: 'تاریخچه‌ای ثبت نشده است',
              }),
          },
        ],
      });
      body.appendChild(tabs);

      // برگه‌ی چاپ برای هر وضعیتی در دسترس است — سند باطل‌شده هم ممکن است لازم
      // شود دوباره چاپ شود (برگه خودش «باطل شده» را روی کاغذ می‌نویسد).
      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      actions.appendChild(
        Button({
          label: 'برگه سند (چاپ)',
          variant: 'secondary',
          onClick: () => openDocSheet({ kind: 'sale', id: sale.id }),
        })
      );

      if (sale.status !== 'voided') {
        if (sale.returnStatus !== 'full') {
          actions.appendChild(
            Button({
              label: 'ثبت برگشت',
              variant: 'secondary',
              onClick: async () => {
                const saved = await openSaleReturnForm(sale);
                if (saved) {
                  changed = true;
                  await refresh();
                }
              },
            })
          );
        }

        actions.appendChild(
          Button({
            label: 'لغو فاکتور',
            variant: 'danger',
            onClick: async () => {
              const confirmed = await confirmDialog({
                title: 'لغو فاکتور فروش',
                message:
                  'با لغو این فاکتور، طلا به موجودی برمی‌گردد و طلب مشتری و دریافت‌های ثبت‌شده معکوس می‌شوند. ' +
                  'فاکتور حذف نمی‌شود و در تاریخچه باقی می‌ماند. ادامه می‌دهید؟',
                confirmLabel: 'بله، لغو کن',
                danger: true,
              });
              if (!confirmed) return;
              try {
                await voidSale(sale.id);
                changed = true;
                showToast(`فاکتور ${sale.number} باطل شد.`, { variant: 'success' });
                await refresh();
              } catch (err) {
                console.error('[SaleDetail] void', err);
                showToast(err?.message || 'لغو فاکتور ناموفق بود.', { variant: 'danger' });
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
