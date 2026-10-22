// voidGuard.js — مسیر مشترک «هشدار + تأیید صریح» برای ابطال اسنادی که موجودی را کم می‌کنند
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل در Phase 17 اضافه شد:
// ممیزی نشان داد ابطال سند خرید، سند انبار، سند برگشت، دریافت طلا و انتقال طلا
// می‌توانست **بی‌هیچ هشداری** موجودی انبار را منفی کند (services/inventory.js →
// VoidShortageError). گارد در لایه‌ی سرویس گذاشته شد، ولی اگر UI فقط خطا را نشان
// دهد، ابطالِ درست هم غیرممکن می‌شود — و کاربر با یک سند اشتباه گیر می‌افتد.
//
// سیاست مستند پروژه (INVENTORY_RULES §۵) همین‌جاست: **هشدار + تأیید صریح**، نه
// بلاک. تنها استثنا فروش است که همچنان بلاک کامل دارد.
//
// هر شش نقطه‌ی ابطال در UI از همین تابع استفاده می‌کنند تا متن و رفتار یکی بماند.
// ═══════════════════════════════════════════════════════════════════════════

import { confirmDialog } from '../../components/ConfirmDialog.js';
import { formatGrams } from '../../utils/format.js';
import { VoidShortageError } from '../../services/inventory.js';
import { GOLD_TYPE_LABELS } from './docLabels.js';

/**
 * یک عملیات ابطال را اجرا می‌کند و اگر موجودی کافی نبود، پیش از ادامه تأیید می‌گیرد.
 * @param {(options: {allowNegative?: boolean}) => Promise<any>} run تابع ابطال
 * @returns {Promise<{done: boolean, result?: any}>} done=false یعنی کاربر انصراف داد
 */
export async function runVoidWithShortageGuard(run) {
  try {
    return { done: true, result: await run({}) };
  } catch (err) {
    if (!(err instanceof VoidShortageError)) throw err;

    const lines = err.shortages
      .map(
        (s) =>
          `${GOLD_TYPE_LABELS[s.goldType] || s.goldType || 'طلا'} عیار ${s.karat ?? '—'}: ` +
          `موجودی ${formatGrams(s.available)}، این ابطال ${formatGrams(s.requested)} خارج می‌کند ` +
          `(کسری ${formatGrams(s.shortfall)})`
      )
      .join('\n');

    const proceed = await confirmDialog({
      title: 'موجودی طلا کافی نیست',
      message: `${lines}\n\n${err.operation} موجودی انبار را منفی می‌کند. ادامه می‌دهید؟`,
      confirmLabel: 'بله، ادامه بده',
      danger: true,
    });
    if (!proceed) return { done: false };

    return { done: true, result: await run({ allowNegative: true }) };
  }
}
