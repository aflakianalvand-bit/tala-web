// Input.js — فیلد ورودی با برچسب، مناسب صفحه‌کلید موبایل
//
// (Phase 19) فیلدهای عددی هنگام تایپ **جداکننده‌ی سه‌رقمی** می‌گیرند.
// چرا در همین کامپوننت و نه در هر فرم: فی و مبلغ در این کسب‌وکار ده‌رقمی‌اند و
// خواندن «۱۰۵۰۰۰۰۰۰۰» روی صفحه‌ی گوشی عملاً ممکن نیست؛ یک صفر کم یا زیاد، یک
// سند مالی غلط است. اگر هر فرم خودش این کار را می‌کرد، دیر یا زود یکی‌شان از
// قلم می‌افتاد یا قاعده‌ی متفاوتی می‌گرفت.
//
// قرارداد مهم: `onInput` و `getValue()` همیشه مقدار **خام** (بدون کاما، با ارقام
// لاتین) می‌دهند — یعنی `Number(v)` همیشه کار می‌کند. فقط چیزی که کاربر می‌بیند
// گروه‌بندی شده است. ارقام فارسیِ صفحه‌کلید iOS هم همین‌جا به لاتین تبدیل می‌شوند.
import { toEnglishDigits } from '../utils/format.js';
import { JalaliDateField } from './JalaliDatePicker.js';

let uid = 0;

/** رشته‌ی نمایشی → مقدار خام عددی (ارقام لاتین، بدون جداکننده). */
export function rawNumeric(text) {
  const s = toEnglishDigits(String(text ?? '')).replace(/[٬،\s]/g, '');
  let out = '';
  let seenDot = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch >= '0' && ch <= '9') out += ch;
    else if ((ch === '.' || ch === '/' || ch === '٫') && !seenDot) {
      out += '.';
      seenDot = true;
    } else if (ch === '-' && out.length === 0) out += '-';
  }
  return out;
}

/** مقدار خام → رشته‌ی نمایشی با جداکننده‌ی سه‌رقمی (بخش اعشاری دست‌نخورده). */
export function groupNumeric(raw) {
  const s = String(raw ?? '');
  if (s === '' || s === '-') return s;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const intPart = dot >= 0 ? body.slice(0, dot) : body;
  const frac = dot >= 0 ? body.slice(dot + 1) : null;
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac === null ? '' : `.${frac}`}`;
}

const SIGNIFICANT = /[0-9.\-]/;

/**
 * مقدار فیلد را گروه‌بندی می‌کند و مکان‌نما را روی همان نویسه‌ی معنادار نگه می‌دارد.
 * بدون این کار، تایپ در وسط یک عدد ده‌رقمی مکان‌نما را به انتها پرت می‌کرد.
 */
function applyGrouping(input) {
  const shown = input.value;
  const caret = typeof input.selectionStart === 'number' ? input.selectionStart : shown.length;
  const rawBefore = rawNumeric(shown.slice(0, caret)).length;
  const raw = rawNumeric(shown);
  const formatted = groupNumeric(raw);

  if (formatted !== shown) {
    input.value = formatted;
    let seen = 0;
    let pos = rawBefore === 0 ? 0 : formatted.length;
    if (rawBefore > 0) {
      for (let i = 0; i < formatted.length; i++) {
        if (SIGNIFICANT.test(formatted[i])) seen += 1;
        if (seen === rawBefore) {
          pos = i + 1;
          break;
        }
      }
    }
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      /* فیلدهایی که setSelectionRange ندارند (مثل type=date) هرگز numeric نیستند */
    }
  }
  return raw;
}

export function Input({
  label,
  value = '',
  type = 'text',
  inputmode,
  placeholder = '',
  hint = '',
  error = '',
  required = false,
  onInput,
  numeric = false,
  // گروه‌بندی پیش‌فرض برای فیلدهای عددی روشن است؛ با group:false خاموش می‌شود.
  group = true,
} = {}) {
  // Phase 24 — هر فیلد تاریخ در کل برنامه تقویم شمسی می‌گیرد، از همین یک نقطه.
  // امضا و خروجی (getInput().value = `YYYY-MM-DD`، رویداد input/change) همان است،
  // پس هیچ فرمی تغییر نکرد. توضیح کامل در JalaliDatePicker.js.
  if (type === 'date') {
    return JalaliDateField({ label, value, hint, error, required, placeholder: placeholder || undefined, onInput });
  }
  const id = `field-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = `field${error ? ' field--invalid' : ''}`;

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'field__label';
    labelEl.setAttribute('for', id);
    labelEl.textContent = label + (required ? ' *' : '');
    wrap.appendChild(labelEl);
  }

  // شماره‌ی تلفن عدد است ولی «مقدار» نیست — گروه‌بندی آن («۰۹,۱۲۳,...») غلط است.
  // پس فقط فیلدهایی گروه‌بندی می‌شوند که واقعاً کمیت‌اند (decimal/numeric).
  const isQuantity = inputmode === undefined || inputmode === 'decimal' || inputmode === 'numeric';
  const grouped = numeric && group && isQuantity && type === 'text';
  const input = document.createElement('input');
  input.id = id;
  input.className = 'input';
  input.type = type;
  input.value = grouped ? groupNumeric(rawNumeric(value)) : (value ?? '');
  input.placeholder = placeholder;
  if (required) input.required = true;
  if (numeric) {
    input.setAttribute('inputmode', inputmode || 'decimal');
    input.setAttribute('dir', 'ltr');
    input.classList.add('num');
  } else if (inputmode) {
    input.setAttribute('inputmode', inputmode);
  }

  if (grouped) {
    input.addEventListener('input', (e) => {
      const raw = applyGrouping(input);
      if (onInput) onInput(raw, e);
    });
  } else if (onInput) {
    input.addEventListener('input', (e) => onInput(e.target.value, e));
  }
  wrap.appendChild(input);

  if (hint && !error) {
    const hintEl = document.createElement('div');
    hintEl.className = 'field__hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }
  if (error) {
    const errorEl = document.createElement('div');
    errorEl.className = 'field__error';
    errorEl.textContent = error;
    wrap.appendChild(errorEl);
  }

  wrap.getInput = () => input;
  /** مقدار خام فیلد — برای فیلد عددیِ گروه‌بندی‌شده بدون کاما. */
  wrap.getValue = () => (grouped ? rawNumeric(input.value) : input.value);
  return wrap;
}
