// NavTiles.js — کاشی‌های پیمایش به زیرصفحه‌ها (Phase 25)
//
// سه شکل، یک منبع (navigation.js):
//   'strip' — ردیف فشرده‌ی آیکن + برچسب کوتاه (بالای داشبورد)
//   'grid'  — کاشی دوستونی با توضیح یک‌خطی (بخش‌های تنظیمات، همه‌ی بخش‌ها)
// هر کاشی یک <button> واقعی ≥ ۴۸px است با aria-label کامل.
import { navigate } from '../../router.js';
import { navEntry } from '../../navigation.js';

export function NavTiles(paths, { variant = 'grid', label = '' } = {}) {
  const el = document.createElement('nav');
  el.className = `nav-tiles nav-tiles--${variant}`;
  if (label) el.setAttribute('aria-label', label);

  for (const path of paths) {
    const entry = navEntry(path);
    if (!entry) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-tile';
    btn.dataset.path = path;
    btn.setAttribute('aria-label', entry.hint ? `${entry.label} — ${entry.hint}` : entry.label);

    const icon = document.createElement('span');
    icon.className = 'nav-tile__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.icon;

    const title = document.createElement('span');
    title.className = 'nav-tile__title';
    title.textContent = variant === 'strip' ? entry.shortLabel || entry.label : entry.label;
    btn.append(icon, title);

    if (variant === 'grid' && entry.hint) {
      const hint = document.createElement('span');
      hint.className = 'nav-tile__hint';
      hint.textContent = entry.hint;
      btn.appendChild(hint);
    }

    btn.addEventListener('click', () => navigate(path));
    el.appendChild(btn);
  }
  return el;
}
