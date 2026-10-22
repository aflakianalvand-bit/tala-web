// Table.js — جدول ساده از روی columns/rows؛ اگر rows خالی باشد EmptyState نشان می‌دهد.
// (Phase 14) دو گزینه‌ی اختیاری و سازگار با قبل:
//   footer   — یک ردیف جمع که با همان تابع‌های cell در <tfoot> رندر می‌شود
//   rowClass — تابعی که برای هر ردیف کلاس CSS اضافه برمی‌گرداند (مثلاً ردیف جمع جزء)
import { EmptyState } from './EmptyState.js';

function fillRow(tr, columns, row) {
  for (const col of columns) {
    const td = document.createElement('td');
    const cellValue = typeof col.cell === 'function' ? col.cell(row) : row[col.key];
    if (cellValue instanceof Node) {
      td.appendChild(cellValue);
    } else {
      td.textContent = cellValue ?? '';
    }
    if (col.numeric) td.classList.add('num');
    tr.appendChild(td);
  }
  return tr;
}

export function Table({ columns = [], rows = [], emptyTitle = 'داده‌ای موجود نیست', emptyDesc = '', footer = null, rowClass = null } = {}) {
  if (!rows.length) {
    return EmptyState({ title: emptyTitle, description: emptyDesc, icon: '📋' });
  }

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.header;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const extra = typeof rowClass === 'function' ? rowClass(row) : '';
    if (extra) tr.className = extra;
    tbody.appendChild(fillRow(tr, columns, row));
  }
  table.appendChild(tbody);

  if (footer) {
    const tfoot = document.createElement('tfoot');
    tfoot.appendChild(fillRow(document.createElement('tr'), columns, footer));
    table.appendChild(tfoot);
  }

  wrap.appendChild(table);
  return wrap;
}
