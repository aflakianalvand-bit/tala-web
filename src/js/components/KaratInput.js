// KaratInput.js — فیلد «عیار» هزاری با میان‌بر عیارهای رایج — Phase 22
//
// چرا یک کامپوننت جدا: عیار در هشت فرم وارد می‌شود (خرید، فروش، تسویه، کالا، اصلاح،
// ذوب، …). تا Phase 21 هر کدام یک Input ساده با پیش‌فرض «۱۸» بود. از Phase 22 عیار
// هزاری است (پیش‌فرض ۷۵۰، هر عدد صحیح ۱ تا ۱۰۰۰)؛ اگر هر فرم خودش راهنما و
// میان‌برها را می‌ساخت، دیر یا زود یکی‌شان «۱۸» یا راهنمای قدیمی را نگه می‌داشت.
//
// اعتبارسنجی **اینجا نیست** — تنها مرجع آن services/units.js است و سرویس‌ها آن را
// اجرا می‌کنند؛ این فیلد فقط ورود را راحت می‌کند.
import { Input } from './Input.js';
import { COMMON_FINENESS, DEFAULT_FINENESS } from '../services/units.js';

export function KaratInput({ label = 'عیار', value, error = '', onInput, quick = true, hint, required = true } = {}) {
  const shown = value === undefined || value === null || value === '' ? String(DEFAULT_FINENESS) : String(value);
  const field = Input({
    label,
    numeric: true,
    inputmode: 'numeric',
    group: false,
    required,
    value: shown,
    error,
    hint: hint ?? 'عیار هزاری — مثلاً ۷۵۰ یا ۹۹۹',
    onInput,
  });
  if (!quick) return field;

  const chips = document.createElement('div');
  chips.className = 'karat-chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'عیارهای رایج');
  for (const f of COMMON_FINENESS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'karat-chip';
    b.textContent = String(f);
    b.addEventListener('click', () => {
      const input = field.getInput();
      input.value = String(f);
      if (onInput) onInput(String(f));
    });
    chips.appendChild(b);
  }
  field.appendChild(chips);
  return field;
}
