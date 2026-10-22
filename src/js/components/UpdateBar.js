// UpdateBar.js — نوار «نسخه‌ی جدید آماده است» (Phase 16)
//
// چرا به‌جای جایگزینی خودکار؟ در این برنامه کاربر ممکن است وسط ثبت یک
// فاکتور چندقلمی باشد. بازخوانی خودکار صفحه، فرم نیمه‌پرشده را از بین
// می‌برد. پس نسخه‌ی جدید بی‌صدا دانلود می‌شود و فقط با لمس کاربر —
// در لحظه‌ای که خودش انتخاب می‌کند — جایگزین می‌شود.

let bar = null;

export function showUpdateBar({ onApply } = {}) {
  if (bar && bar.isConnected) return;

  bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'update-bar__text';
  text.textContent = 'نسخه‌ی جدید برنامه آماده است.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'update-bar__btn';
  btn.textContent = 'به‌روزرسانی';
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'در حال به‌روزرسانی…';
    if (onApply) onApply();
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'install-banner__close';
  dismiss.setAttribute('aria-label', 'بعداً');
  dismiss.textContent = '✕';
  dismiss.style.color = 'inherit'; // Phase 24: رنگ متن نوار از توکن --toast-fg (هر دو تم)
  dismiss.addEventListener('click', () => hideUpdateBar());

  bar.append(text, btn, dismiss);
  document.body.appendChild(bar);
}

export function hideUpdateBar() {
  if (bar && bar.isConnected) bar.remove();
  bar = null;
}
