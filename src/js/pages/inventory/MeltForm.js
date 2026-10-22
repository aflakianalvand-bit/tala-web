// MeltForm.js — مودال «ذوب / تبدیل» (Phase 10)
//
// تصمیم Phase 10: ذوب یک **سند تبدیل دوطرفه** است — خروج از سطل مبدأ و ورود به سطل
// مقصد در یک تراکنش اتمیک، با تفاوت وزن به‌عنوان «افت ذوب» که هم در گرم و هم در ریال
// دیده می‌شود. (ثبت آن به‌صورت دو سند جدا، ارتباط‌شان را برای همیشه گم می‌کرد.)
import { KaratInput } from '../../components/KaratInput.js';
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { listBuckets } from '../../services/inventory.js';
import {
  createMelt,
  meltWeights,
  InventoryValidationError,
  InventoryShortageError,
} from '../../services/inventoryDocs.js';
import { listProducts } from '../../services/products.js';
import { getPricingConfig } from '../../services/priceRates.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import { formatGrams } from '../../utils/format.js';
import { displayDateLong, GOLD_TYPE_OPTIONS } from './inventoryLabels.js';


/**
 * @param {object} opts `fromRefId` سطل مبدأ پیش‌انتخاب‌شده
 * @returns {Promise<boolean>} true اگر سندی ثبت شد.
 */
export function openMeltForm({ fromRefId = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;
    const errorBox = document.createElement('div');
    const body = document.createElement('div');
    body.textContent = 'در حال بارگذاری…';
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
    const saveBtn = Button({ label: 'ثبت ذوب', variant: 'primary', type: 'submit' });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close } = openModal({
      title: 'ذوب / تبدیل طلا',
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    let dateField;
    let fromField;
    let weightField;
    let lossField;
    let outputField;
    let toTypeField;
    let toKaratField;
    let toProductField;
    let notesField;
    let config = null;
    let buckets = [];

    (async () => {
      const [rows, products, cfg] = await Promise.all([
        listBuckets({}),
        listProducts({ status: 'active' }),
        getPricingConfig(),
      ]);
      buckets = rows;
      config = cfg;
      body.innerHTML = '';

      if (!buckets.length) {
        body.appendChild(Alert({ variant: 'warning', message: 'انبار خالی است؛ چیزی برای ذوب وجود ندارد.' }));
        saveBtn.disabled = true;
        return;
      }

      dateField = Input({ label: 'تاریخ', type: 'date', value: toDateInputValue(new Date()) });
      const dateHint = document.createElement('div');
      dateHint.className = 'field__hint';
      const syncDateHint = () => {
        dateHint.textContent = displayDateLong(fromDateInputValue(dateField.getInput().value));
      };
      syncDateHint();
      dateField.appendChild(dateHint);
      dateField.getInput().addEventListener('input', syncDateHint);

      fromField = Select({
        label: 'از سطل (ورودی کوره)',
        required: true,
        value: fromRefId || buckets[0].refId,
        options: buckets.map((b) => ({ value: b.refId, label: `${b.label} — ${formatGrams(b.grams)}` })),
      });
      const fromHint = document.createElement('div');
      fromHint.className = 'field__hint num';
      const syncFromHint = () => {
        const found = buckets.find((b) => b.refId === fromField.getSelect().value);
        fromHint.textContent = found ? `موجودی فعلی: ${formatGrams(found.grams)}` : '';
      };
      syncFromHint();
      fromField.appendChild(fromHint);
      fromField.getSelect().addEventListener('change', syncFromHint);

      weightField = Input({ label: 'وزن ورودی کوره (گرم)', numeric: true, required: true, placeholder: '0' });
      lossField = Input({ label: 'درصد افت', numeric: true, placeholder: '0' });
      outputField = Input({
        label: 'وزن خروجی از کوره (گرم)',
        numeric: true,
        placeholder: 'خالی = محاسبه از درصد افت',
        hint: 'اگر وزن واقعی ترازو را بدانید همین را وارد کنید؛ بر درصد افت مقدم است.',
      });

      toTypeField = Select({ label: 'نوع طلای خروجی', options: GOLD_TYPE_OPTIONS, value: 'melted' });
      toKaratField = KaratInput({ label: 'عیار خروجی' });
      toProductField = Select({
        label: 'کالای خروجی (اختیاری)',
        options: [
          { value: '', label: '— بدون کالای کددار —' },
          ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
        ],
      });

      notesField = Textarea({ label: 'توضیحات', rows: 2 });

      const preview = document.createElement('div');
      preview.className = 'field__hint num';

      function syncPreview() {
        // فرمول در services/inventoryDocs.js (همان که createMelt ثبت می‌کند).
        const { inputWeight: input, outputWeight: output, lossGrams: loss } = meltWeights(
          { weightGrams: weightField.getValue(), lossPercent: lossField.getValue(), outputWeightGrams: outputField.getValue() },
          config
        );
        preview.textContent = input > 0
          ? `ورودی ${formatGrams(input)} ← خروجی ${formatGrams(output)} • افت ${formatGrams(loss)}`
          : '';
      }

      for (const field of [weightField, lossField, outputField]) {
        field.getInput().addEventListener('input', syncPreview);
      }

      toProductField.getSelect().addEventListener('change', () => {
        const product = products.find((p) => p.id === toProductField.getSelect().value);
        if (product) {
          toTypeField.getSelect().value = product.type;
          toKaratField.getInput().value = String(product.karat);
        }
      });

      body.append(
        dateField, fromField, weightField, lossField, outputField, preview,
        toTypeField, toKaratField, toProductField, notesField
      );
      syncPreview();

      body.appendChild(
        Alert({
          variant: 'info',
          message:
            'ذوب یک سند اتمیک است: طلا از سطل مبدأ خارج و به سطل مقصد وارد می‌شود. ' +
            'ارزش دفتری هم به نسبت وزن منتقل می‌شود و ارزش افت به حساب «افت ذوب» می‌رود.',
        })
      );
    })();

    function clearErrors() {
      form.querySelectorAll('.field--invalid').forEach((el) => el.classList.remove('field--invalid'));
      form.querySelectorAll('.field__error').forEach((el) => el.remove());
      errorBox.innerHTML = '';
    }

    function showFieldError(wrap, message) {
      if (!wrap) return;
      wrap.classList.add('field--invalid');
      const err = document.createElement('div');
      err.className = 'field__error';
      err.textContent = message;
      wrap.appendChild(err);
    }

    function buildInput() {
      return {
        date: fromDateInputValue(dateField.getInput().value),
        fromRefId: fromField.getSelect().value,
        to: {
          goldType: toTypeField.getSelect().value,
          karat: Number(toKaratField.getValue()),
          productId: toProductField.getSelect().value || null,
        },
        weightGrams: Number(weightField.getValue()),
        lossPercent: Number(lossField.getValue()) || 0,
        outputWeightGrams: outputField.getValue() === '' ? null : Number(outputField.getValue()),
        description: notesField.getTextarea().value,
      };
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!weightField) return;
      clearErrors();
      saveBtn.disabled = true;

      const run = async (options) => createMelt(buildInput(), options);

      try {
        await run({});
        settled = true;
        close();
        showToast('سند ذوب ثبت شد.', { variant: 'success' });
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;

        if (err instanceof InventoryShortageError) {
          const s = err.shortages[0];
          const proceed = await confirmDialog({
            title: 'موجودی کافی نیست',
            message:
              `موجودی سطل مبدأ ${formatGrams(s.available)} است و این ذوب ${formatGrams(s.requested)} می‌خواهد؛ ` +
              `موجودی ${formatGrams(s.shortfall)} منفی می‌شود.`,
            confirmLabel: 'بله، ثبت شود',
            danger: true,
          });
          if (!proceed) return;
          saveBtn.disabled = true;
          try {
            await run({ allowNegative: true });
            settled = true;
            close();
            showToast('سند ذوب ثبت شد (با موجودی منفی).', { variant: 'warning' });
            resolve(true);
          } catch (retryErr) {
            saveBtn.disabled = false;
            errorBox.appendChild(Alert({ variant: 'danger', message: retryErr?.message || 'ثبت ناموفق بود.' }));
          }
          return;
        }

        if (err instanceof InventoryValidationError) {
          const WRAPS = {
            date: dateField,
            from: fromField,
            to: toTypeField,
            weightGrams: weightField,
            lossPercent: lossField,
            outputWeightGrams: outputField,
            description: notesField,
          };
          for (const [field, message] of Object.entries(err.fieldErrors)) showFieldError(WRAPS[field], message);
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
          return;
        }

        console.error('[MeltForm]', err);
        errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ثبت ناموفق بود.' }));
      }
    });
  });
}
