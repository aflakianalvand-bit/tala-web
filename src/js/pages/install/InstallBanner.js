// InstallBanner.js — دعوت یک‌باره به «افزودن به صفحه‌ی اصلی» (Phase 16)
//
// دو قاعده:
//   ۱) وقتی برنامه از صفحه‌ی اصلی اجرا شده، بنر اصلاً ساخته نمی‌شود
//      (نه اینکه ساخته و مخفی شود).
//   ۲) اگر کاربر ببندد، تا نصب دیگر برنمی‌گردد. تصمیمش در localStorage
//      ذخیره می‌شود، نه IndexedDB: این یک ترجیح نمایشیِ همین مرورگر است،
//      نه داده‌ی کسب‌وکار، و نباید در فایل پشتیبان بیاید یا با بازگردانی
//      روی دستگاه دیگری برگردد.

import { navigate } from '../../router.js';
import { installState } from '../../services/pwa.js';

const DISMISS_KEY = 'tala.installBanner.dismissed';

function isDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    // حالت مرور خصوصی یا مسدودبودن Storage — بنر نمایش داده می‌شود.
    return false;
  }
}

function dismiss() {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* ذخیره نشد؛ بنر همین جلسه بسته می‌ماند */
  }
}

const TEXTS = {
  'ios-safari': {
    title: 'برنامه را به صفحه‌ی اصلی اضافه کنید',
    text: 'تا وقتی داخل Safari باز است، بدون اینترنت بالا نمی‌آید و داده‌اش کمتر ماندگار است.',
  },
  'ios-other-browser': {
    title: 'این آدرس را در Safari باز کنید',
    text: 'روی آیفون فقط Safari می‌تواند برنامه را به صفحه‌ی اصلی اضافه کند.',
  },
  browser: {
    title: 'برنامه را نصب کنید',
    text: 'با نصب، برنامه تمام‌صفحه و بدون اینترنت اجرا می‌شود.',
  },
};

/** @returns {HTMLElement|null} بنر، یا null اگر نمایش آن معنا ندارد. */
export function InstallBanner() {
  const state = installState();
  if (state === 'installed') return null;
  if (isDismissed()) return null;

  const copy = TEXTS[state] || TEXTS.browser;

  const el = document.createElement('div');
  el.className = 'install-banner';

  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📲';
  icon.style.fontSize = '1.4rem';

  const body = document.createElement('div');
  body.className = 'install-banner__body';

  const title = document.createElement('div');
  title.className = 'install-banner__title';
  title.textContent = copy.title;

  const text = document.createElement('div');
  text.className = 'install-banner__text';
  text.textContent = copy.text;

  const actions = document.createElement('div');
  actions.className = 'install-banner__actions';
  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'btn btn--primary btn--sm';
  guideBtn.textContent = 'راهنمای نصب';
  guideBtn.addEventListener('click', () => navigate('/install'));
  actions.appendChild(guideBtn);

  body.append(title, text, actions);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'install-banner__close';
  close.setAttribute('aria-label', 'بستن');
  close.textContent = '✕';
  close.addEventListener('click', () => {
    dismiss();
    el.remove();
  });

  el.append(icon, body, close);
  return el;
}
