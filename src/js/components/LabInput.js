// LabInput.js — فیلد «آزمایشگاه» با پیشنهاد خودکار — Phase 23
//
// تایپ آزاد + فهرست پیشنهاد بومی (`<datalist>`): روی iOS Safari پیشنهادها بالای
// صفحه‌کلید می‌آیند و کاربر می‌تواند نامی را که در فهرست نیست هم بنویسد (آن نام هنگام
// ثبت سند به فهرست اضافه می‌شود — services/labs.js). اعتبارسنجی اینجا نیست.
import { Input } from './Input.js';

let seq = 0;

export function LabInput({ value = '', suggestions = [], error = '', onInput, hint } = {}) {
  const field = Input({
    label: 'آزمایشگاه',
    value: value ?? '',
    error,
    hint: hint ?? 'اختیاری — نام آزمایشگاهِ برگه‌ی عیارسنجی. نام تازه خودکار به فهرست اضافه می‌شود.',
    onInput,
  });
  const input = field.getInput();
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('enterkeyhint', 'next');
  input.maxLength = 60;
  input.classList.add('lab-input');

  const list = document.createElement('datalist');
  list.id = `lab-list-${++seq}`;
  for (const name of suggestions) {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  }
  input.setAttribute('list', list.id);
  field.appendChild(list);
  return field;
}
