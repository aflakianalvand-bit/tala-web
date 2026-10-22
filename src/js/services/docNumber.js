// docNumber.js — شماره‌گذاری خودکار اسناد تجاری (Phase 6)
//
// تصمیم قطعی‌شده در Phase 6 (تصمیم باز از Phase 1):
//   الگو: `PREFIX-YYYY-NNNN` که YYYY سال **شمسی** تاریخ سند و NNNN شمارنده‌ی
//   چهاررقمی همان سال است (مثال: PU-1405-0001). هر سال شمسی از ۱ شروع می‌شود —
//   مطابق عرف دفاتر حسابداری ایران.
//
// چرا اینجا و نه داخل purchases.js؟ چون فروش (Phase 7)، دریافت و پرداخت
// (Phase 11) دقیقاً همین منطق را لازم دارند؛ نوشتن دوباره‌ی آن یعنی چند نسخه
// از یک قانون شماره‌گذاری که می‌توانند واگرا شوند (ARCHITECTURE §4.1).

import { getAll } from '../db/repo.js';
import { jalaliYearOf } from '../utils/date.js';

/** پیشوند اسناد — یک‌جا تعریف می‌شود تا در فازهای بعد پراکنده نشود. */
export const DOC_PREFIX = {
  purchases: 'PU',
  sales: 'SA',
  payments: 'PA',
  receipts: 'RC',
  saleReturns: 'SR', // (Phase 7) برگشت از فروش
  transfers: 'TR', // (Phase 9) انتقال بین حساب‌ها
  inventoryDocs: 'IV', // (Phase 10) سند انبار — پیشوند پیش‌فرض
  // (Phase 10) یک Store، دو نوع سند با شماره‌سری مستقل. چرا مستقل: «سومین اصلاح موجودی
  // امسال» و «سومین ذوب امسال» دو شمارنده‌ی معنادار برای کاربرند، نه یک سری درهم.
  'inventoryDocs:adjustment': 'AJ',
  'inventoryDocs:melt': 'ML',
};

/** پیشوند شماره سند برای یک Store (و در صورت وجود، نوع سند). */
export function prefixFor(store, kind = null) {
  if (kind && DOC_PREFIX[`${store}:${kind}`]) return DOC_PREFIX[`${store}:${kind}`];
  return DOC_PREFIX[store];
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

/**
 * شماره‌ی بعدی یک Store برای سال شمسیِ تاریخ داده‌شده.
 * تمام رکوردها (**شامل اسناد باطل‌شده**) اسکن می‌شوند تا یک شماره هرگز دوباره
 * استفاده نشود — همان قاعده‌ی کد کالا/مشتری (DATABASE_SCHEMA §3.1.1).
 */
export async function nextDocumentNumber(store, dateIso, { kind = null } = {}) {
  const prefix = prefixFor(store, kind);
  if (!prefix) throw new Error(`پیشوند شماره سند برای «${store}» تعریف نشده است.`);

  const year = jalaliYearOf(dateIso);
  const all = await getAll(store);
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const doc of all) {
    const m = re.exec(doc.number || '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${year}-${pad4(max + 1)}`;
}

/**
 * چند شماره‌ی پشت‌سرهم برای یک Store (مثلاً چند سند پرداخت در یک خرید چندپرداختی).
 * لازم است چون همه‌ی این اسناد در **یک** تراکنش نوشته می‌شوند و نمی‌توان بین
 * آن‌ها دوباره از دیتابیس خواند.
 */
export async function nextDocumentNumbers(store, dateIso, count, options = {}) {
  const first = await nextDocumentNumber(store, dateIso, options);
  const m = /^(.*-)(\d+)$/.exec(first);
  const head = m[1];
  const start = Number(m[2]);
  return Array.from({ length: count }, (_, i) => `${head}${pad4(start + i)}`);
}
