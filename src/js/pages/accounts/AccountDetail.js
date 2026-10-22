// AccountDetail.js — جزئیات یک حساب (Phase 9)
//
// یک فایل برای هر دو نوع حساب:
//   • حساب وجهی  → رکورد واقعی در Store `accounts`، مانده از moneyLedger
//   • حساب طلایی → سطل انبار، موجودی از goldLedger (رکوردی وجود ندارد)
// تفاوت‌ها داده‌اند نه کد؛ ساختار تب‌ها یکی است.
//
// نکته‌ی معماری: هیچ عددی در این فایل ذخیره یا دستی جمع زده نمی‌شود. همه‌ی اعداد
// از services/accounts.js می‌آیند که خودش به services/ledger.js تکیه دارد.
import { openModal } from '../../components/Modal.js';
import { Button } from '../../components/Button.js';
import { Badge } from '../../components/Badge.js';
import { Tabs } from '../../components/Tabs.js';
import { Table } from '../../components/Table.js';
import { Alert } from '../../components/Alert.js';
import { LoadingState } from '../../components/LoadingState.js';
import { EmptyState } from '../../components/EmptyState.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { showToast } from '../../components/Toast.js';
import {
  getAccountSummary,
  getGoldAccountSummary,
  softDeleteAccount,
  restoreAccount,
  checkAccountDeletable,
  AccountDeleteBlockedError,
} from '../../services/accounts.js';
import { listCashFlows, voidCashFlow } from '../../services/cashFlow.js';
import { voidTransfer } from '../../services/transfers.js';
import { runVoidWithShortageGuard } from '../docs/voidGuard.js';
import { formatRial, formatGrams } from '../../utils/format.js';
import { openAccountForm } from './AccountForm.js';
import { openTransferForm } from './TransferForm.js';
import { openCashFlowForm } from './CashFlowForm.js';
import {
  ACCOUNT_TYPE_LABELS,
  MONEY_REASON_LABELS,
  GOLD_REASON_LABELS,
  CASH_DIRECTION_LABELS,
  accountStatusBadge,
  transferStatusBadge,
  describeAccountBalance,
  describeGoldBalance,
  displayDate,
  displayDateLong,
} from './accountLabels.js';

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

function balanceCard({ title, described, note }) {
  const card = document.createElement('div');
  card.className = `balance-card balance-card--${described.variant}`;

  const t = document.createElement('div');
  t.className = 'balance-card__title';
  t.textContent = title;

  const amount = document.createElement('div');
  amount.className = 'balance-card__amount num';
  amount.textContent = described.amount;

  const state = document.createElement('div');
  state.className = 'balance-card__state';
  state.textContent = described.text;

  card.append(t, amount, state);

  if (note) {
    const n = document.createElement('div');
    n.className = 'balance-card__note';
    n.textContent = note;
    card.appendChild(n);
  }
  return card;
}

/** جدول گردش وجهی — همان شکل «گردش حساب» طرف حساب (Phase 4) برای یکدستی. */
function moneyStatementTable(rows) {
  return Table({
    columns: [
      { header: 'تاریخ', cell: (r) => displayDate(r.date) },
      { header: 'شرح', cell: (r) => MONEY_REASON_LABELS[r.reason] || r.reason },
      { header: 'بدهکار', numeric: true, cell: (r) => (r.debit ? formatRial(r.debit) : '—') },
      { header: 'بستانکار', numeric: true, cell: (r) => (r.credit ? formatRial(r.credit) : '—') },
      { header: 'مانده', numeric: true, cell: (r) => formatRial(r.balance) },
    ],
    rows,
    emptyTitle: 'گردشی ثبت نشده',
    emptyDesc: 'هر واریز، برداشت، انتقال، خرید یا فروشی که این حساب را درگیر کند اینجا دیده می‌شود.',
  });
}

function goldStatementTable(rows) {
  return Table({
    columns: [
      { header: 'تاریخ', cell: (r) => displayDate(r.date) },
      { header: 'شرح', cell: (r) => GOLD_REASON_LABELS[r.reason] || r.reason },
      { header: 'جهت', cell: (r) => (r.direction === 'IN' ? 'ورود' : 'خروج') },
      { header: 'وزن', numeric: true, cell: (r) => formatGrams(r.weightGrams) },
      { header: 'موجودی', numeric: true, cell: (r) => formatGrams(r.balance) },
    ],
    rows,
    emptyTitle: 'گردشی ثبت نشده',
  });
}

function transfersTable(rows, accountId, onVoid) {
  return Table({
    columns: [
      { header: 'شماره', cell: (r) => r.number },
      { header: 'تاریخ', cell: (r) => displayDate(r.date) },
      { header: 'جهت', cell: (r) => (r.from?.id === accountId ? 'خروج' : 'ورود') },
      {
        header: 'مبلغ / وزن',
        numeric: true,
        cell: (r) => (r.kind === 'money' ? formatRial(r.amountIRR) : formatGrams(r.weightGrams)),
      },
      {
        header: '',
        cell: (r) => Button({ label: 'لغو', variant: 'ghost', onClick: () => onVoid(r) }),
      },
    ],
    rows,
    emptyTitle: 'انتقالی ثبت نشده',
  });
}

/**
 * جزئیات حساب را باز می‌کند.
 * @param {object} target `{kind: 'account'|'gold', id}` — id برای طلا همان refId سطل است.
 * @returns {Promise<boolean>} true اگر چیزی تغییر کرده باشد تا فهرست بازخوانی شود.
 */
export async function openAccountDetail(target) {
  const isGold = target.kind === 'gold';

  return new Promise((resolve) => {
    const body = document.createElement('div');
    body.appendChild(LoadingState({ label: '' }));
    let changed = false;

    const { modalEl, close } = openModal({
      title: isGold ? 'جزئیات حساب طلا' : 'جزئیات حساب',
      content: body,
      onClose: () => resolve(changed),
    });
    modalEl.classList.add('modal--full'); // (Phase 12) همین مودال، نه اولین مودال صفحه

    async function refresh() {
      body.innerHTML = '';
      body.appendChild(LoadingState({ label: '' }));
      try {
        if (isGold) await renderGold();
        else await renderMoney();
      } catch (err) {
        console.error('[AccountDetail] load', err);
        body.innerHTML = '';
        body.appendChild(Alert({ variant: 'danger', message: 'بارگذاری حساب ناموفق بود.' }));
      }
    }

    // ─────────────────────────── حساب وجهی ───────────────────────────

    async function renderMoney() {
      const [data, cashFlows] = await Promise.all([
        getAccountSummary(target.id),
        listCashFlows({ accountId: target.id, status: 'confirmed' }),
      ]);
      const { account, balance, balanceParts, statement, transfers, history } = data;
      const status = accountStatusBadge(account);

      body.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'entity-head';
      const name = document.createElement('div');
      name.className = 'entity-head__name';
      name.textContent = account.name;
      const badges = document.createElement('div');
      badges.className = 'entity-head__badges';
      badges.append(
        Badge({ label: ACCOUNT_TYPE_LABELS[account.type] || account.type, variant: 'neutral' }),
        Badge({ label: status.label, variant: status.variant })
      );
      head.append(name, badges);
      body.appendChild(head);

      const cards = document.createElement('div');
      cards.className = 'balance-cards';
      cards.appendChild(
        balanceCard({
          title: 'موجودی حساب',
          described: describeAccountBalance(balance),
          note: 'این عدد ذخیره نشده است؛ در همین لحظه از دفتر وجه محاسبه شد.',
        })
      );
      body.appendChild(cards);

      const quickActions = document.createElement('div');
      quickActions.className = 'modal__actions';
      quickActions.append(
        Button({
          label: 'واریز',
          variant: 'secondary',
          onClick: async () => {
            if (await openCashFlowForm('in', { defaultAccountId: account.id })) {
              changed = true;
              refresh();
            }
          },
        }),
        Button({
          label: 'برداشت',
          variant: 'secondary',
          onClick: async () => {
            if (await openCashFlowForm('out', { defaultAccountId: account.id })) {
              changed = true;
              refresh();
            }
          },
        }),
        Button({
          label: 'انتقال',
          variant: 'secondary',
          onClick: async () => {
            if (await openTransferForm({ kind: 'money', defaultFromAccountId: account.id })) {
              changed = true;
              refresh();
            }
          },
        })
      );
      body.appendChild(quickActions);

      const tabs = Tabs({
        tabs: [
          {
            label: 'اطلاعات',
            render: () => {
              const wrap = document.createElement('div');
              const rows = document.createElement('div');
              rows.className = 'detail-rows';
              rows.append(
                detailRow('نام حساب', account.name),
                detailRow('نوع', ACCOUNT_TYPE_LABELS[account.type] || account.type),
                detailRow('وضعیت', status.label),
                detailRow('جمع بدهکار', formatRial(balanceParts.debit)),
                detailRow('جمع بستانکار', formatRial(balanceParts.credit)),
                detailRow('تاریخ ایجاد', displayDateLong(account.createdAt)),
                detailRow('توضیحات', account.notes || '—')
              );
              wrap.appendChild(rows);

              const actions = document.createElement('div');
              actions.className = 'modal__actions';
              actions.appendChild(
                Button({
                  label: 'ویرایش',
                  variant: 'secondary',
                  onClick: async () => {
                    if (await openAccountForm({ account })) {
                      changed = true;
                      refresh();
                    }
                  },
                })
              );
              actions.appendChild(
                account.deletedAt
                  ? Button({
                      label: 'بازگرداندن',
                      variant: 'primary',
                      onClick: async () => {
                        await restoreAccount(account.id);
                        showToast('حساب بازگردانده شد.', { variant: 'success' });
                        changed = true;
                        refresh();
                      },
                    })
                  : Button({ label: 'حذف حساب', variant: 'danger', onClick: onDelete })
              );
              wrap.appendChild(actions);
              return wrap;
            },
          },
          {
            label: 'گردش حساب',
            badge: statement.length,
            render: () => moneyStatementTable(statement),
          },
          {
            label: 'واریز و برداشت',
            badge: cashFlows.length,
            render: () =>
              Table({
                columns: [
                  { header: 'شماره', cell: (r) => r.number },
                  { header: 'تاریخ', cell: (r) => displayDate(r.date) },
                  { header: 'نوع', cell: (r) => CASH_DIRECTION_LABELS[r.direction] },
                  { header: 'بابت', cell: (r) => r.categoryLabel },
                  { header: 'مبلغ', numeric: true, cell: (r) => formatRial(r.amountIRR) },
                  {
                    header: '',
                    cell: (r) =>
                      Button({
                        label: 'لغو',
                        variant: 'ghost',
                        onClick: async () => {
                          const proceed = await confirmDialog({
                            title: 'لغو سند',
                            message: `سند ${r.number} لغو می‌شود و اثر آن روی مانده برگردانده می‌شود. مطمئن‌اید؟`,
                            confirmLabel: 'بله، لغو کن',
                            danger: true,
                          });
                          if (!proceed) return;
                          await voidCashFlow(r.store, r.id);
                          showToast('سند لغو شد.', { variant: 'success' });
                          changed = true;
                          refresh();
                        },
                      }),
                  },
                ],
                rows: cashFlows,
                emptyTitle: 'واریز یا برداشتی ثبت نشده',
              }),
          },
          {
            label: 'انتقال‌ها',
            badge: transfers.length,
            render: () => transfersTable(transfers, account.id, onVoidTransfer),
          },
          {
            label: 'تاریخچه',
            badge: history.length,
            render: () =>
              Table({
                columns: [
                  { header: 'زمان', cell: (r) => displayDateLong(r.timestamp) },
                  {
                    header: 'رویداد',
                    cell: (r) =>
                      r.action === 'create'
                        ? 'ایجاد حساب'
                        : r.action === 'void'
                          ? 'حذف نرم'
                          : r.before?.deletedAt && !r.after?.deletedAt
                            ? 'بازیابی'
                            : 'ویرایش',
                  },
                ],
                rows: history,
                emptyTitle: 'تاریخچه‌ای ثبت نشده',
              }),
          },
        ],
      });
      body.appendChild(tabs);
    }

    // ─────────────────────────── حساب طلایی ───────────────────────────

    async function renderGold() {
      const data = await getGoldAccountSummary(target.id);
      body.innerHTML = '';

      const head = document.createElement('div');
      head.className = 'entity-head';
      const name = document.createElement('div');
      name.className = 'entity-head__name';
      name.textContent = data.name;
      const badges = document.createElement('div');
      badges.className = 'entity-head__badges';
      badges.append(Badge({ label: `عیار ${data.karat}`, variant: 'neutral' }));
      head.append(name, badges);
      body.appendChild(head);

      const cards = document.createElement('div');
      cards.className = 'balance-cards';
      cards.appendChild(
        balanceCard({
          title: 'موجودی طلا',
          described: describeGoldBalance(data.grams),
          note: 'حساب طلایی رکورد مستقل ندارد؛ این همان سطل موجودی انبار است.',
        })
      );
      body.appendChild(cards);

      const quickActions = document.createElement('div');
      quickActions.className = 'modal__actions';
      quickActions.appendChild(
        Button({
          label: 'انتقال طلا',
          variant: 'secondary',
          onClick: async () => {
            if (await openTransferForm({ kind: 'gold', defaultFromRefId: data.refId })) {
              changed = true;
              refresh();
            }
          },
        })
      );
      body.appendChild(quickActions);

      const tabs = Tabs({
        tabs: [
          {
            label: 'اطلاعات',
            render: () => {
              const rows = document.createElement('div');
              rows.className = 'detail-rows';
              rows.append(
                detailRow('حساب', data.name),
                detailRow('عیار', String(data.karat)),
                detailRow('جمع ورودی', formatGrams(data.inGrams)),
                detailRow('جمع خروجی', formatGrams(data.outGrams)),
                detailRow('موجودی', formatGrams(data.grams)),
                detailRow('ارزش دفتری', formatRial(data.bookValueIRR))
              );
              const note = Alert({
                variant: 'info',
                message:
                  'ارزش دفتری، بهای تمام‌شده‌ی دقیق نیست: هنگام فروش کل مبلغ فروش از سطل کم می‌شود ' +
                  '(تصمیم ثبت‌شده در ACCOUNTING_RULES §3.4). گزارش سود در فاز گزارش‌ها آن را جداگانه محاسبه می‌کند.',
              });
              const wrap = document.createElement('div');
              wrap.append(rows, note);
              return wrap;
            },
          },
          {
            label: 'گردش موجودی',
            badge: data.statement.length,
            render: () => goldStatementTable(data.statement),
          },
        ],
      });
      body.appendChild(tabs);
    }

    // ─────────────────────────────── اقدام‌ها ───────────────────────────────

    async function onVoidTransfer(row) {
      const proceed = await confirmDialog({
        title: 'لغو انتقال',
        message: `انتقال ${row.number} لغو می‌شود و اثر آن روی مانده‌ی هر دو حساب برگردانده می‌شود. مطمئن‌اید؟`,
        confirmLabel: 'بله، لغو کن',
        danger: true,
      });
      if (!proceed) return;
      try {
        const res = await runVoidWithShortageGuard((opts) => voidTransfer(row.id, opts));
        if (!res.done) return;
        showToast('انتقال لغو شد.', { variant: 'success' });
        changed = true;
        refresh();
      } catch (err) {
        console.error('[AccountDetail] voidTransfer', err);
        showToast(err?.message || 'لغو انتقال ناموفق بود.', { variant: 'danger' });
      }
    }

    async function onDelete() {
      const guard = await checkAccountDeletable(target.id);
      if (!guard.deletable) {
        showToast(guard.reasons.join(' '), { variant: 'danger' });
        return;
      }
      const proceed = await confirmDialog({
        title: 'حذف حساب',
        message: 'این حساب غیرفعال و از فهرست‌ها حذف می‌شود. گردش گذشته‌اش برای همیشه باقی می‌ماند.',
        confirmLabel: 'بله، حذف کن',
        danger: true,
      });
      if (!proceed) return;
      try {
        await softDeleteAccount(target.id);
        showToast('حساب حذف شد.', { variant: 'success' });
        changed = true;
        close();
      } catch (err) {
        if (err instanceof AccountDeleteBlockedError) {
          showToast(err.reasons.join(' '), { variant: 'danger' });
          return;
        }
        console.error('[AccountDetail] delete', err);
        showToast(err?.message || 'حذف ناموفق بود.', { variant: 'danger' });
      }
    }

    refresh();
  });
}
