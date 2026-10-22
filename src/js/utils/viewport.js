// viewport.js — همگام‌سازی رابط با صفحه‌کلید مجازی iOS (Phase 16)
//
// مسئله: روی iPhone، باز شدن صفحه‌کلید **ارتفاع layout viewport را تغییر
// نمی‌دهد**. یعنی هر عنصری که با `position: fixed` به پایین صفحه چسبیده —
// Bottom Nav، نوار جمع فاکتور، دکمه‌های «ثبت/انصراف» مودال — دقیقاً زیر
// صفحه‌کلید پنهان می‌شود. کاربر مبلغ را وارد می‌کند و دکمه‌ی ثبت را
// نمی‌بیند؛ باید صفحه‌کلید را ببندد تا دکمه پیدا شود.
//
// راه‌حل: visualViewport ارتفاع واقعیِ دیده‌شده را می‌دهد. تفاوت آن با
// ارتفاع پنجره، همان ارتفاع صفحه‌کلید است و در متغیر CSS `--kb-inset`
// نوشته می‌شود؛ بقیه‌ی کار در CSS انجام می‌شود (components.css، modal-overlay).

let started = false;

export function startViewportSync() {
  if (started) return () => {};
  if (typeof window === 'undefined') return () => {};

  const vv = window.visualViewport;
  const root = document.documentElement;

  // مرورگرهای بدون visualViewport (و jsdom در تست): مقدار صفر می‌ماند و
  // چیدمان دقیقاً مثل قبل از Phase 16 کار می‌کند.
  if (!vv) return () => {};

  started = true;

  const update = () => {
    // آستانه‌ی ۸۰px: تغییرات کوچک ناشی از جمع‌شدن نوار آدرس Safari نباید
    // به‌عنوان «صفحه‌کلید» تفسیر شود، وگرنه رابط با هر اسکرول می‌پرد.
    const raw = window.innerHeight - vv.height - vv.offsetTop;
    const inset = raw > 80 ? Math.round(raw) : 0;
    root.style.setProperty('--kb-inset', inset + 'px');
    root.classList.toggle('keyboard-open', inset > 0);
  };

  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();

  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    root.style.setProperty('--kb-inset', '0px');
    root.classList.remove('keyboard-open');
    started = false;
  };
}

/**
 * وقتی کاربر روی فیلدی در انتهای یک فرم بلند ضربه می‌زند، Safari آن را
 * فقط «تا لبه‌ی صفحه‌کلید» بالا می‌آورد و برچسب و پیام خطای فیلد بیرون
 * می‌ماند. این تابع فیلد فعال را با کمی فاصله در وسط ناحیه‌ی دیده‌شده
 * قرار می‌دهد.
 */
export function startFocusAssist({ delayMs = 250 } = {}) {
  if (typeof document === 'undefined') return () => {};

  const onFocusIn = (event) => {
    const el = event.target;
    if (!el || !el.matches || !el.matches('input, textarea, select')) return;
    setTimeout(() => {
      if (document.activeElement !== el) return;
      if (typeof el.scrollIntoView !== 'function') return;
      try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        el.scrollIntoView(false);
      }
    }, delayMs);
  };

  document.addEventListener('focusin', onFocusIn);
  return () => document.removeEventListener('focusin', onFocusIn);
}
