// Textarea.js — فیلد متن چندخطی (توضیحات/یادداشت)، هم‌خانواده با Input.js
let uid = 0;

export function Textarea({
  label,
  value = '',
  placeholder = '',
  hint = '',
  rows = 3,
  required = false,
  onInput,
} = {}) {
  const id = `textarea-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = 'field';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'field__label';
    labelEl.setAttribute('for', id);
    labelEl.textContent = label + (required ? ' *' : '');
    wrap.appendChild(labelEl);
  }

  const textarea = document.createElement('textarea');
  textarea.id = id;
  textarea.className = 'textarea';
  textarea.rows = rows;
  textarea.placeholder = placeholder;
  textarea.value = value ?? '';
  if (required) textarea.required = true;
  if (onInput) textarea.addEventListener('input', (e) => onInput(e.target.value, e));
  wrap.appendChild(textarea);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'field__hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }

  wrap.getTextarea = () => textarea;
  return wrap;
}
