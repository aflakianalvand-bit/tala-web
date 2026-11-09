// StatementSheet.js — پیش‌نمایش، ارسال و چاپ صورت‌حساب ریز شخص (Phase 31).
import { Button } from '../../components/Button.js';
import { showToast } from '../../components/Toast.js';
import { buildPartyStatement } from '../../services/statementSheet.js';
import { SIDE_WORDS } from '../../services/ledgerSummary.js';
import { toPersianDigits } from '../../utils/format.js';
import { deliverFile } from '../../utils/download.js';
import { gramsText } from '../docs/sheetFormat.js';
import { buildCanvasImage, paintStatement } from '../docs/sheetImage.js';

const g = (v) => (v ? gramsText(v, 3) : '');
const bal = (v, side) => (side === 'zero' ? SIDE_WORDS.zero : `${gramsText(v, 3)} ${SIDE_WORDS[side]}`);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function renderStatement(model) {
  const root = el('div', 'stmt');
  root.setAttribute('dir', 'rtl');
  root.append(el('div', 'stmt__invocation', model.header.invocation), el('div', 'stmt__title', `صورت‌حساب ${model.party.name}`));
  root.appendChild(el('div', 'stmt__meta', `${model.kindLabel} · کد ${toPersianDigits(model.party.code || '—')} · تاریخ ${toPersianDigits(model.printedAt)}`));
  const table = el('table', 'stmt__table');
  const head = el('tr');
  ['تاریخ', 'سند', 'بد', 'بس', 'مانده'].forEach((h) => head.appendChild(el('th', '', h)));
  table.appendChild(head);
  for (const m of model.months) {
    const title = el('tr', 'stmt__month');
    const td = el('td', '', m.label);
    td.colSpan = 5;
    title.appendChild(td);
    table.appendChild(title);
    for (const r of m.rows) {
      const tr = el('tr');
      [toPersianDigits(r.date), r.doc, g(r.debit), g(r.credit), bal(r.balance, r.side)].forEach((c) => tr.appendChild(el('td', '', toPersianDigits(c))));
      table.appendChild(tr);
    }
    const sum = el('tr', 'stmt__sum');
    [`جمع ${m.label}`, '', g(m.debit), g(m.credit), bal(m.closing, m.closingSide)].forEach((c, i) => sum.appendChild(el('td', '', i ? c : c)));
    table.appendChild(sum);
  }
  root.appendChild(table);
  root.appendChild(el('div', 'stmt__final', `جمع بد ${gramsText(model.debit, 3)} · جمع بس ${gramsText(model.credit, 3)} · مانده نهایی: ${bal(model.closing, model.closingSide)} (گرم ۷۵۰)`));
  return root;
}

export async function openStatementSheet(kind, id) {
  const model = await buildPartyStatement(kind, id);
  const overlay = el('div', 'sheet-overlay');
  const toolbar = el('div', 'sheet-toolbar');
  const host = el('div', 'stmt-host');
  host.appendChild(renderStatement(model));
  overlay.append(toolbar, host);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const image = buildCanvasImage((ctx, width) => paintStatement(ctx, model, width)).catch((err) => {
    console.error('[StatementSheet] image', err);
    return null;
  });
  const actions = el('div', 'sheet-toolbar__actions');
  actions.append(
    Button({
      label: 'ارسال / اشتراک',
      onClick: async () => {
        const blob = await image;
        if (!blob) return showToast('ساخت تصویر در این مرورگر ممکن نشد.', { variant: 'warning' });
        await deliverFile(blob, `Statement_${String(model.party.code || id).replace(/[^a-zA-Z0-9_-]/g, '-')}.png`, 'image/png');
      },
    }),
    Button({ label: 'بستن', variant: 'secondary', onClick: close })
  );
  toolbar.appendChild(actions);
}
