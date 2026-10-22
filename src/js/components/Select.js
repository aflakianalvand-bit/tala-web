// Select.js — کشویی انتخاب با برچسب
let uid = 0;

export function Select({ label, options = [], value = '', onChange, hint = '', required = false } = {}) {
  const id = `select-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = 'field';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'field__label';
    labelEl.setAttribute('for', id);
    labelEl.textContent = label + (required ? ' *' : '');
    wrap.appendChild(labelEl);
  }

  const select = document.createElement('select');
  select.id = id;
  select.className = 'select';
  for (const opt of options) {
    const optionEl = document.createElement('option');
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.value === value) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  if (onChange) select.addEventListener('change', (e) => onChange(e.target.value, e));
  wrap.appendChild(select);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'field__hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }

  wrap.getSelect = () => select;
  return wrap;
}
