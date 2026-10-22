// AdjustmentForm.js — مودال «اصلاح موجودی» (Phase 10)
//
// این فرم تنها جایی در کل UI است که کاربر می‌تواند موجودی انبار را «دستی» تغییر دهد —
// و حتی اینجا هم عدد موجودی ویرایش نمی‌شود: کاربر یک **رویداد** ثبت می‌کند (کسری،
// اضافی، مانده ابتدای دوره، ورود/خروج مستقیم) و موجودی از همان رویداد مشتق می‌شود.
import { KaratInput } from '../../components/KaratInput.js';
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { listBuckets, bucketLabel } from '../../services/inventory.js';
import {
  createAdjustment,
  inventoryCategoriesFor,
  categoryByKey,
  InventoryValidationError,
  InventoryShortageError,
} from '../../services/inventoryDocs.js';
import { listProducts } from '../../services/products.js';
import { ratePerGramForKarat } from '../../services/pricing.js';
import { getPricingConfig } from '../../services/priceRates.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import { formatGrams, formatRial } from '../../utils/format.js';
import { displayDateLong, GOLD_TYPE_OPTIONS } from './inventoryLabels.js';


/**
 * @param {'in'|'out'} direction جهت اثر روی انبار
 * @param {object} opts `refId` سطل پیش‌انتخاب‌شده
 * @returns {Promise<boolean>} true اگر سندی ثبت شد.
 */
export function openAdjustmentForm(direction = 'in', { refId = null } = {}) {
  const copy =
    direction === 'in'
      ? { title: 'ورود / اضافی انبار', action: 'ثبت سند', success: 'سند اصلاح موجودی ثبت شد.' }
      : { title: 'خروج / کسری انبار', action: 'ثبت سند', success: 'سند اصلاح موجودی ثبت شد.' };

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
    const saveBtn = Button({ label: copy.action, variant: 'primary', type: 'submit' });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close } = openModal({
      title: copy.title,
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    let dateField;
    let categoryField;
    let bucketField;
    let goldTypeField;
    let karatField;
    let productField;
    let weightField;
    let rateField;
    let notesField;
    let config = null;

    (async () => {
      const [buckets, products, cfg] = await Promise.all([
        listBuckets({ includeEmpty: true }),
        listProducts({ status: 'active' }),
        getPricingConfig(),
      ]);
      config = cfg;
      body.innerHTML = '';

      dateField = Input({ label: 'تاریخ', type: 'date', value: toDateInputValue(new Date()) });
      const dateHint = document.createElement('div');
      dateHint.className = 'field__hint';
      const syncDateHint = () => {
        dateHint.textContent = displayDateLong(fromDateInputValue(dateField.getInput().value));
      };
      syncDateHint();
      dateField.appendChild(dateHint);
      dateField.getInput().addEventListener('input', syncDateHint);

      const categories = inventoryCategoriesFor(direction);
      categoryField = Select({
        label: 'دسته',
        required: true,
        options: categories.map((c) => ({ value: c.key, label: c.label })),
      });
      const categoryHint = document.createElement('div');
      categoryHint.className = 'field__hint';
      const syncCategoryHint = () => {
        const c = categoryByKey(categoryField.getSelect().value);
        categoryHint.textContent = c?.hint || '';
      };
      syncCategoryHint();
      categoryField.appendChild(categoryHint);
      categoryField.getSelect().addEventListener('change', syncCategoryHint);

      // انتخاب سطل: یا یکی از سطل‌های موجود، یا ساخت یک سطل جدید با نوع/عیار/کالا.
      const bucketOptions = [
        ...buckets.map((b) => ({ value: b.refId, label: `${b.label} — ${formatGrams(b.grams)}` })),
        { value: '__new__', label: '➕ سطل جدید (نوع و عیار دلخواه)' },
      ];
      bucketField = Select({
        label: 'سطل انبار',
        required: true,
        value: refId || (buckets.length ? buckets[0].refId : '__new__'),
        options: bucketOptions,
        hint: 'موجودی هر سطل مستقل است؛ عیارها با هم جمع نمی‌شوند.',
      });

      goldTypeField = Select({ label: 'نوع طلا', options: GOLD_TYPE_OPTIONS, value: 'melted' });
      // Phase 22: عیار هزاری دلخواه (پیش‌فرض ۷۵۰)، نه فهرست بسته‌ی ۱۷ تا ۲۴.
      karatField = KaratInput({ onInput: () => syncRateHint() });
      productField = Select({
        label: 'کالا (اختیاری)',
        options: [{ value: '', label: '— بدون کالای کددار —' }, ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))],
        hint: 'اگر کالای کددار انتخاب شود، سطل همان کالا استفاده می‌شود.',
      });

      weightField = Input({ label: 'وزن (گرم)', numeric: true, required: true, placeholder: '0' });
      const weightHint = document.createElement('div');
      weightHint.className = 'field__hint';
      weightHint.textContent = 'وزن ترازو با حداکثر سه رقم اعشار، عیناً ثبت می‌شود.';
      weightField.appendChild(weightHint);

      rateField = Input({ label: 'نرخ هر گرم (ریال)', numeric: true, placeholder: '0' });
      const rateHint = document.createElement('div');
      rateHint.className = 'field__hint num';
      rateField.appendChild(rateHint);

      notesField = Textarea({ label: 'توضیحات', rows: 2 });

      const newBucketWrap = document.createElement('div');
      newBucketWrap.append(goldTypeField, karatField, productField);

      function currentKarat() {
        const value = bucketField.getSelect().value;
        if (value === '__new__') return Number(karatField.getValue());
        const found = buckets.find((b) => b.refId === value);
        return found ? found.karat : 18;
      }

      function syncBucketMode() {
        const isNew = bucketField.getSelect().value === '__new__';
        newBucketWrap.style.display = isNew ? '' : 'none';
        syncRateHint();
      }

      function syncRateHint() {
        if (direction === 'out') {
          rateField.style.display = 'none';
          rateHint.textContent = '';
          return;
        }
        rateField.style.display = '';
        const suggested = ratePerGramForKarat(currentKarat(), config);
        rateHint.textContent = `خالی بگذارید تا نرخ روز همین عیار استفاده شود: ${formatRial(suggested)}`;
      }

      bucketField.getSelect().addEventListener('change', syncBucketMode);
      goldTypeField.getSelect().addEventListener('change', syncRateHint);
      productField.getSelect().addEventListener('change', () => {
        const productId = productField.getSelect().value;
        const product = products.find((p) => p.id === productId);
        if (product) {
          goldTypeField.getSelect().value = product.type;
          karatField.getInput().value = String(product.karat);
        }
        syncRateHint();
      });

      body.append(dateField, categoryField, bucketField, newBucketWrap, weightField, rateField, notesField);
      syncBucketMode();

      // یادآوری ثابت: این فرم موجودی را ویرایش نمی‌کند، یک سند می‌سازد.
      body.appendChild(
        Alert({
          variant: 'info',
          message:
            'موجودی انبار مستقیماً قابل ویرایش نیست. این فرم یک سند شماره‌دار و قابل ابطال ثبت می‌کند و ' +
            'موجودی از همان سند محاسبه می‌شود.',
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
      const selected = bucketField.getSelect().value;
      const input = {
        date: fromDateInputValue(dateField.getInput().value),
        categoryKey: categoryField.getSelect().value,
        weightGrams: Number(weightField.getValue()),
        ratePerGram: rateField.getValue() === '' ? null : Number(rateField.getValue()),
        description: notesField.getTextarea().value,
      };
      if (selected === '__new__') {
        input.bucket = {
          goldType: goldTypeField.getSelect().value,
          karat: Number(karatField.getValue()),
          productId: productField.getSelect().value || null,
        };
      } else {
        input.refId = selected;
      }
      return input;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!weightField) return;
      clearErrors();
      saveBtn.disabled = true;

      const run = async (options) => createAdjustment(buildInput(), options);

      try {
        await run({});
        settled = true;
        close();
        showToast(copy.success, { variant: 'success' });
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;

        // کمبود موجودی: هشدار + تأیید صریح (INVENTORY_RULES §۵) — بلاک نیست.
        if (err instanceof InventoryShortageError) {
          const s = err.shortages[0];
          const proceed = await confirmDialog({
            title: 'موجودی کافی نیست',
            message:
              `موجودی این سطل ${formatGrams(s.available)} است و این سند ${formatGrams(s.requested)} می‌خواهد؛ ` +
              `موجودی ${formatGrams(s.shortfall)} منفی می‌شود. اگر این رویداد واقعاً رخ داده و با تأخیر ثبت می‌کنید، ادامه دهید.`,
            confirmLabel: 'بله، ثبت شود',
            danger: true,
          });
          if (!proceed) return;
          saveBtn.disabled = true;
          try {
            await run({ allowNegative: true });
            settled = true;
            close();
            showToast(`${copy.success} (با موجودی منفی)`, { variant: 'warning' });
            resolve(true);
          } catch (retryErr) {
            saveBtn.disabled = false;
            console.error('[AdjustmentForm] retry', retryErr);
            errorBox.appendChild(Alert({ variant: 'danger', message: retryErr?.message || 'ثبت ناموفق بود.' }));
          }
          return;
        }

        if (err instanceof InventoryValidationError) {
          const WRAPS = {
            date: dateField,
            categoryKey: categoryField,
            bucket: bucketField,
            weightGrams: weightField,
            description: notesField,
          };
          for (const [field, message] of Object.entries(err.fieldErrors)) showFieldError(WRAPS[field], message);
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
          return;
        }

        console.error('[AdjustmentForm]', err);
        errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ثبت ناموفق بود.' }));
      }
    });
  });
}
