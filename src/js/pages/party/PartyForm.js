// PartyForm.js — مودال افزودن/ویرایش طرف حساب (مشترک بین مشتری و تأمین‌کننده)
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Textarea } from '../../components/Textarea.js';
import { Switch } from '../../components/Switch.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { PartyValidationError } from '../../services/party.js';

/**
 * مودال افزودن/ویرایش یک طرف حساب.
 * @param {object} opts
 * @param {object} opts.service سرویس ساخته‌شده با createPartyService
 * @param {object} opts.labels  واژگان دامنه: { entity, addTitle, editTitle, addAction, saveAction, activeLabel, activeHint }
 * @param {object|null} opts.party رکورد موجود برای ویرایش (خالی = افزودن)
 * @returns {Promise<boolean>} true اگر ذخیره موفق بود.
 */
export function openPartyForm({ service, labels, party = null } = {}) {
  return new Promise((resolve) => {
    const isEdit = !!party;
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;

    const errorBox = document.createElement('div');

    const nameField = Input({ label: `نام ${labels.entity}`, value: party?.name || '', required: true });

    const codeField = Input({
      label: `کد ${labels.entity}`,
      value: isEdit ? party.code : 'پس از ذخیره به‌صورت خودکار تعیین می‌شود',
      hint: `کد ${labels.entity} همیشه خودکار است و قابل ویرایش نیست.`,
    });
    codeField.getInput().disabled = true;

    const phoneField = Input({
      label: 'موبایل',
      value: party?.phone || '',
      numeric: true,
      inputmode: 'tel',
      placeholder: '09121234567',
      hint: 'اختیاری. ۱۱ رقم با شروع ۰۹ (ارقام فارسی هم پذیرفته می‌شود).',
    });

    const notesField = Textarea({ label: 'توضیحات', value: party?.notes || '', rows: 3 });

    const activeField = Switch({
      label: labels.activeLabel,
      checked: party ? !!party.active : true,
      hint: labels.activeHint,
    });

    form.append(nameField, codeField, phoneField, notesField, activeField, errorBox);

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
      label: isEdit ? 'ذخیره تغییرات' : labels.addAction,
      variant: 'primary',
      type: 'submit',
    });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close } = openModal({
      title: isEdit ? labels.editTitle : labels.addTitle,
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
      phone: phoneField,
      notes: notesField,
      active: activeField,
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors();

      const input = {
        name: nameField.getInput().value,
        phone: phoneField.getInput().value,
        notes: notesField.getTextarea().value,
        active: activeField.isChecked(),
      };

      saveBtn.disabled = true;
      try {
        // هشدار (نه مسدودسازی) برای موبایل تکراری — BUSINESS_RULES §8.1
        if (input.phone) {
          const duplicates = await service.findByPhone(input.phone, {
            excludeId: isEdit ? party.id : null,
          });
          if (duplicates.length) {
            const proceed = await confirmDialog({
              title: 'موبایل تکراری',
              message: `این شماره موبایل قبلاً برای «${duplicates[0].name}» (${duplicates[0].code}) ثبت شده است. ادامه می‌دهید؟`,
              confirmLabel: 'بله، ادامه',
            });
            if (!proceed) {
              saveBtn.disabled = false;
              return;
            }
          }
        }

        if (isEdit) {
          await service.update(party.id, input);
          showToast(`${labels.entity} با موفقیت ویرایش شد.`, { variant: 'success' });
        } else {
          await service.create(input);
          showToast(`${labels.entity} با موفقیت افزوده شد.`, { variant: 'success' });
        }
        settled = true;
        close();
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;
        if (err instanceof PartyValidationError) {
          for (const [field, message] of Object.entries(err.fieldErrors)) {
            const wrap = FIELD_WRAPS[field];
            if (wrap) showFieldError(wrap, message);
          }
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
        } else {
          console.error('[PartyForm]', err);
          errorBox.appendChild(
            Alert({ variant: 'danger', message: err?.message || 'ذخیره ناموفق بود.' })
          );
        }
      }
    });
  });
}
