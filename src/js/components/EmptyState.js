// EmptyState.js
import { Button } from './Button.js';

export function EmptyState({ icon = '📭', title = 'چیزی یافت نشد', description = '', actionLabel = '', onAction } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const iconEl = document.createElement('div');
  iconEl.className = 'empty-state__icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  wrap.appendChild(iconEl);

  const titleEl = document.createElement('div');
  titleEl.className = 'empty-state__title';
  titleEl.textContent = title;
  wrap.appendChild(titleEl);

  if (description) {
    const descEl = document.createElement('div');
    descEl.className = 'empty-state__desc';
    descEl.textContent = description;
    wrap.appendChild(descEl);
  }

  if (actionLabel && onAction) {
    wrap.appendChild(Button({ label: actionLabel, onClick: onAction, variant: 'secondary' }));
  }

  return wrap;
}
