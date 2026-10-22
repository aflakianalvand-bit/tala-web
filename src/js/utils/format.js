// format.js — فرمت اعداد، مبالغ و وزن به شکل مناسب فارسی (رجوع به UI_GUIDELINES.md §1)
const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input) {
  return String(input).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

export function toEnglishDigits(input) {
  return String(input).replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

/**
 * فرمت یک عدد با جداکننده هزارگان. اعداد به‌صورت پیش‌فرض با ارقام لاتین (خوانایی محاسباتی بهتر)
 * نمایش داده می‌شوند؛ برای ارقام فارسی از persianDigits:true استفاده کنید (طبق تنظیمات کاربر).
 */
export function formatNumber(value, { maximumFractionDigits = 3, minimumFractionDigits = 0, persianDigits = false } = {}) {
  const num = Number(value) || 0;
  // (Phase 26) minimumFractionDigits برای نمایش ثابت سه‌رقمی گرم ۷۵۰ («19.560»).
  const formatted = num.toLocaleString('en-US', {
    maximumFractionDigits: Math.max(maximumFractionDigits, minimumFractionDigits),
    minimumFractionDigits,
  });
  return persianDigits ? toPersianDigits(formatted) : formatted;
}

export function formatRial(value, opts = {}) {
  return `${formatNumber(Math.round(Number(value) || 0), { maximumFractionDigits: 0, ...opts })} ریال`;
}

export function formatGrams(value, opts = {}) {
  return `${formatNumber(value, { maximumFractionDigits: 3, ...opts })} گرم`;
}

/**
 * (Phase 19) واحد رسمی مانده: «گرم ۷۵۰».
 * عمداً جدا از formatGrams است: آن وزن ترازو را نشان می‌دهد (عیار واقعی)
 * و این وزنِ معادلِ حساب‌شده را. یکی‌کردنشان یعنی کاربر نفهمد کدام عدد را می‌بیند.
 * (Phase 23) حداکثر **سه** رقم اعشار — دقت رسمی از Phase 22 (یک سوت). با دو رقم،
 * مانده‌ی ۱۰٫۰۰۳ «۱۰» نشان داده می‌شد و همان سوتی که Phase 22 نجات داده بود از دید
 * کاربر پنهان می‌ماند. عدد دو رقمی اسناد قدیمی همان‌طور نمایش داده می‌شود.
 */
export function formatBaseGrams(value, opts = {}) {
  return `${formatNumber(value, { maximumFractionDigits: 3, ...opts })} گرم ۷۵۰`;
}

/**
 * مبلغ فشرده برای کارت‌های داشبورد (Phase 13).
 * «۱,۲۵۰,۰۰۰,۰۰۰ ریال» روی عرض ۳۹۰px یا می‌شکند یا با فونت کوچک‌تر خوانده می‌شود؛
 * مدیری که می‌خواهد در ۱۰ ثانیه وضعیت را بفهمد به رقم آخر نیاز ندارد.
 * عدد کامل همیشه در `title` کارت می‌ماند تا هیچ اطلاعاتی گم نشود.
 */
export function formatRialCompact(value, opts = {}) {
  const n = Math.round(Number(value) || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const scale = (unit, div, digits) => {
    const scaled = abs / div;
    // ۲ رقم اعشار زیر ۱۰، یک رقم زیر ۱۰۰، بدون اعشار بالاتر — طول رشته ثابت می‌ماند.
    const text = formatNumber(scaled, { maximumFractionDigits: digits, ...opts });
    return `${sign}${text} ${unit} ریال`;
  };
  if (abs >= 1e9) return scale('میلیارد', 1e9, abs >= 1e11 ? 0 : abs >= 1e10 ? 1 : 2);
  if (abs >= 1e6) return scale('میلیون', 1e6, abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2);
  return formatRial(n, opts);
}
