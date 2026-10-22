// SaleReturnForm.js — فرم ثبت سند برگشت از فروش (Phase 7)
//
// برگشت **جزئی و کامل، قلم‌به‌قلم** است (تصمیم کاربر در Phase 7): کاربر برای هر قلم
// وزن برگشتی را وارد می‌کند و فرم مبلغ متناظر را — به همان نرخ و شرایط فاکتور اصلی،
// نه قیمت روز — نمایش می‌دهد. یک فاکتور می‌تواند چند سند برگشت داشته باشد.
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { createSaleReturn, returnableLines, SaleValidationError } from '../../services/sales.js';
import { summaryItem } from '../docs/docFormParts.js';
import { formatRial, formatGrams } from '../../utils/format.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import { GOLD_TYPE_LABELS, displayDateLong } from './saleLabels.js';

/**
 * فرم برگشت را برای یک فاکتور باز می‌کند.
 * @returns {Promise<object|null>} سند برگشت ثبت‌شده یا null
 */
export async function openSaleReturnForm(sale) {
  const lines = returnableLines(sale).filter((l) => l.remainingWeightGrams > 0.0005);

  return new Promise((resolve) => {
    const body = document.createElement('div');
    let settled = false;

    const { close } = openModal({
      title: `برگشت از فاکتور ${sale.number}`,
      content: body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });

    if (!lines.length) {
      body.appendChild(
        Alert({ variant: 'info', message: 'تمام اقلام این فاکتور قبلاً برگشت خورده‌اند.' })
      );
      return;
    }

    const state = {
      date: toDateInputValue(),
      description: '',
      weights: lines.map(() => ''),
    };
    let fieldErrors = {};
    let lineErrors = {};

    const form = document.createElement('form');
    form.className = 'purchase-form';
    body.appendChild(form);

    const totalsBar = document.createElement('div');
    totalsBar.className = 'summary-bar purchase-totals';

    function computePreview() {
      let weight = 0;
      let amount = 0;
      lines.forEach((line, i) => {
        const w = Number(state.weights[i]) || 0;
        if (w <= 0) return;
        const capped = Math.min(w, line.remainingWeightGrams);
        weight += capped;
        // پیش‌نمایش تقریبی است؛ مبلغ قطعی را سرویس محاسبه می‌کند (برای برگشت کاملِ
        // باقیمانده، سرویس دقیقاً مانده‌ی مبلغ قلم را می‌گذارد تا خطای گِردکردن انباشته نشود).
        amount += capped * line.valuePerGram;
      });
      return { weight, amount };
    }

    function updateTotals() {
      const { weight, amount } = computePreview();
      totalsBar.innerHTML = '';
      totalsBar.append(
        summaryItem('وزن برگشتی', formatGrams(weight)),
        summaryItem('مبلغ برگشتی (تقریبی)', formatRial(amount), amount > 0 ? 'danger' : '')
      );
    }

    function render() {
      form.innerHTML = '';

      form.appendChild(
        Alert({
          variant: 'info',
          message:
            'برگشت با همان نرخ و شرایط فاکتور اصلی محاسبه می‌شود (نه قیمت روز): طلا به موجودی برمی‌گردد و طلب ما از مشتری کم می‌شود.',
        })
      );

      form.appendChild(
        Input({
          label: 'تاریخ برگشت',
          type: 'date',
          required: true,
          value: state.date,
          hint: displayDateLong(fromDateInputValue(state.date)),
          error: fieldErrors.date || '',
          onInput: (v) => {
            state.date = v;
            render();
          },
        })
      );

      if (fieldErrors.lines) form.appendChild(Alert({ variant: 'danger', message: fieldErrors.lines }));

      lines.forEach((line, i) => {
        const card = document.createElement('div');
        card.className = 'doc-line';

        const head = document.createElement('div');
        head.className = 'doc-line__head';
        const title = document.createElement('span');
        title.className = 'doc-line__title';
        title.textContent = `${GOLD_TYPE_LABELS[line.goldType] || line.goldType} • عیار ${line.karat}`;
        const remaining = document.createElement('span');
        remaining.className = 'doc-line__title num';
        remaining.textContent = `قابل برگشت: ${formatGrams(line.remainingWeightGrams)}`;
        head.append(title, remaining);
        card.appendChild(head);

        card.appendChild(
          Input({
            label: 'وزن برگشتی (گرم)',
            numeric: true,
            value: state.weights[i],
            hint: `ارزش هر گرم در این فاکتور: ${formatRial(line.valuePerGram)}`,
            error: lineErrors[i]?.weightGrams || '',
            onInput: (v) => {
              state.weights[i] = v;
              updateTotals();
            },
          })
        );

        const fillBtn = Button({
          label: 'برگشت کامل این قلم',
          variant: 'ghost',
          onClick: () => {
            state.weights[i] = String(line.remainingWeightGrams);
            render();
          },
        });
        card.appendChild(fillBtn);

        form.appendChild(card);
      });

      form.appendChild(
        Textarea({
          label: 'توضیحات',
          value: state.description,
          rows: 2,
          onInput: (v) => {
            state.description = v;
          },
        })
      );

      form.appendChild(totalsBar);

      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      actions.append(
        Button({ label: 'انصراف', variant: 'secondary', onClick: () => close() }),
        Button({ label: 'ثبت برگشت', variant: 'primary', type: 'submit' })
      );
      form.appendChild(actions);

      updateTotals();
    }

    // Phase 17: گاردِ ثبت دوباره. روی صفحه‌ی لمسی، دو ضربه‌ی پشت‌سرهم روی «ثبت»
    // دو بار این فرم را ارسال می‌کرد؛ اگر ضربه‌ی دوم پس از تکمیل اولی می‌رسید،
    // یک سند **تکراری** با شماره‌ی جدید ساخته می‌شد و طلا دو بار از انبار خارج می‌شد.
    let inFlight = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (inFlight) return;
      inFlight = true;
      try {
      const payload = {
        date: fromDateInputValue(state.date),
        description: state.description,
        lines: lines
          .map((line, i) => ({ index: line.index, weightGrams: Number(state.weights[i]) || 0 }))
          .filter((l) => l.weightGrams > 0),
      };

      try {
        const result = await createSaleReturn(sale.id, payload);
        settled = true;
        close();
        showToast(`سند برگشت ${result.saleReturn.number} ثبت شد.`, { variant: 'success' });
        resolve(result.saleReturn);
      } catch (err) {
        if (err instanceof SaleValidationError) {
          fieldErrors = err.fieldErrors;
          lineErrors = err.lineErrors;
          render();
          showToast('لطفاً خطاهای مشخص‌شده را برطرف کنید.', { variant: 'danger' });
          return;
        }
        console.error('[SaleReturnForm] submit', err);
        showToast(err?.message || 'ثبت سند برگشت ناموفق بود.', { variant: 'danger' });
      }
      } finally {
        inFlight = false;
      }
    });

    render();
  });
}
