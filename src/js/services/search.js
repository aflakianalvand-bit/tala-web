// search.js — جستجوی سراسری بین اشخاص و اسناد (Phase 31). فقط‌خواندنی، روی همان فهرست‌های موجود.
import { listCustomers } from './customers.js';
import { listSuppliers } from './suppliers.js';
import { listSales } from './sales.js';
import { listPurchases } from './purchases.js';
import { toEnglishDigits } from '../utils/format.js';

const LIMIT = 8;

/** @returns {Promise<Array<{kind:string,id:string,title:string,subtitle:string}>>} */
export async function globalSearch(query) {
  const search = toEnglishDigits(String(query ?? '').trim());
  if (search.length < 2) return [];
  const [customers, suppliers, sales, purchases] = await Promise.all([
    listCustomers({ search, status: 'all' }),
    listSuppliers({ search, status: 'all' }),
    listSales({ search }),
    listPurchases({ search }),
  ]);
  const party = (kind, label) => (p) => ({ kind, id: p.id, title: p.name, subtitle: [label, p.code, p.phone].filter(Boolean).join(' · ') });
  return [
    ...customers.slice(0, LIMIT).map(party('customer', 'مشتری')),
    ...suppliers.slice(0, LIMIT).map(party('supplier', 'تأمین‌کننده')),
    ...sales.slice(0, LIMIT).map((s) => ({ kind: 'sale', id: s.id, title: s.number, subtitle: `فاکتور فروش · ${s.customerName}` })),
    ...purchases.slice(0, LIMIT).map((p) => ({ kind: 'purchase', id: p.id, title: p.number, subtitle: `سند خرید · ${p.supplierName || ''}` })),
  ];
}
