// LoadingState.js
export function LoadingState({ label = 'در حال بارگذاری…' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'loading-state';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');

  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  wrap.appendChild(spinner);

  if (label) {
    const labelEl = document.createElement('div');
    labelEl.textContent = label;
    wrap.appendChild(labelEl);
  }

  return wrap;
}
