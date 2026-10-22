// ReportView.js — رندرکننده‌ی عمومی خروجی گزارش (Phase 14)
// هیچ منطق محاسباتی ندارد؛ فقط ساختار `services/reports/model.js` را به DOM تبدیل می‌کند.
import { Table } from '../../components/Table.js';
import { Alert } from '../../components/Alert.js';
import { EmptyState } from '../../components/EmptyState.js';
import { sectionTitle, summaryItem } from '../docs/docFormParts.js';
import { formatCell, formatSummary, NUMERIC_KINDS } from './reportFormat.js';

export function ReportView(report) {
  const wrap = document.createElement('div');
  wrap.className = 'report';
  wrap.dataset.reportKey = report.key || '';

  const head = document.createElement('div');
  head.className = 'report__head';
  const title = document.createElement('h2');
  title.className = 'report__title';
  title.textContent = report.title;
  const range = document.createElement('div');
  range.className = 'report__range';
  range.textContent = report.rangeLabel || '';
  head.append(title, range);
  wrap.appendChild(head);

  if (report.needsParam) {
    wrap.appendChild(EmptyState({ icon: '👆', title: report.notes?.[0] || 'یک مورد انتخاب کنید' }));
    return wrap;
  }

  if (report.summary?.length) {
    const bar = document.createElement('div');
    bar.className = 'summary-bar report__summary';
    for (const item of report.summary) bar.appendChild(summaryItem(item.label, formatSummary(item), item.variant || ''));
    wrap.appendChild(bar);
  }

  for (const sec of report.sections || []) {
    const box = document.createElement('section');
    box.className = 'section report__section';
    box.dataset.sectionKey = sec.key;
    box.appendChild(sectionTitle(sec.title));
    const columns = sec.columns.map((c) => ({
      header: c.header,
      numeric: NUMERIC_KINDS.has(c.kind),
      cell: (row) => formatCell(c.kind, row[c.key], { total: row === sec.totals }),
    }));
    box.appendChild(
      Table({
        columns,
        rows: sec.rows,
        footer: sec.totals,
        rowClass: (row) => (row.strong || row.subtotal ? 'report-row--strong' : ''),
        emptyTitle: sec.emptyTitle,
      })
    );
    if (sec.note) {
      const note = document.createElement('p');
      note.className = 'report__note';
      note.textContent = sec.note;
      box.appendChild(note);
    }
    wrap.appendChild(box);
  }

  if (report.notes?.length) {
    const notes = document.createElement('div');
    notes.className = 'report__notes';
    for (const n of report.notes) notes.appendChild(Alert({ variant: 'info', message: n }));
    wrap.appendChild(notes);
  }
  return wrap;
}
