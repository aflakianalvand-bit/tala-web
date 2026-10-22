// LabManager.js — بخش «آزمایشگاه‌ها» در صفحه‌ی تنظیمات — Phase 23
//
// افزودن، ویرایش نام و غیرفعال/فعال‌سازی (حذف وجود ندارد — BUSINESS_RULES §11.4).
// تمام قواعد در services/labs.js است؛ این فایل فقط نمایش و فراخوانی است.
import {
  listLabs,
  addLab,
  renameLab,
  setLabActive,
  LabValidationError,
  LAB_NAME_MAX,
} from '../../services/labs.js';
import { Input } from '../../components/Input.js';
import { Button } from '../../components/Button.js';
import { Badge } from '../../components/Badge.js';
import { openModal } from '../../components/Modal.js';
import { showToast } from '../../components/Toast.js';

function openRenameModal(lab) {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.noValidate = true;
    const field = Input({
      label: 'نام آزمایشگاه',
      value: lab.name,
      required: true,
      hint: 'اسنادی که قبلاً ثبت شده‌اند نام قدیمی را نگه می‌دارند.',
    });
    field.getInput().maxLength = LAB_NAME_MAX;
    const errorBox = document.createElement('div');
    errorBox.className = 'field__error';
    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    let done = false;
    const cancel = Button({
      label: 'انصراف',
      variant: 'secondary',
      onClick: () => {
        done = true;
        close();
        resolve(false);
      },
    });
    const save = Button({ label: 'ذخیره', variant: 'primary', type: 'submit' });
    actions.append(cancel, save);
    form.append(field, errorBox, actions);
    const { close } = openModal({
      title: 'ویرایش نام آزمایشگاه',
      content: form,
      onClose: () => {
        if (!done) resolve(false);
      },
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.textContent = '';
      try {
        await renameLab(lab.id, field.getInput().value);
        done = true;
        close();
        resolve(true);
      } catch (err) {
        errorBox.textContent = err instanceof LabValidationError ? err.message : 'ذخیره ناموفق بود.';
      }
    });
  });
}

/** کارت مدیریت فهرست آزمایشگاه‌ها. `sectionCard` از صفحه‌ی تنظیمات می‌آید تا ظاهر یکی بماند. */
export function LabManager(sectionCard) {
  const card = sectionCard(
    'آزمایشگاه‌ها',
    'فهرست پیشنهادی فیلد «آزمایشگاه» در خطوط طلای آبشده و متفرقه. نامی که در سند تایپ شود خودکار اضافه می‌شود؛ ' +
      'ویرایش نام روی اسناد قبلی اثر ندارد و به‌جای حذف، غیرفعال کنید.'
  );
  card.classList.add('lab-manager');

  const addField = Input({ label: 'آزمایشگاه جدید', placeholder: 'مثلاً آزمایشگاه مرکزی' });
  addField.getInput().maxLength = LAB_NAME_MAX;
  const addBtn = Button({ label: 'افزودن', variant: 'secondary', type: 'submit' });
  const list = document.createElement('div');
  list.className = 'lab-list';
  card.append(addField, addBtn, list);

  async function refresh() {
    const labs = await listLabs({ includeInactive: true });
    list.innerHTML = '';
    if (!labs.length) {
      const empty = document.createElement('div');
      empty.className = 'field__hint';
      empty.textContent = 'هنوز آزمایشگاهی ثبت نشده است.';
      list.appendChild(empty);
      return;
    }
    for (const lab of labs) {
      const row = document.createElement('div');
      row.className = `lab-row${lab.active === false ? ' lab-row--inactive' : ''}`;
      row.dataset.labId = lab.id;
      const name = document.createElement('span');
      name.className = 'lab-row__name';
      name.textContent = lab.name;
      row.appendChild(name);
      if (lab.active === false) row.appendChild(Badge({ label: 'غیرفعال', variant: 'neutral' }));
      row.appendChild(
        Button({
          label: 'ویرایش',
          variant: 'ghost',
          onClick: async () => {
            if (await openRenameModal(lab)) {
              showToast('نام آزمایشگاه ویرایش شد.', { variant: 'success' });
              await refresh();
            }
          },
        })
      );
      row.appendChild(
        Button({
          label: lab.active === false ? 'فعال‌سازی' : 'غیرفعال',
          variant: 'ghost',
          onClick: async () => {
            await setLabActive(lab.id, lab.active === false);
            await refresh();
          },
        })
      );
      list.appendChild(row);
    }
  }

  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await addLab(addField.getInput().value);
      addField.getInput().value = '';
      showToast('آزمایشگاه اضافه شد.', { variant: 'success' });
      await refresh();
    } catch (err) {
      showToast(err instanceof LabValidationError ? err.message : 'افزودن ناموفق بود.', { variant: 'danger' });
    }
  });

  card.refresh = refresh;
  refresh();
  return card;
}
