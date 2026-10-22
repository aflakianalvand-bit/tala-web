// viewerInsets.js — تناسب صفحه داخل «مرورگر میهمان» (Phase 20)
//
// مسئله‌ی واقعی که این فایل حل می‌کند
// ─────────────────────────────────────────────────────────────────────────
// وقتی برنامه از داخل یک اپلیکیشن دیگر باز می‌شود — مثل Documents یا
// مرورگرِ داخلیِ تلگرام و اینستاگرام — آن اپلیکیشن نوار ابزار خودش را
// **روی** صفحه‌ی وب می‌اندازد، نه بالا و پایینِ آن. یعنی webview تمام‌صفحه
// است و دکمه‌ی «برگشت» میزبان دقیقاً روی دکمه‌ی «بستن» مودال ما می‌نشیند و
// دکمه‌های شناور پایینِ میزبان روی نوار جمع فاکتور.
//
// این فاصله در هیچ API استانداردی گزارش نمی‌شود: `env(safe-area-inset-*)`
// فقط ناچ و نوار Home را می‌دهد و از نوار ابزار اپلیکیشن میزبان بی‌خبر است.
// پس باید خودمان تشخیص دهیم و فضا رزرو کنیم.
//
// قاعده‌ی ترکیب: **بیشینه، نه جمع.**
// هر دو مانع از لبه‌ی صفحه اندازه‌گیری می‌شوند و روی هم می‌افتند؛ اگر جمع
// می‌شدند، هدر روی آیفون ناچ‌دار دو برابر لازم بلند می‌شد. (اعمال در
// variables.css: `--safe-top: max(--device-top, --viewer-top)`)
//
// چرا خودکار + دستی؟
// تشخیص از روی User Agent است و هیچ تشخیص UA ای صددرصد نیست. بنابراین
// کاربر در صفحه‌ی «نصب روی آیفون» می‌تواند آن را روشن/خاموش کند. این ترجیح
// عمداً در localStorage ذخیره می‌شود نه IndexedDB — دقیقاً مثل تصمیم
// Phase 16 برای بنر نصب: یک ترجیح نمایشیِ همین مرورگر است و نباید داخل
// فایل پشتیبان بیاید یا با بازگردانی روی دستگاه دیگری ظاهر شود.

import { isIOS, isStandalone, isSafari } from '../services/pwa.js';

/** کلید ترجیح کاربر در localStorage. */
export const VIEWER_PREF_KEY = 'tala.viewerChrome';

/** مقادیر پیش‌فرض رزرو، اندازه‌گیری‌شده روی اپلیکیشن Documents در آیفون.
 *  بالا: نوار عنوان شناور میزبان (دکمه‌ی برگشت + عنوان + منو).
 *  پایین: دکمه‌های گرد شناور میزبان (PDF / نشان / جستجو). */
export const VIEWER_TOP_PX = 104;
export const VIEWER_BOTTOM_PX = 56;

/** مرورگرهای واقعی: نوار ابزارشان بیرون از viewport است و چیزی نمی‌پوشاند. */
const REAL_BROWSER = /CriOS|FxiOS|EdgiOS|OPiOS|Safari\//;

/** مرورگرهای داخلیِ شناخته‌شده‌ای که با وجود «Safari/» در UA، روی محتوا می‌افتند. */
const KNOWN_EMBEDDED = /FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|Line\/|Twitter|Snapchat|Pinterest|Documents\//;

/**
 * آیا این محیط یک webview میهمان است؟ تابع خالص — هیچ دسترسی به window ندارد
 * تا بتوان هر پنج محیط را در تست با UA واقعی بررسی کرد.
 */
export function detectEmbeddedViewer({ userAgent = '', standalone = false, ios = false, safari = false } = {}) {
  // نصب‌شده روی صفحه‌ی اصلی = تمام‌صفحه‌ی واقعی، هیچ میزبانی بالای ما نیست.
  if (standalone) return false;
  // این مشکل مخصوص iOS است؛ روی دسکتاپ نوار مرورگر بیرون از viewport است.
  if (!ios) return false;
  const ua = String(userAgent);
  // مرورگر داخلیِ شناخته‌شده، حتی اگر خودش را Safari معرفی کند.
  if (KNOWN_EMBEDDED.test(ua)) return true;
  // Safari و کروم و فایرفاکسِ واقعی: محتوا را نمی‌پوشانند.
  if (safari || REAL_BROWSER.test(ua)) return false;
  // باقی‌مانده: یک WKWebView خام داخل اپلیکیشن دیگر (UA بدون «Safari/»).
  return true;
}

/** ترجیح کاربر: 'auto' | 'on' | 'off' — مقدار نامعتبر یعنی 'auto'. */
export function readViewerPreference(storage) {
  try {
    const raw = storage && storage.getItem(VIEWER_PREF_KEY);
    return raw === 'on' || raw === 'off' ? raw : 'auto';
  } catch {
    // Safari در حالت «مرور خصوصی» می‌تواند برای localStorage خطا بیندازد؛
    // نبودِ ترجیح نباید باعث شود برنامه اصلاً بالا نیاید.
    return 'auto';
  }
}

export function writeViewerPreference(value, storage) {
  const next = value === 'on' || value === 'off' ? value : 'auto';
  try {
    if (!storage) return next;
    if (next === 'auto') storage.removeItem(VIEWER_PREF_KEY);
    else storage.setItem(VIEWER_PREF_KEY, next);
  } catch { /* بی‌اهمیت: فقط یک ترجیح نمایشی است */ }
  return next;
}

/** تصمیم نهایی: ترجیح صریح کاربر همیشه بر تشخیص خودکار مقدم است. */
export function resolveViewerMode({ preference = 'auto', detected = false } = {}) {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return detected;
}

/** وضعیت فعلی محیط — برای صفحه‌ی «نصب روی آیفون». */
export function viewerEnvironment(win = typeof window !== 'undefined' ? window : null) {
  const nav = win && win.navigator ? win.navigator : null;
  const detected = detectEmbeddedViewer({
    userAgent: nav ? nav.userAgent : '',
    standalone: isStandalone(),
    ios: isIOS(),
    safari: isSafari(),
  });
  const preference = readViewerPreference(win ? win.localStorage : null);
  return { detected, preference, active: resolveViewerMode({ preference, detected }) };
}

/**
 * مقدارها را روی ریشه‌ی سند می‌نویسد. بقیه‌ی کار در CSS انجام می‌شود، چون
 * هدر، Bottom Nav، مودال، Toast و دکمه‌های شناور همگی از `--safe-*` می‌خوانند.
 */
export function applyViewerInsets({
  root,
  active = false,
  top = VIEWER_TOP_PX,
  bottom = VIEWER_BOTTOM_PX,
} = {}) {
  if (!root || !root.style) return { active: false, top: 0, bottom: 0 };
  const t = active ? Math.max(0, Number(top) || 0) : 0;
  const b = active ? Math.max(0, Number(bottom) || 0) : 0;
  root.style.setProperty('--viewer-top', `${t}px`);
  root.style.setProperty('--viewer-bottom', `${b}px`);
  if (root.classList) root.classList.toggle('is-viewer-chrome', active);
  return { active, top: t, bottom: b };
}

/** راه‌اندازی هنگام بالا آمدن برنامه. خروجی: وضعیت اعمال‌شده. */
export function startViewerInsets(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.document) return { active: false, top: 0, bottom: 0, preference: 'auto', detected: false };
  const env = viewerEnvironment(win);
  const applied = applyViewerInsets({ root: win.document.documentElement, active: env.active });
  return { ...applied, preference: env.preference, detected: env.detected };
}

/** تغییر ترجیح از صفحه‌ی تنظیمات نمایش — بلافاصله اعمال می‌شود. */
export function setViewerPreference(value, win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.document) return { active: false, preference: 'auto', detected: false };
  const preference = writeViewerPreference(value, win.localStorage);
  const env = viewerEnvironment(win);
  const applied = applyViewerInsets({ root: win.document.documentElement, active: env.active });
  return { ...applied, preference, detected: env.detected };
}
