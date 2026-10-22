// Switch.js — کلید فعال/غیرفعال (Toggle)، برای فیلدهای بولی مثل «کالا فعال است»
let uid = 0;

export function Switch({ label, checked = false, hint = '', onChange } = {}) {
  const id = `switch-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const row = document.createElement('label');
  row.className = 'switch-row';
  row.setAttribute('for', id);

  const labelEl = document.createElement('span');
  labelEl.className = 'switch-row__label';
  labelEl.textContent = label;

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.className = 'switch-input';
  input.checked = !!checked;

  const track = document.createElement('span');
  track.className = 'switch-track';
  track.setAttribute('aria-hidden', 'true');

  if (onChange) input.addEventListener('change', (e) => onChange(e.target.checked, e));

  row.append(labelEl, input, track);
  wrap.appendChild(row);

  if (hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'field__hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }

  wrap.isChecked = () => input.checked;
  wrap.getInput = () => input;
  return wrap;
}
