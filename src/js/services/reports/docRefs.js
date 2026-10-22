// docRefs.js — «این رکورد دفتر مال کدام سند است؟» (Phase 14)
//
// گردش حساب‌های صفحات جزئیات (Phase 4/9) فقط «دلیل» رکورد را نشان می‌دادند (فروش،
// دریافت…). گزارش گردش باید قابل رهگیری باشد (دستور پروژه §۲۸ Traceability)، پس هر
// ردیف شماره‌ی سند مبدأ را می‌خواهد. مسیر: رکورد دفتر → transaction → sourceType/sourceId
// → سند. این فایل آن مسیر را یک بار با خواندن کامل Storeها می‌سازد (نه یک کوئری برای
// هر ردیف) و فقط می‌خواند.

import { getAll } from '../../db/repo.js';
import { CASH_CATEGORY_LABELS } from '../cashFlow.js';

const SOURCE_STORES = {
  sale: 'sales',
  purchase: 'purchases',
  sale_return: 'saleReturns',
  receipt: 'receipts',
  payment: 'payments',
  transfer: 'transfers',
  inventoryDoc: 'inventoryDocs',
};

/** برچسب نوع سند — «گروه» گردش صندوق هم از همین می‌آید. */
export const DOC_KIND_LABELS = {
  sale: 'فاکتور فروش',
  purchase: 'سند خرید',
  sale_return: 'برگشت از فروش',
  receipt: 'دریافت',
  payment: 'پرداخت',
  deposit: 'واریز',
  withdrawal: 'برداشت',
  transfer: 'انتقال',
  adjustment: 'اصلاح موجودی',
  melt: 'ذوب / تبدیل',
  unknown: 'نامشخص',
};

function kindOf(tx, doc) {
  switch (tx?.sourceType) {
    case 'receipt':
      if (doc?.partyType === 'other') return 'deposit';
      return 'receipt';
    case 'payment':
      if (doc?.partyType === 'other') return 'withdrawal';
      return 'payment';
    case 'inventoryDoc':
      return doc?.kind === 'melt' ? 'melt' : 'adjustment';
    default:
      return SOURCE_STORES[tx?.sourceType] ? tx.sourceType : 'unknown';
  }
}

/**
 * سازنده‌ی تفکیک‌کننده. خروجی تابعی است که برای یک transactionId می‌گوید:
 * `{ kind, kindLabel, number, label, reversal, doc }`.
 */
export async function buildDocResolver() {
  const stores = [...new Set(Object.values(SOURCE_STORES))];
  const [transactions, ...docLists] = await Promise.all([getAll('transactions'), ...stores.map((s) => getAll(s))]);
  const txById = new Map(transactions.map((t) => [t.id, t]));
  const docsByStore = new Map(stores.map((s, i) => [s, new Map(docLists[i].map((d) => [d.id, d]))]));

  return function resolve(transactionId) {
    const tx = txById.get(transactionId);
    if (!tx) {
      return { kind: 'unknown', kindLabel: DOC_KIND_LABELS.unknown, number: '', label: '—', reversal: false, doc: null };
    }
    const store = SOURCE_STORES[tx.sourceType];
    const doc = store ? docsByStore.get(store).get(tx.sourceId) || null : null;
    const kind = kindOf(tx, doc);
    let kindLabel = DOC_KIND_LABELS[kind];
    if ((kind === 'deposit' || kind === 'withdrawal') && doc?.partyId) {
      kindLabel = `${kindLabel} (${CASH_CATEGORY_LABELS[doc.partyId] || doc.partyId})`;
    }
    const number = doc?.number || '';
    const reversal = Boolean(tx.isReversal);
    const label = `${reversal ? 'ابطال ' : ''}${kindLabel}${number ? ` ${number}` : ''}`;
    return { kind, kindLabel: DOC_KIND_LABELS[kind], number, label, reversal, doc };
  };
}
