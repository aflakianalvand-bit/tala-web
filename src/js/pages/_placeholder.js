// _placeholder.js — سازنده مشترک صفحات «هنوز پیاده‌سازی نشده» (Phase 2: فقط Shell، بدون Business Logic)
// طبق قانون «از Duplicate Logic جلوگیری کن»، تمام صفحات پایه از این تابع مشترک استفاده می‌کنند.
import { EmptyState } from '../components/EmptyState.js';

export function placeholderPage({ title, subtitle = '', icon = '🧱', phaseNote }) {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = title;
  header.appendChild(h1);
  wrap.appendChild(header);

  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'page-header__subtitle';
    sub.textContent = subtitle;
    wrap.appendChild(sub);
  }

  wrap.appendChild(
    EmptyState({
      icon,
      title: 'این بخش هنوز پیاده‌سازی نشده',
      description: phaseNote || 'منطق و فرم‌های این صفحه در فاز بعدی نقشه راه پروژه ساخته می‌شود.',
    })
  );

  return wrap;
}
