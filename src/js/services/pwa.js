// pwa.js — لایه‌ی نصب، آفلاین و ماندگاری داده (Phase 16)
//
// این فایل تنها جایی است که با Service Worker و Storage API حرف می‌زند.
// هیچ صفحه‌ای مستقیماً `navigator.serviceWorker` را صدا نمی‌زند، چون این
// APIها در سه محیطِ متفاوتِ ما سه رفتار دارند و پراکندگیِ گاردها یعنی
// دیر یا زود یکی از آن‌ها فراموش می‌شود:
//   • Safari روی iPhone با HTTPS  → همه چیز کار می‌کند
//   • http://<ip>:8080 در شبکه‌ی محلی → Secure Context نیست ⇒ بدون Service Worker
//   • preview.html روی file:// و jsdom در تست → اصلاً وجود ندارد

/** آیا برنامه از صفحه‌ی اصلی (Add to Home Screen) اجرا شده است؟ */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  // navigator.standalone فقط در Safari روی iOS وجود دارد و تنها راه تشخیص
  // در آن است؛ display-mode برای بقیه‌ی مرورگرها.
  if (window.navigator && window.navigator.standalone === true) return true;
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
}

/** آیا دستگاه iPhone/iPad است؟ */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13 به بعد خودش را «Macintosh» معرفی می‌کند
  return /Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document;
}

/** آیا مرورگر Safari است؟ (Chrome روی iOS از افزودن به صفحه‌ی اصلی پشتیبانی نمی‌کند) */
export function isSafari() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium/.test(ua);
}

/** آیا محیط اجرا امن است؟ Service Worker فقط روی https یا localhost ثبت می‌شود. */
export function isSecureContext() {
  if (typeof window === 'undefined') return false;
  if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
  const host = window.location?.hostname || '';
  return window.location?.protocol === 'https:' || host === 'localhost' || host === '127.0.0.1';
}

export function serviceWorkerSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && isSecureContext();
}

/**
 * وضعیت کلی نصب — مبنای تصمیم صفحه‌ی «نصب روی آیفون» و بنر داشبورد.
 * برمی‌گرداند: 'installed' | 'ios-safari' | 'ios-other-browser' | 'browser'
 */
export function installState() {
  if (isStandalone()) return 'installed';
  if (isIOS()) return isSafari() ? 'ios-safari' : 'ios-other-browser';
  return 'browser';
}

let registration = null;
let updateCallback = null;
let reloading = false;

/**
 * ثبت Service Worker و اطلاع‌رسانی وجود نسخه‌ی جدید.
 * نسخه‌ی جدید **خودکار اعمال نمی‌شود**؛ فقط onUpdateReady صدا زده می‌شود تا
 * برنامه از کاربر اجازه بگیرد (توضیح کامل در سرآیند service-worker.js).
 */
export async function registerServiceWorker({ onUpdateReady } = {}) {
  updateCallback = onUpdateReady || null;
  if (!serviceWorkerSupported()) return { registered: false, reason: reasonForNoSW() };

  try {
    registration = await navigator.serviceWorker.register('./service-worker.js');
  } catch (err) {
    console.warn('[pwa] ثبت Service Worker ناموفق بود:', err);
    return { registered: false, reason: 'error' };
  }

  // نسخه‌ای که همین حالا منتظر است (کاربر برنامه را بدون بستن باز کرده بود)
  if (registration.waiting && navigator.serviceWorker.controller) notifyUpdate();

  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // controller موجود یعنی این «به‌روزرسانی» است نه «اولین نصب»؛
      // بدون این شرط، همان بار اول هم نوار «نسخه‌ی جدید» نشان داده می‌شد.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate();
    });
  });

  // وقتی Service Worker جدید کنترل را می‌گیرد، یک بار (و فقط یک بار) صفحه
  // بازخوانی می‌شود تا کد جدید واقعاً اجرا شود.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  return { registered: true };
}

function reasonForNoSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
  if (!isSecureContext()) return 'insecure';
  return 'unknown';
}

function notifyUpdate() {
  if (typeof updateCallback === 'function') updateCallback();
}

/** اعمال نسخه‌ی جدید — فقط با لمس کاربر. */
export function applyUpdate() {
  const waiting = registration && registration.waiting;
  if (!waiting) {
    window.location.reload();
    return;
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
  // بازخوانی از مسیر controllerchange انجام می‌شود.
}

/** نسخه و تعداد فایل‌های کش‌شده را از Service Worker فعال می‌پرسد. */
export function serviceWorkerVersion({ timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    if (!serviceWorkerSupported() || !navigator.serviceWorker.controller) {
      resolve(null);
      return;
    }
    let settled = false;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, timeoutMs);
    channel.port1.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(event.data || null);
    };
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'VERSION' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      settled = true;
      resolve(null);
    }
  });
}

// ─────────────────────── ماندگاری داده ───────────────────────
//
// چرا این بخش برای **این** برنامه حیاتی است: کل دفاتر مالی و موجودی طلا در
// IndexedDB همین دستگاه است و هیچ سروری پشت آن نیست. اگر iOS فضا کم بیاورد،
// داده‌ی سایت‌های «ماندگار نشده» را بدون هیچ هشداری پاک می‌کند.
// درخواست ماندگاری تضمین نیست، ولی احتمال بقا را به‌شدت بالا می‌برد.

export function storageSupported() {
  return typeof navigator !== 'undefined' && !!navigator.storage;
}

/** درخواست ماندگاری. خروجی: true/false/null (پشتیبانی‌نشده). */
export async function requestPersistentStorage() {
  if (!storageSupported() || typeof navigator.storage.persist !== 'function') return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersisted() {
  if (!storageSupported() || typeof navigator.storage.persisted !== 'function') return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

/** { usage, quota, percent } بر حسب بایت — یا null اگر مرورگر پشتیبانی نکند. */
export async function storageEstimate() {
  if (!storageSupported() || typeof navigator.storage.estimate !== 'function') return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, percent: quota > 0 ? (usage / quota) * 100 : 0 };
  } catch {
    return null;
  }
}

/**
 * وضعیت کامل برای صفحه‌ی «نصب روی آیفون» — همه‌ی پرس‌وجوها یک‌جا،
 * تا صفحه مجبور نباشد شش تابع را جدا صدا بزند و شش‌بار گارد بنویسد.
 */
export async function pwaStatus() {
  const [persisted, estimate, version] = await Promise.all([
    isStoragePersisted(),
    storageEstimate(),
    serviceWorkerVersion(),
  ]);
  return {
    state: installState(),
    standalone: isStandalone(),
    ios: isIOS(),
    safari: isSafari(),
    secure: isSecureContext(),
    swSupported: serviceWorkerSupported(),
    swReason: serviceWorkerSupported() ? null : reasonForNoSW(),
    controlled: typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator
      && !!navigator.serviceWorker.controller,
    version,
    persisted,
    estimate,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  };
}
