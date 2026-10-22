// More.js — «همه‌ی بخش‌ها» (Phase 25)
//
// تا Phase 24 این صفحه منوی «بیشتر» نوار پایین بود. نوار پایین چهارقسمتی شد و
// «بیشتر» حذف شد؛ مسیر `/more` اما نگه داشته شد تا نشانک یا میان‌بری که کاربر
// ساخته نشکند. حالا نقشه‌ی کامل برنامه است: هر صفحه زیر همان آیتم نوار پایینی
// که در واقع به آن تعلق دارد — از navigation.js، پس هرگز از نقشه عقب نمی‌ماند.
import { NAV_TABS, childrenOf } from '../navigation.js';
import { NavTiles } from './nav/NavTiles.js';

export default function MorePage() {
  const wrap = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'همه‌ی بخش‌ها';
  header.appendChild(h1);
  wrap.appendChild(header);

  for (const tab of NAV_TABS) {
    const section = document.createElement('section');
    section.className = 'section';
    const title = document.createElement('h2');
    title.className = 'section__title';
    title.textContent = tab.label;
    section.appendChild(title);
    const paths = [tab.path, ...childrenOf(tab.path).map((p) => p.path).filter((p) => p !== '/more')];
    section.appendChild(NavTiles(paths, { variant: 'grid', label: tab.label }));
    wrap.appendChild(section);
  }
  return wrap;
}
