// Badge.js — برچسب کوچک وضعیت/دسته، بر پایه کلاس‌های .badge در components.css
export function Badge({ label, variant = 'neutral' } = {}) {
  const el = document.createElement('span');
  el.className = `badge badge--${variant}`;
  el.textContent = label;
  return el;
}
