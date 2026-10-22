// PartyDetail.js — صفحه جزئیات طرف حساب (مشترک بین مشتری و تأمین‌کننده)
// شش تب: اطلاعات، گردش حساب، خریدها، پرداخت‌ها، فاکتورهای باز/بدهی، سررسیدها
//
// نکته معماری: هیچ عدد مالی در این فایل ذخیره یا دستی محاسبه نمی‌شود؛
// همه‌ی اعداد از service.getSummary() می‌آیند که خودش به services/ledger.js تکیه دارد.
import { GRAM_EPS as GRAM_EPS_750, finenessOf } from '../../services/units.js';
import { GOLD_TYPE_LABELS } from '../docs/docLabels.js';
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
import { PartyDeleteBlockedError } from '../../services/party.js';
import {
  FIELD_LABELS,
  MONEY_REASON_LABELS,
  GOLD_REASON_LABELS,
  DOC_STATUS_LABELS,
  DOC_STATUS_VARIANT,
  PAY_METHOD_LABELS,
  partyStatusBadge,
  describeBalance,
  describeBaseBalance,
  describeGoldBalance,
  BalanceText,
  displayDate,
  formatFieldValue,
} from './partyLabels.js';
import { formatRial, formatGrams, formatBaseGrams } from '../../utils/format.js';
import { formatJalaliDateLong } from '../../utils/date.js';
import { openPartyForm } from './PartyForm.js';
// (Phase 11) ثبت تسویه و ویرایش تخصیص
import { openSettlementForm } from './SettlementForm.js';
import { openDocSheet } from '../docs/DocSheet.js';
import { openAllocationForm } from './AllocationForm.js';
import { voidSettlement } from '../../services/settlements.js';
import { runVoidWithShortageGuard } from '../docs/voidGuard.js';
// (Phase 12) کارت سررسید مشترک با داشبورد
import { DueItemCard } from '../dueDates/DueItemCard.js';

const HISTORY_SKIP_FIELDS = new Set(['id', 'createdAt', 'updatedAt']);

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const l = document.createElement('span');
  l.className = 'detail-row__label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'detail-row__value';
  if (value instanceof Node) v.appendChild(value);
  else v.textContent = value;
  row.append(l, v);
  return row;
}

function sectionTitle(text) {
  const el = document.createElement('div');
  el.className = 'section__title';
  el.textContent = text;
  return el;
}

/** کارت بزرگ مانده — تنها نمایش‌دهنده‌ی مقدار مشتق‌شده از Ledger. */
function balanceCard({ title, described, note }) {
  const card = document.createElement('div');
  card.className = `balance-card balance-card--${described.variant}`;

  const t = document.createElement('div');
  t.className = 'balance-card__title';
  t.textContent = title;

  const amount = document.createElement('div');
  // مقدارِ واحددار («۵٫۵ گرم ۷۵۰») نباید LTR شود — همان درس Phase 13.
  amount.className = 'balance-card__amount';
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
      changes.push({ field: key, from: formatFieldValue(key, a), to: formatFieldValue(key, b) });
    }
  }
  return changes;
}

function describeHistoryEntry(entry, entity) {
  if (entry.action === 'create') return `ایجاد ${entity}`;
  if (entry.action === 'void') return 'غیرفعال‌سازی (حذف نرم)';
  if (entry.action === 'update') {
    if (entry.before?.deletedAt && !entry.after?.deletedAt) return 'بازیابی از حذف نرم';
    return 'ویرایش';
  }
  return entry.action;
}

function renderHistoryList(entries, entity) {
  if (!entries.length) return EmptyState({ icon: '🕒', title: 'تاریخچه‌ای ثبت نشده' });

  const list = document.createElement('div');
  list.className = 'history-list';
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'history-entry';

    const head = document.createElement('div');
    head.className = 'history-entry__head';
    const title = document.createElement('span');
    title.textContent = describeHistoryEntry(entry, entity);
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
        const b = document.createElement('b');
        b.textContent = `${FIELD_LABELS[c.field] || c.field}: `;
        line.append(b, document.createTextNode(`${c.from} ← ${c.to}`));
        changesWrap.appendChild(line);
      }
      item.appendChild(changesWrap);
    }
    list.appendChild(item);
  }
  return list;
}

function infoNote(text) {
  const note = Alert({ variant: 'info', message: text });
  note.style.marginTop = 'var(--space-4)';
  return note;
}

// ───────────────────────────── سازنده‌ی تب‌ها ─────────────────────────────

function renderInfoTab(summary, cfg, loadHistory) {
  const wrap = document.createElement('div');
  const p = summary.party;

  const cards = document.createElement('div');
  cards.className = 'balance-cards';
  // (Phase 19) عدد اصلی «گرم ۷۵۰» است و معادل ریالی کنارش — تصمیم «هر دو کنار هم».
  cards.appendChild(
    balanceCard({
      title: 'مانده حساب (گرم ۷۵۰)',
      described: describeBaseBalance(summary.balanceGrams, cfg.kind),
      note: 'محاسبه‌شده از دفتر — ذخیره‌شده نیست.',
    })
  );
  cards.appendChild(
    balanceCard({
      title: 'معادل ریالی',
      described: describeBalance(summary.balance, cfg.kind),
      note: 'فقط برای مقایسه؛ مبنای حساب، گرم است.',
    })
  );
  cards.appendChild(
    balanceCard({
      title: 'مانده طلا',
      described: describeGoldBalance(summary.goldGrams, cfg.kind),
      note: 'محاسبه‌شده از دفتر طلا — ذخیره‌شده نیست.',
    })
  );
  wrap.appendChild(cards);

  const rows = document.createElement('div');
  rows.className = 'detail-rows';
  rows.appendChild(detailRow(`کد ${cfg.entity}`, p.code));
  rows.appendChild(detailRow('نام', p.name));
  rows.appendChild(detailRow('موبایل', p.phone || '—'));
  const statusBadge = partyStatusBadge(p);
  rows.appendChild(detailRow('وضعیت', Badge({ label: statusBadge.label, variant: statusBadge.variant })));
  rows.appendChild(detailRow(cfg.docCountLabel, String(summary.purchaseCount)));
  rows.appendChild(detailRow(cfg.lastDocLabel, displayDate(summary.lastPurchaseAt)));
  rows.appendChild(detailRow('جمع بدهکار', formatBaseGrams(summary.balanceGramsParts.debit)));
  rows.appendChild(detailRow('جمع بستانکار', formatBaseGrams(summary.balanceGramsParts.credit)));
  rows.appendChild(detailRow('جمع بدهکار (ریال)', formatRial(summary.balanceParts.debit)));
  rows.appendChild(detailRow('جمع بستانکار (ریال)', formatRial(summary.balanceParts.credit)));
  if (p.notes) rows.appendChild(detailRow('توضیحات', p.notes));
  rows.appendChild(detailRow('تاریخ ایجاد', formatJalaliDateLong(new Date(p.createdAt))));
  if (p.updatedAt) rows.appendChild(detailRow('آخرین ویرایش', formatJalaliDateLong(new Date(p.updatedAt))));
  wrap.appendChild(rows);

  wrap.appendChild(sectionTitle('تاریخچه تغییرات'));
  const historyContainer = document.createElement('div');
  historyContainer.appendChild(LoadingState({ label: '' }));
  wrap.appendChild(historyContainer);

  loadHistory()
    .then((entries) => {
      historyContainer.innerHTML = '';
      historyContainer.appendChild(renderHistoryList(entries, cfg.entity));
    })
    .catch((err) => {
      console.error('[PartyDetail] history', err);
      historyContainer.innerHTML = '';
      historyContainer.appendChild(EmptyState({ icon: '⚠️', title: 'خطا در بارگذاری تاریخچه' }));
    });

  return wrap;
}

function renderStatementTab(summary, cfg) {
  const wrap = document.createElement('div');

  wrap.appendChild(sectionTitle('گردش وجه'));
  wrap.appendChild(
    Table({
      columns: [
        { header: 'تاریخ', cell: (r) => displayDate(r.date) },
        { header: 'شرح', cell: (r) => MONEY_REASON_LABELS[r.reason] || r.reason || '—' },
        {
          header: 'بدهکار',
          numeric: true,
          cell: (r) => (r.debitGrams ? formatBaseGrams(r.debitGrams) : '—'),
        },
        {
          header: 'بستانکار',
          numeric: true,
          cell: (r) => (r.creditGrams ? formatBaseGrams(r.creditGrams) : '—'),
        },
        // (Phase 26) مانده‌ی تجمعی با واژه‌ی بد/بس، نه عدد علامت‌دار خام.
        { header: 'مانده', numeric: true, cell: (r) => BalanceText(describeBaseBalance(r.balance, cfg.kind)) },
      ],
      rows: summary.gramsStatement,
      emptyTitle: 'گردش وجهی ثبت نشده است',
      emptyDesc: cfg.statementEmptyDesc,
    })
  );

  wrap.appendChild(sectionTitle('گردش طلا'));
  wrap.appendChild(
    Table({
      columns: [
        { header: 'تاریخ', cell: (r) => displayDate(r.date) },
        { header: 'شرح', cell: (r) => GOLD_REASON_LABELS[r.reason] || r.reason || '—' },
        { header: 'جهت', cell: (r) => (r.direction === 'IN' ? 'ورود' : 'خروج') },
        { header: 'عیار', numeric: true, cell: (r) => String(r.karat ?? '—') },
        { header: 'وزن', numeric: true, cell: (r) => formatGrams(r.weightGrams) },
        { header: 'مانده', numeric: true, cell: (r) => BalanceText(describeGoldBalance(r.balance, cfg.kind)) },
      ],
      rows: summary.goldStatement,
      emptyTitle: 'گردش طلایی ثبت نشده است',
      emptyDesc: cfg.goldStatementEmptyDesc,
    })
  );

  wrap.appendChild(infoNote(cfg.statementNote));
  return wrap;
}

function renderDocsTab(summary, cfg) {
  const wrap = document.createElement('div');
  wrap.appendChild(
    Table({
      columns: [
        { header: 'شماره', cell: (d) => d.number || '—' },
        { header: 'تاریخ', cell: (d) => displayDate(d.date) },
        { header: 'جمع سند', numeric: true, cell: (d) => formatBaseGrams(d.totalGrams) },
        // (Phase 11) مانده‌ی امروز — مشتق‌شده از تخصیص‌ها، نه فیلد ذخیره‌شده‌ی سند.
        // (Phase 19) به واحد رسمی: گرم ۷۵۰.
        { header: 'مانده', numeric: true, cell: (d) => formatBaseGrams(d.outstandingGrams) },
        {
          header: 'وضعیت',
          cell: (d) =>
            Badge({
              label: DOC_STATUS_LABELS[d.derivedStatus || d.status] || d.status,
              variant: DOC_STATUS_VARIANT[d.derivedStatus || d.status] || 'neutral',
            }),
        },
      ],
      rows: summary.documents,
      emptyTitle: cfg.docsEmptyTitle,
      emptyDesc: cfg.docsEmptyDesc,
    })
  );
  return wrap;
}

/**
 * تب اسناد تسویه.
 * (Phase 11) دو ستون جدید: چقدر از این سند به فاکتور تخصیص یافته و چقدرش علی‌الحساب
 * مانده. اسنادی که با `source='settlement'` ثبت شده‌اند از همین‌جا قابل «ویرایش تخصیص»
 * و «ابطال»اند؛ اسنادی که همراه خودِ فاکتور ثبت شده‌اند نه — آن‌ها با لغو فاکتور
 * برمی‌گردند (وگرنه یک فاکتورِ باز با پرداختِ باطل‌شده باقی می‌ماند).
 */
function renderPaymentsTab(summary, cfg, ctx) {
  const wrap = document.createElement('div');
  wrap.appendChild(
    Table({
      columns: [
        { header: 'شماره', cell: (r) => r.number || '—' },
        { header: 'تاریخ', cell: (r) => displayDate(r.date) },
        { header: 'روش', cell: (r) => PAY_METHOD_LABELS[r.method] || r.method || '—' },
        // (Phase 22) جهت سند: «ورود» (از طرف حساب به ما) یا «خروج» (از ما به او).
        {
          header: 'جهت',
          cell: (r) =>
            r.reverse
              ? Badge({ label: r.direction === 'in' ? 'ورود (معکوس)' : 'خروج (معکوس)', variant: 'neutral' })
              : r.direction === 'in' ? 'ورود' : 'خروج',
        },
        {
          header: 'مبلغ / وزن',
          numeric: true,
          cell: (r) => {
            if (r.method !== 'gold') return formatRial(r.amountIRR);
            // Phase 23: عیار واقعی، آزمایشگاه و معادل ۷۵۰ (همان عددی که به حساب نشسته).
            const box = document.createElement('div');
            box.textContent = formatGrams(r.weightGrams);
            const hint = document.createElement('div');
            hint.className = 'field__hint';
            hint.textContent =
              `${GOLD_TYPE_LABELS[r.goldType] || ''} عیار ${finenessOf(r, r.karat)}` +
              (r.labName ? ` • ${r.labName}` : '') +
              ` • ${formatBaseGrams(r.valueGrams)}`;
            box.appendChild(hint);
            return box;
          },
        },
        { header: 'تخصیص‌یافته', numeric: true, cell: (r) => formatBaseGrams(r.allocatedGrams) },
        {
          header: 'علی‌الحساب',
          numeric: true,
          cell: (r) =>
            !r.reverse && r.unallocatedGrams > GRAM_EPS_750
              ? Badge({ label: formatBaseGrams(r.unallocatedGrams), variant: 'warning' })
              : '—',
        },
        {
          header: '',
          cell: (r) => {
            const box = document.createElement('div');
            box.className = 'row-actions';
            if (r.source !== 'settlement') {
              // برگه‌ی این خط جداگانه چاپ نمی‌شود: این دریافت/پرداخت جزئی از خودِ
              // فاکتور است و روی برگه‌ی همان فاکتور دیده می‌شود. برگه‌ی مستقل برایش
              // یعنی یک بار دیگر شمردن همان مبلغ در مانده‌ی طرف حساب.
              const note = document.createElement('span');
              note.className = 'field__hint';
              note.textContent = 'همراه فاکتور';
              box.appendChild(note);
              return box;
            }
            box.appendChild(
              Button({
                label: 'برگه',
                variant: 'ghost',
                onClick: () => openDocSheet({ kind: 'settlement', id: r.id }),
              })
            );
            box.appendChild(
              Button({
                label: 'تخصیص',
                variant: 'ghost',
                onClick: async () => {
                  if (await openAllocationForm(r)) await ctx.reload(true);
                },
              })
            );
            box.appendChild(
              Button({
                label: 'ابطال',
                variant: 'ghost',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: `ابطال سند ${r.number}`,
                    message:
                      'اثر مالی این سند با یک سند معکوس خنثی می‌شود و تخصیص‌هایش باطل می‌گردد؛ ' +
                      'فاکتورهای مربوطه دوباره باز می‌شوند. سند اصلی حذف نمی‌شود.',
                    confirmLabel: 'بله، باطل شود',
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    const res = await runVoidWithShortageGuard((opts) => voidSettlement(r.id, opts));
                    if (!res.done) return;
                    showToast('سند تسویه باطل شد.', { variant: 'success' });
                    await ctx.reload(true);
                  } catch (err) {
                    showToast(err?.message || 'ابطال ناموفق بود.', { variant: 'danger' });
                  }
                },
              })
            );
            return box;
          },
        },
      ],
      rows: summary.payments,
      emptyTitle: cfg.paymentsEmptyTitle,
      emptyDesc: cfg.paymentsEmptyDesc,
    })
  );
  return wrap;
}

/**
 * تب «فاکتورهای باز» (مشتری) / «بدهی» (تأمین‌کننده).
 * کارت بالای تب همیشه مانده‌ی مشتق‌شده از Ledger است — نه جمع ستون‌های جدول.
 * جمع اسناد باز فقط «ترکیب» بدهی را نشان می‌دهد و ممکن است با مانده Ledger برابر نباشد
 * (مثلاً وقتی پرداختی ثبت شده که هنوز به فاکتور خاصی تخصیص نیافته). منبع حقیقت، Ledger است.
 */
function renderOpenTab(summary, cfg) {
  const wrap = document.createElement('div');

  const cards = document.createElement('div');
  cards.className = 'balance-cards';
  cards.appendChild(
    balanceCard({
      title: cfg.openBalanceCardTitle,
      described: describeBaseBalance(summary.balanceGrams, cfg.kind),
      note: 'مانده واقعی از دفتر (گرم ۷۵۰) — منبع حقیقت.',
    })
  );
  cards.appendChild(
    balanceCard({
      title: 'جمع اسناد باز',
      described: describeBaseBalance(summary.openDocumentsTotalGrams, cfg.kind),
      note: 'ترکیب اسناد تسویه‌نشده — فقط نمایشی.',
    })
  );
  // (Phase 11) اختلاف دو کارت بالا دقیقاً همین عدد است: پولی که جابه‌جا شده ولی هنوز
  // بابت فاکتوری حساب نشده. نمایش صریح آن، تنها راهِ توضیح‌دادنِ آن اختلاف به کاربر است.
  cards.appendChild(
    balanceCard({
      title: cfg.unallocatedCardTitle || 'علی‌الحساب',
      described: describeBaseBalance(-Math.abs(summary.unallocatedGrams || 0), cfg.kind),
      note: cfg.unallocatedNote || 'تسویه‌شده ولی بدون فاکتور مشخص.',
    })
  );
  wrap.appendChild(cards);

  wrap.appendChild(
    Table({
      columns: [
        { header: 'شماره', cell: (d) => d.number || '—' },
        { header: 'تاریخ', cell: (d) => displayDate(d.date) },
        { header: 'جمع سند', numeric: true, cell: (d) => formatBaseGrams(d.totalGrams) },
        { header: 'تسویه‌شده', numeric: true, cell: (d) => formatBaseGrams(d.allocatedGrams) },
        { header: 'مانده', numeric: true, cell: (d) => formatBaseGrams(d.outstandingGrams) },
      ],
      rows: summary.openDocuments,
      emptyTitle: cfg.openEmptyTitle,
      emptyDesc: cfg.openEmptyDesc,
    })
  );
  return wrap;
}

function renderDueDatesTab(summary, ctx = {}) {
  const wrap = document.createElement('div');
  const items = summary.dueItems || [];
  if (!items.length) {
    wrap.appendChild(
      EmptyState({
        icon: '📋',
        title: 'سررسیدی ثبت نشده',
        description: 'سررسید فاکتورهای رسیدی این طرف حساب اینجا مدیریت می‌شود.',
      })
    );
    return wrap;
  }
  // (Phase 12) کارت لمسی: وضعیت زمانی مشتق‌شده + ورود مستقیم به سند مبدأ.
  const list = document.createElement('div');
  list.className = 'entity-list';
  for (const item of items) {
    list.appendChild(DueItemCard(item, { showParty: false, onChanged: () => ctx.reload && ctx.reload(true) }));
  }
  wrap.appendChild(list);
  wrap.appendChild(
    infoNote(
      'وضعیت هر سررسید (آینده، نزدیک، امروز، گذشته، تسویه‌شده) در لحظه از مانده‌ی فاکتور و تاریخ امروز محاسبه می‌شود. برای دیدن سند، روی آن بزنید.'
    )
  );
  return wrap;
}

// ────────────────────────────── مودال جزئیات ──────────────────────────────

/** کلید تب‌های جزئیات شخص ⇒ جایگاه در نوار تب (همان ترتیب Tabs پایین). */
export const PARTY_TAB_INDEX = { info: 0, statement: 1 };

/**
 * صفحه جزئیات طرف حساب را (به‌صورت Sheet تمام‌قد، الگوی iPhone) باز می‌کند.
 * @param {object} opts
 * @param {object} opts.service سرویس ساخته‌شده با createPartyService
 * @param {object} opts.labels  واژگان دامنه (رجوع به pages/Customers.js و pages/Suppliers.js)
 * @param {string} opts.id      شناسه طرف حساب
 * @param {string} [opts.initialTab] تب آغازین (`info` | `statement`)
 * @returns {Promise<boolean>} true اگر رکورد ویرایش/حذف‌نرم/بازیابی شد.
 */
export function openPartyDetail({ service, labels, id, initialTab = 'info' }) {
  return new Promise((resolve) => {
    const cfg = labels;
    const body = document.createElement('div');
    body.appendChild(LoadingState({ label: '' }));

    let settled = false;
    let changed = false;

    const { close, modalEl } = openModal({
      title: cfg.detailTitle,
      content: body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(changed);
        }
      },
    });
    modalEl.classList.add('modal--full');

    function finish(didChange) {
      settled = true;
      close();
      resolve(didChange);
    }

    /** بازخوانی کامل صفحه پس از یک تغییر مالی، بدون بستن مودال. */
    async function reloadAfterChange(didChange) {
      if (didChange) changed = true;
      await load();
    }

    async function load() {
      let summary;
      try {
        summary = await service.getSummary(id);
      } catch (err) {
        console.error('[PartyDetail] load', err);
        body.innerHTML = '';
        body.appendChild(EmptyState({ icon: '⚠️', title: `خطا در بارگذاری اطلاعات ${cfg.entity}` }));
        return;
      }

      const p = summary.party;
      body.innerHTML = '';

      // سربرگ: نام، کد، وضعیت، مانده خلاصه
      const head = document.createElement('div');
      head.className = 'entity-head';
      const nameEl = document.createElement('div');
      nameEl.className = 'entity-head__name';
      nameEl.textContent = p.name;
      const badges = document.createElement('div');
      badges.className = 'entity-head__badges';
      badges.appendChild(Badge({ label: p.code, variant: 'neutral' }));
      const status = partyStatusBadge(p);
      badges.appendChild(Badge({ label: status.label, variant: status.variant }));
      const bal = describeBalance(summary.balance, cfg.kind);
      badges.appendChild(Badge({ label: `${bal.text}: ${bal.amount}`, variant: bal.variant }));
      head.append(nameEl, badges);
      body.appendChild(head);

      const tabs = Tabs({
        // (Phase 26) معین صفحه‌ی اصلی مستقیم تب «گردش حساب» را باز می‌کند.
        initial: PARTY_TAB_INDEX[initialTab] ?? 0,
        tabs: [
          { label: 'اطلاعات', render: () => renderInfoTab(summary, cfg, () => service.getHistory(id)) },
          { label: 'گردش حساب', badge: summary.statement.length, render: () => renderStatementTab(summary, cfg) },
          { label: cfg.docsTabLabel, badge: summary.documents.length, render: () => renderDocsTab(summary, cfg) },
          {
            label: cfg.paymentsTabLabel,
            badge: summary.payments.length,
            render: () => renderPaymentsTab(summary, cfg, { reload: reloadAfterChange }),
          },
          {
            label: cfg.openTabLabel,
            badge: summary.openDocuments.length,
            render: () => renderOpenTab(summary, cfg),
          },
          {
            label: 'سررسیدها',
            badge: summary.allDueDates.length,
            render: () => renderDueDatesTab(summary, { reload: reloadAfterChange }),
          },
        ],
      });
      body.appendChild(tabs);

      // اقدامات
      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      actions.style.flexWrap = 'wrap';

      // (Phase 11) ثبت تسویه‌ی مستقل — دریافت از مشتری / پرداخت به تأمین‌کننده.
      const settleBtn = Button({
        label: cfg.settleAction || 'ثبت تسویه',
        variant: 'primary',
        onClick: async () => {
          const saved = await openSettlementForm(cfg.kind, id);
          if (saved) await reloadAfterChange(true);
        },
      });

      // (Phase 22) جهت معکوس: پرداخت به مشتری / دریافت از تأمین‌کننده — مسیری که تا
      // Phase 21 وجود نداشت (دریافت طلا از تأمین‌کننده موجودی را کم می‌کرد).
      const reverseBtn = Button({
        label: cfg.reverseSettleAction || 'تسویه‌ی معکوس',
        variant: 'secondary',
        onClick: async () => {
          const saved = await openSettlementForm(cfg.kind, id, { reverse: true });
          if (saved) await reloadAfterChange(true);
        },
      });

      const editBtn = Button({
        label: 'ویرایش',
        variant: 'secondary',
        onClick: async () => {
          const saved = await openPartyForm({ service, labels: cfg, party: p });
          if (saved) {
            changed = true;
            await load(); // بارگذاری مجدد با داده‌های تازه، بدون بستن صفحه
          }
        },
      });

      let deleteRestoreBtn;
      if (p.deletedAt) {
        deleteRestoreBtn = Button({
          label: `بازیابی ${cfg.entity}`,
          variant: 'primary',
          onClick: async () => {
            const ok = await confirmDialog({
              title: `بازیابی ${cfg.entity}`,
              message: `آیا از بازیابی «${p.name}» مطمئن هستید؟`,
              confirmLabel: 'بازیابی',
            });
            if (!ok) return;
            try {
              await service.restore(p.id);
              showToast(`${cfg.entity} بازیابی شد.`, { variant: 'success' });
              finish(true);
            } catch (err) {
              console.error('[PartyDetail] restore', err);
              showToast('بازیابی ناموفق بود.', { variant: 'danger' });
            }
          },
        });
      } else {
        deleteRestoreBtn = Button({
          label: 'حذف (نرم)',
          variant: 'danger',
          onClick: async () => {
            const guard = await service.checkDeletable(p.id);
            if (!guard.deletable) {
              await confirmDialog({
                title: 'حذف امکان‌پذیر نیست',
                message: `${guard.reasons.join(' ')} ابتدا حساب این ${cfg.entity} را تسویه کنید.`,
                confirmLabel: 'متوجه شدم',
                cancelLabel: 'بستن',
              });
              return;
            }
            const ok = await confirmDialog({
              title: `حذف ${cfg.entity}`,
              message: `«${p.name}» غیرفعال و به‌صورت نرم حذف می‌شود (قابل بازیابی است). ادامه می‌دهید؟`,
              confirmLabel: 'حذف',
              danger: true,
            });
            if (!ok) return;
            try {
              await service.softDelete(p.id);
              showToast(`${cfg.entity} حذف (نرم) شد.`, { variant: 'success' });
              finish(true);
            } catch (err) {
              if (err instanceof PartyDeleteBlockedError) {
                showToast(err.reasons.join(' '), { variant: 'danger' });
              } else {
                console.error('[PartyDetail] soft delete', err);
                showToast('حذف ناموفق بود.', { variant: 'danger' });
              }
            }
          },
        });
      }

      actions.append(settleBtn, reverseBtn, editBtn, deleteRestoreBtn);
      body.appendChild(actions);
    }

    load();
  });
}
