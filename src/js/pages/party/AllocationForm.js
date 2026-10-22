// AllocationForm.js — ویرایش تخصیص یک سند تسویه (Phase 11)
//
// چرا این صفحه وجود دارد (تصمیم ۴ Phase 11):
// اگر مبلغ درست ولی فاکتور اشتباه باشد، ابطال سند و ثبت دوباره‌ی آن یک Reversal
// کامل در دفاتر می‌سازد — رفت‌وبرگشتی که هیچ اتفاق مالی‌ای پشتش نیست و گردش صندوق
// را شلوغ می‌کند. تخصیص هیچ اثر دفتری ندارد (توضیح در services/allocations.js)، پس
// جابه‌جایی آن بین فاکتورهای همان طرف حساب امن است و فقط در auditLog ثبت می‌شود.
//
// محدودیت‌هایی که سرویس تضمین می‌کند و این فرم فقط نمایششان می‌دهد:
//   • جمع تخصیص‌ها نمی‌تواند از مبلغ سند بیشتر باشد (بقیه علی‌الحساب می‌ماند).
//   • تخصیص به هر فاکتور نمی‌تواند از مانده‌ی همان فاکتور بیشتر باشد.
//   • فاکتور باید متعلق به همان طرف حساب و باطل‌نشده باشد.
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { EmptyState } from '../../components/EmptyState.js';
import { showToast } from '../../components/Toast.js';
import { partyInvoices, allocationsForDoc, reallocate, roundIRR, AllocationError } from '../../services/allocations.js';
import { formatRial } from '../../utils/format.js';
import { displayDate } from '../docs/docLabels.js';
import { sectionTitle, summaryItem } from '../docs/docFormParts.js';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object} doc رکورد سند دریافت/پرداخت
 * @returns {Promise<boolean>} true اگر تخصیص تغییر کرد.
 */
export function openAllocationForm(doc) {
  return new Promise((resolve) => {
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;
    const body = document.createElement('div');
    body.textContent = 'در حال بارگذاری…';
    const errorBox = document.createElement('div');
    form.append(body, errorBox);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const cancelBtn = Button({
      label: 'انصراف',
      variant: 'secondary',
      onClick: () => {
        settled = true;
        close();
        resolve(false);
      },
    });
    const saveBtn = Button({ label: 'ذخیره تخصیص', variant: 'primary', type: 'submit' });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close, modalEl } = openModal({
      title: `ویرایش تخصیص سند ${doc.number || ''}`,
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    modalEl.classList.add('modal--full');

    const docValue = roundIRR(num(doc.valueIRR));
    /** targetId → مبلغ واردشده (رشته) */
    const values = new Map();
    let rows = [];
    let summaryHost;

    (async () => {
      const [invoiceRows, current] = await Promise.all([
        partyInvoices(doc.partyType, doc.partyId),
        allocationsForDoc(doc.id),
      ]);
      const currentByTarget = new Map(current.map((a) => [a.targetId, num(a.amountIRR)]));

      // فاکتورهایی که یا مانده دارند یا همین سند قبلاً به آن‌ها تخصیص یافته است.
      rows = invoiceRows
        .map((r) => {
          const own = currentByTarget.get(r.targetId) || 0;
          return { ...r, own, capacity: roundIRR(r.outstandingIRR + own) };
        })
        .filter((r) => r.capacity > 0.5 || r.own > 0.5);

      for (const r of rows) values.set(r.targetId, r.own ? String(r.own) : '');
      render();
    })();

    function totals() {
      let sum = 0;
      for (const r of rows) sum = roundIRR(sum + num(values.get(r.targetId)));
      return { sum, rest: roundIRR(docValue - sum) };
    }

    function renderSummary() {
      const t = totals();
      summaryHost.innerHTML = '';
      const bar = document.createElement('div');
      bar.className = 'summary-bar';
      bar.append(
        summaryItem('مبلغ سند', formatRial(docValue)),
        summaryItem('جمع تخصیص', formatRial(t.sum), t.rest < -0.5 ? 'danger' : 'primary'),
        summaryItem('علی‌الحساب', formatRial(Math.max(0, t.rest)), t.rest > 0.5 ? 'warning' : '')
      );
      summaryHost.appendChild(bar);
      if (t.rest < -0.5) {
        summaryHost.appendChild(
          Alert({ variant: 'danger', message: 'جمع تخصیص‌ها از مبلغ سند بیشتر است.' })
        );
      }
      saveBtn.disabled = t.rest < -0.5;
    }

    function render() {
      body.innerHTML = '';

      const info = document.createElement('div');
      info.className = 'field__hint';
      info.textContent =
        'جابه‌جایی تخصیص هیچ اثر مالی ندارد: مانده‌ی طرف حساب و موجودی صندوق تغییر نمی‌کند، ' +
        'فقط مشخص می‌شود این مبلغ بابت کدام فاکتورها بوده است.';
      body.appendChild(info);

      summaryHost = document.createElement('div');
      body.appendChild(summaryHost);

      body.appendChild(sectionTitle('تخصیص به فاکتورها'));

      if (!rows.length) {
        body.appendChild(
          EmptyState({
            icon: '🧾',
            title: 'فاکتور قابل تخصیصی وجود ندارد',
            description: 'این طرف حساب فاکتور باز ندارد؛ کل مبلغ این سند علی‌الحساب می‌ماند.',
          })
        );
        renderSummary();
        return;
      }

      const list = document.createElement('div');
      for (const r of rows) {
        const card = document.createElement('div');
        card.className = 'doc-line';

        const head = document.createElement('div');
        head.className = 'doc-line__head';
        const title = document.createElement('span');
        title.className = 'doc-line__title';
        title.textContent = `${r.number} — ${displayDate(r.date)}`;
        head.appendChild(title);
        head.appendChild(
          Button({
            label: 'حداکثر',
            variant: 'ghost',
            onClick: () => {
              const t = totals();
              const own = num(values.get(r.targetId));
              const room = roundIRR(Math.min(r.capacity, own + Math.max(0, t.rest)));
              values.set(r.targetId, String(room));
              render();
            },
          })
        );
        card.appendChild(head);

        const meta = document.createElement('div');
        meta.className = 'field__hint num';
        meta.textContent = `مبلغ فاکتور ${formatRial(r.grossIRR)} • حداکثر قابل تخصیص ${formatRial(r.capacity)}`;
        card.appendChild(meta);

        card.appendChild(
          Input({
            label: 'مبلغ تخصیص (ریال)',
            numeric: true,
            value: values.get(r.targetId) || '',
            onInput: (v) => {
              values.set(r.targetId, v);
              renderSummary();
            },
          })
        );

        list.appendChild(card);
      }
      body.appendChild(list);
      renderSummary();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.innerHTML = '';
      saveBtn.disabled = true;

      const entries = rows
        .map((r) => ({ targetId: r.targetId, amountIRR: num(values.get(r.targetId)) }))
        .filter((x) => x.amountIRR > 0.5);

      try {
        const result = await reallocate(doc.id, entries);
        settled = true;
        close();
        showToast(
          result.unallocatedIRR > 0.5
            ? `تخصیص ذخیره شد (${formatRial(result.unallocatedIRR)} علی‌الحساب).`
            : 'تخصیص ذخیره شد.',
          { variant: 'success' }
        );
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;
        if (err instanceof AllocationError) {
          const messages = Object.values(err.fieldErrors || {});
          errorBox.appendChild(
            Alert({ variant: 'danger', message: messages.length ? messages.join(' ') : err.message })
          );
          return;
        }
        console.error('[AllocationForm]', err);
        errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ذخیره ناموفق بود.' }));
      }
    });
  });
}
