// theme.js — تم روشن/تیره (Phase 24)
//
// پیش‌فرض: از سیستم (prefers-color-scheme) — بدون هیچ JS، خودِ CSS این را
// انجام می‌دهد (variables.css)، پس حتی اولین فریم پیش از اجرای این فایل هم
// تم درست را دارد و «پرش سفید» در شب رخ نمی‌دهد.
//
// کلید دستی: سه‌حالته «خودکار / روشن / تیره». انتخاب دستی فقط ویژگی
// `data-theme` را روی <html> می‌گذارد؛ هیچ رنگی در JS نیست.
//
// ترجیح در localStorage (نه IndexedDB) — همان تصمیم Phase 16/20: یک ترجیح
// نمایشیِ همین دستگاه است؛ نباید وارد فایل پشتیبان شود یا با بازگردانی روی
// گوشی دیگری ظاهر شود. هیچ فایل services/ به این ماژول وابسته نیست.

export const THEME_PREF_KEY = 'tala.theme';
export const THEME_CHANGE_EVENT = 'tala:themechange';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** ترجیح کاربر: 'auto' | 'light' | 'dark' — مقدار نامعتبر یعنی 'auto'. */
export function readThemePreference(storage) {
  try {
    const raw = storage && storage.getItem(THEME_PREF_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'auto';
  } catch {
    // مرور خصوصی Safari می‌تواند خطا بدهد؛ نبودِ ترجیح یعنی «خودکار».
    return 'auto';
  }
}

export function writeThemePreference(value, storage) {
  const next = value === 'light' || value === 'dark' ? value : 'auto';
  try {
    if (storage) {
      if (next === 'auto') storage.removeItem(THEME_PREF_KEY);
      else storage.setItem(THEME_PREF_KEY, next);
    }
  } catch { /* فقط یک ترجیح نمایشی است */ }
  return next;
}

/** تم نهایی: ترجیح صریح همیشه بر سیستم مقدم است. */
export function resolveTheme({ preference = 'auto', systemDark = false } = {}) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemDark ? 'dark' : 'light';
}

function systemIsDark(win) {
  try {
    return !!(win && win.matchMedia && win.matchMedia(DARK_QUERY).matches);
  } catch {
    return false;
  }
}

/** وضعیت فعلی — برای صفحه‌ی تنظیمات و کلید هدر. */
export function themeState(win = typeof window !== 'undefined' ? window : null) {
  const preference = readThemePreference(win ? win.localStorage : null);
  const systemDark = systemIsDark(win);
  return { preference, systemDark, theme: resolveTheme({ preference, systemDark }) };
}

/**
 * data-theme و متای theme-color را اعمال می‌کند.
 * رنگ نوار وضعیت iOS از خودِ توکن --color-bg خوانده می‌شود (نه یک رنگ در JS)،
 * تا اگر روزی پالت عوض شد، این فایل دست نخورد.
 */
export function applyTheme(win = typeof window !== 'undefined' ? window : null) {
  if (!win || !win.document) return { preference: 'auto', systemDark: false, theme: 'light' };
  const state = themeState(win);
  const root = win.document.documentElement;
  if (state.preference === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', state.preference);
  root.dataset.resolvedTheme = state.theme;

  try {
    const meta = win.document.querySelector('meta[name="theme-color"]');
    const bg = win.getComputedStyle(root).getPropertyValue('--color-bg').trim();
    if (meta && bg) meta.setAttribute('content', bg);
  } catch { /* محیط بدون getComputedStyle (تست) */ }

  try {
    win.dispatchEvent(new win.CustomEvent(THEME_CHANGE_EVENT, { detail: state }));
  } catch { /* بی‌اهمیت */ }
  return state;
}

let started = false;
/** راه‌اندازی هنگام بالا آمدن برنامه + دنبال کردن تغییر تم سیستم (خودکار). */
export function startTheme(win = typeof window !== 'undefined' ? window : null) {
  const state = applyTheme(win);
  if (!started && win && win.matchMedia) {
    started = true;
    try {
      const mq = win.matchMedia(DARK_QUERY);
      const onChange = () => applyTheme(win);
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch { /* مرورگر قدیمی */ }
  }
  return state;
}

/** تغییر ترجیح از تنظیمات — بلافاصله اعمال می‌شود. */
export function setThemePreference(value, win = typeof window !== 'undefined' ? window : null) {
  writeThemePreference(value, win ? win.localStorage : null);
  return applyTheme(win);
}

/** کلید هدر: تم دیدنیِ فعلی را برعکس می‌کند (ترجیح دستی می‌شود). */
export function toggleTheme(win = typeof window !== 'undefined' ? window : null) {
  const { theme } = themeState(win);
  return setThemePreference(theme === 'dark' ? 'light' : 'dark', win);
}

export const THEME_OPTIONS = [
  { value: 'auto', label: 'خودکار' },
  { value: 'light', label: 'روشن' },
  { value: 'dark', label: 'تیره' },
];
