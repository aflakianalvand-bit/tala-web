// AccountForm.js — مودال افزودن/ویرایش حساب (Phase 9)
// این فرم فقط **هویت** حساب را می‌سازد؛ هیچ مبلغی اینجا وارد نمی‌شود.
// موجودی اولیه با یک سند «واریز» با دسته‌ی «مانده ابتدای دوره» ثبت می‌شود تا
// مثل هر عدد دیگری در برنامه، از دفتر مشتق شود و ردپای سند داشته باشد
// (دستور پروژه §20 — هیچ مانده‌ای مستقیم نوشته نمی‌شود).
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Switch } from '../../components/Switch.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { createAccount, updateAccount, AccountValidationError } from '../../services/accounts.js';
import { ACCOUNT_TYPE_OPTIONS } from './accountLabels.js';

/**
 * @param {object|null} account رکورد موجود برای ویرایش (خالی = افزودن)
 * @returns {Promise<boolean>} true اگر ذخیره موفق بود.
 */
export function openAccountForm({ account = null } = {}) {
  return new Promise((resolve) => {
    const isEdit = !!account;
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;

    const errorBox = document.createElement('div');

    const nameField = Input({
      label: 'نام حساب',
      value: account?.name || '',
      required: true,
      hint: 'مثال: صندوق فروشگاه، بانک ملت ۱۲۳۴، کارتخوان سیار',
    });

    const typeField = Select({
      label: 'نوع حساب',
      value: account?.type || 'cashbox',
      options: ACCOUNT_TYPE_OPTIONS,
      required: true,
      hint: 'نوع فقط برای دسته‌بندی و نمایش است و در هیچ محاسبه‌ای اثر ندارد.',
    });

    const notesField = Textarea({ label: 'توضیحات', value: account?.notes || '', rows: 3 });

    const activeField = Switch({
      label: 'حساب فعال است',
      checked: account ? account.active !== false : true,
      hint: 'حساب غیرفعال در فرم‌های خرید، فروش و انتقال نمایش داده نمی‌شود، اما گردش گذشته‌اش باقی می‌ماند.',
    });

    form.append(nameField, typeField, notesField, activeField, errorBox);

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
      label: isEdit ? 'ذخیره تغییرات' : 'افزودن حساب',
      variant: 'primary',
      type: 'submit',
    });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close } = openModal({
      title: isEdit ? 'ویرایش حساب' : 'حساب جدید',
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    const FIELD_WRAPS = { name: nameField, type: typeField, notes: notesField, active: activeField };

    function clearFieldErrors() {
      form.querySelectorAll('.field--invalid').forEach((el) => el.classList.remove('field--invalid'));
      form.querySelectorAll('.field__error').forEach((el) => el.remove());
      errorBox.innerHTML = '';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors();

      const input = {
        name: nameField.getInput().value,
        type: typeField.getSelect().value,
        notes: notesField.getTextarea().value,
        active: activeField.isChecked(),
      };

      saveBtn.disabled = true;
      try {
        if (isEdit) {
          await updateAccount(account.id, input);
          showToast('حساب با موفقیت ویرایش شد.', { variant: 'success' });
        } else {
          await createAccount(input);
          showToast('حساب جدید افزوده شد.', { variant: 'success' });
        }
        settled = true;
        close();
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;
        if (err instanceof AccountValidationError) {
          for (const [field, message] of Object.entries(err.fieldErrors)) {
            const wrap = FIELD_WRAPS[field];
            if (!wrap) continue;
            wrap.classList.add('field--invalid');
            const errEl = document.createElement('div');
            errEl.className = 'field__error';
            errEl.textContent = message;
            wrap.appendChild(errEl);
          }
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
        } else {
          console.error('[AccountForm]', err);
          errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ذخیره ناموفق بود.' }));
        }
      }
    });
  });
}
