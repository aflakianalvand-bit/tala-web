// Toast.js — سیستم پیام‌های زودگذر (Success/Danger/Warning)
function getContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, { variant = 'default', duration = 3000 } = {}) {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast${variant !== 'default' ? ` toast--${variant}` : ''}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.textContent = message;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, duration);
}
