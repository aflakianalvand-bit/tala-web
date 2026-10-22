// Alert.js — پیام درون‌صفحه‌ای (بدون Auto-dismiss؛ برای Toast از Toast.js استفاده کنید)
const ICONS = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '⛔' };

export function Alert({ variant = 'info', message = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `alert alert--${variant}`;
  wrap.setAttribute('role', variant === 'danger' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = ICONS[variant] || ICONS.info;
  wrap.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = message;
  wrap.appendChild(text);

  return wrap;
}
