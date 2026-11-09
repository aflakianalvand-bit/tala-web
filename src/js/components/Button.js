// Button.js
import { setIcon } from './Icon.js';

export function Button({ label, onClick, variant = 'primary', type = 'button', disabled = false, fullWidth = false, icon = '' }) {
  const btn = document.createElement('button');
  btn.type = type;
  btn.className = `btn btn--${variant}${fullWidth ? ' btn--full' : ''}`;
  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.setAttribute('aria-hidden', 'true');
    setIcon(iconSpan, icon);
    btn.appendChild(iconSpan);
  }
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);
  btn.disabled = disabled;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}
