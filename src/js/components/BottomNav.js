// BottomNav.js — نوار پایین چهارقسمتی (Phase 25)
//
// داشبورد | قیمت | عملیات (+ برجسته) | تنظیمات — ساخته‌شده از navigation.js.
// هر زیرصفحه (گزارش، انبار، کالا، …) آیتم والدش را فعال نگه می‌دارد، تا کاربر
// همیشه بداند «کجای برنامه» است (قبلاً آرایه‌ی دستی مسیرهای «بیشتر» این کار را می‌کرد).
import { navigate } from '../router.js';
import { NAV_TABS, tabOf } from '../navigation.js';

export function renderBottomNav() {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'ناوبری اصلی');

  for (const item of NAV_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `bottom-nav__item${item.primary ? ' bottom-nav__item--primary' : ''}`;
    btn.dataset.path = item.path;

    const icon = document.createElement('span');
    icon.className = 'bottom-nav__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.icon;

    const label = document.createElement('span');
    label.className = 'bottom-nav__label';
    label.textContent = item.label;

    btn.append(icon, label);
    btn.addEventListener('click', () => navigate(item.path));
    nav.appendChild(btn);
  }

  return nav;
}

/** بر اساس مسیر فعلی، آیتم فعال نوار پایین را مشخص می‌کند (والدِ زیرصفحه‌ها). */
export function updateActiveNav(currentPath) {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  const activeTab = tabOf(currentPath);
  nav.querySelectorAll('.bottom-nav__item').forEach((btn) => {
    const active = btn.dataset.path === activeTab;
    btn.classList.toggle('is-active', active);
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}
