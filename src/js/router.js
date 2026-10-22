// router.js — مسیریابی سبک مبتنی بر Hash (بدون کتابخانه خارجی)
import { LoadingState } from './components/LoadingState.js';
import { EmptyState } from './components/EmptyState.js';
import { updateActiveNav } from './components/BottomNav.js';
import { updateBackupStatus } from './components/Header.js';
import { backTargetOf } from './navigation.js';

const routes = new Map();
let defaultPath = '/dashboard';

export function registerRoute(path, renderFn) {
  routes.set(path, renderFn);
}

export function setDefaultRoute(path) {
  defaultPath = path;
}

export function navigate(path) {
  if (window.location.hash.slice(1) === path) {
    renderRoute();
  } else {
    window.location.hash = path;
  }
}

export function currentPath() {
  return window.location.hash.slice(1) || defaultPath;
}

export async function renderRoute() {
  const path = currentPath();
  const renderFn = routes.get(path) || routes.get(defaultPath);
  const outlet = document.getElementById('app-outlet');
  if (!outlet) return;

  outlet.innerHTML = '';
  outlet.appendChild(LoadingState({ label: '' }));

  try {
    const content = await renderFn();
    outlet.innerHTML = '';
    // Phase 25 — زیرصفحه‌ها (گزارش، انبار، کالا، …) دیگر آیتم مستقیم نوار پایین
    // ندارند؛ یک پیوند بازگشت به والد بالای صفحه می‌آید تا هیچ صفحه‌ای بن‌بست نباشد.
    const back = backLink(routes.has(path) ? path : defaultPath);
    if (back) outlet.appendChild(back);
    outlet.appendChild(content);
  } catch (err) {
    console.error('[router] خطا در رندر صفحه:', err);
    outlet.innerHTML = '';
    outlet.appendChild(
      EmptyState({
        icon: '⚠️',
        title: 'خطایی رخ داد',
        description: 'بارگذاری این صفحه با مشکل مواجه شد. لطفاً دوباره تلاش کنید.',
      })
    );
  }

  updateActiveNav(path);
  // وضعیت کلید پشتیبان هدر پس از هر جابه‌جایی تازه می‌شود — مثلاً بلافاصله
  // بعد از تهیه‌ی پشتیبان، هشدار نارنجی باید خاموش شده باشد.
  updateBackupStatus();
  window.scrollTo(0, 0);
}

function backLink(path) {
  const target = backTargetOf(path);
  if (!target) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'page-back';
  btn.setAttribute('aria-label', `بازگشت به ${target.label}`);
  const arrow = document.createElement('span');
  arrow.className = 'page-back__arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›'; // در RTL «بازگشت» به سمت راست است
  const text = document.createElement('span');
  text.textContent = target.label;
  btn.append(arrow, text);
  btn.addEventListener('click', () => navigate(target.path));
  return btn;
}

export function startRouter() {
  window.addEventListener('hashchange', renderRoute);
  return renderRoute();
}
