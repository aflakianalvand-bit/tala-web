// ProductForm.js — مودال افزودن/ویرایش کالا
import { KaratInput } from '../../components/KaratInput.js';
import { DEFAULT_FINENESS } from '../../services/units.js';
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Switch } from '../../components/Switch.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { createProduct, updateProduct, ProductValidationError } from '../../services/products.js';
import { TYPE_OPTIONS, WAGE_TYPE_OPTIONS, UNIT_OPTIONS } from './productLabels.js';

/**
 * مودال افزودن/ویرایش کالا را باز می‌کند.
 * @param {{product?: object|null}} opts - در صورت وجود product، فرم در حالت ویرایش باز می‌شود.
 * @returns {Promise<boolean>} true اگر ذخیره موفق بود، false اگر انصراف داده شد.
 */
export function openProductForm({ product = null } = {}) {
  return new Promise((resolve) => {
    const isEdit = !!product;
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;

    const errorBox = document.createElement('div');

    const nameField = Input({ label: 'نام کالا', value: product?.name || '', required: true });

    const typeField = Select({
      label: 'نوع طلا',
      options: TYPE_OPTIONS,
      value: product?.type || 'manufactured',
      required: true,
    });

    const codeField = Input({
      label: 'کد کالا',
      value: isEdit ? product.code : 'پس از ذخیره به‌صورت خودکار تعیین می‌شود',
      hint: 'کد کالا همیشه خودکار است و قابل ویرایش نیست.',
    });
    codeField.getInput().disabled = true;

    // Phase 22: عیار هزاری (پیش‌فرض ۷۵۰) با میان‌بر عیارهای رایج.
    const karatField = KaratInput({
      value: String(product?.karat ?? DEFAULT_FINENESS),
    });

    const weightField = Input({
      label: 'وزن (گرم)',
      value: product?.weightGrams != null ? String(product.weightGrams) : '',
      numeric: true,
      inputmode: 'decimal',
      required: true,
      hint: 'برای ساخته‌شده: وزن دقیق قلم. برای آبشده/متفرقه: وزن معرف — وزن واقعی هر معامله در سند خرید/فروش وارد می‌شود.',
    });

    const unitField = Select({
      label: 'واحد',
      options: UNIT_OPTIONS,
      value: product?.unit || 'gram',
    });

    const wageTypeField = Select({
      label: 'نوع اجرت',
      options: WAGE_TYPE_OPTIONS,
      value: product?.wageType || 'percent',
    });
    const wageValueField = Input({
      label: 'اجرت',
      value: String(product?.wageValue ?? 0),
      numeric: true,
      inputmode: 'decimal',
      hint: 'بر اساس نوع اجرت: درصد یا مبلغ ریال به ازای هر گرم.',
    });
    const profitField = Input({
      label: 'سود (٪)',
      value: String(product?.profitPercent ?? 0),
      numeric: true,
      inputmode: 'decimal',
    });
    const taxField = Input({
      label: 'مالیات (٪)',
      value: String(product?.taxPercent ?? 0),
      numeric: true,
      inputmode: 'decimal',
    });

    const manufacturedGroup = document.createElement('div');
    manufacturedGroup.append(wageTypeField, wageValueField, profitField, taxField);

    const priceTodayField = Input({
      label: 'قیمت روز (پیش‌فرض این کالا)',
      value: product?.priceToday != null ? String(product.priceToday) : '',
      numeric: true,
      inputmode: 'decimal',
      hint: 'این مقدار فقط پیش‌فرض/مرجع است؛ قیمت واقعی هر معامله جداگانه محاسبه و Snapshot می‌شود (تغییر این مقدار روی اسناد قبلی اثر ندارد).',
    });

    const descField = Textarea({ label: 'توضیحات', value: product?.description || '', rows: 3 });

    const activeField = Switch({ label: 'کالا فعال است', checked: product ? !!product.active : true });

    function syncManufacturedVisibility() {
      const isManufactured = typeField.getSelect().value === 'manufactured';
      manufacturedGroup.hidden = !isManufactured;
    }
    typeField.getSelect().addEventListener('change', syncManufacturedVisibility);
    syncManufacturedVisibility();

    form.append(
      nameField,
      typeField,
      codeField,
      karatField,
      weightField,
      unitField,
      manufacturedGroup,
      priceTodayField,
      descField,
      activeField,
      errorBox
    );

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
    const saveBtn = Button({
      label: isEdit ? 'ذخیره تغییرات' : 'افزودن کالا',
      variant: 'primary',
      type: 'submit',
    });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close } = openModal({
      title: isEdit ? 'ویرایش کالا' : 'افزودن کالا',
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    function clearFieldErrors() {
      form.querySelectorAll('.field--invalid').forEach((el) => el.classList.remove('field--invalid'));
      form.querySelectorAll('.field__error').forEach((el) => el.remove());
      errorBox.innerHTML = '';
    }

    function showFieldError(fieldWrap, message) {
      fieldWrap.classList.add('field--invalid');
      const err = document.createElement('div');
      err.className = 'field__error';
      err.textContent = message;
      fieldWrap.appendChild(err);
    }

    const FIELD_WRAPS = {
      name: nameField,
      type: typeField,
      karat: karatField,
      weightGrams: weightField,
      unit: unitField,
      wageType: wageTypeField,
      wageValue: wageValueField,
      profitPercent: profitField,
      taxPercent: taxField,
      priceToday: priceTodayField,
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors();

      const input = {
        name: nameField.getInput().value,
        type: typeField.getSelect().value,
        karat: Number(karatField.getValue()),
        weightGrams: Number(weightField.getValue()),
        unit: unitField.getSelect().value,
        wageType: wageTypeField.getSelect().value,
        wageValue: Number(wageValueField.getValue()),
        profitPercent: Number(profitField.getValue()),
        taxPercent: Number(taxField.getValue()),
        priceToday: priceTodayField.getValue(),
        description: descField.getTextarea().value,
        active: activeField.isChecked(),
      };

      saveBtn.disabled = true;
      try {
        if (isEdit) {
          await updateProduct(product.id, input);
          showToast('کالا با موفقیت ویرایش شد.', { variant: 'success' });
        } else {
          await createProduct(input);
          showToast('کالا با موفقیت افزوده شد.', { variant: 'success' });
        }
        settled = true;
        close();
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;
        if (err instanceof ProductValidationError) {
          for (const [field, message] of Object.entries(err.fieldErrors)) {
            const wrap = FIELD_WRAPS[field];
            if (wrap) showFieldError(wrap, message);
          }
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
        } else {
          console.error('[ProductForm]', err);
          errorBox.appendChild(
            Alert({ variant: 'danger', message: err?.message || 'ذخیره کالا ناموفق بود.' })
          );
        }
      }
    });
  });
}
