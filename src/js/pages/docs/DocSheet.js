// DocSheet.js — رندر و چاپ «برگه‌ی سند طلایی» (A5) — Phase 18
//
// ═══════════════════════════════════════════════════════════════════════════
// هیچ محاسبه‌ای اینجا انجام نمی‌شود؛ تمام اعداد از services/docSheet.js می‌آیند.
// این فایل فقط همان مدل را به DOM تبدیل می‌کند و پنجره‌ی چاپ را باز می‌کند.
//
// چرا پیش‌نمایش تمام‌صفحه و نه چاپ مستقیم: کاربر باید **پیش از** مصرف کاغذ
// ببیند چه چاپ می‌شود؛ و برای اسنادی که «فی» ندارند باید بتواند نرخ تبدیل را
// همان‌جا وارد کند. برگه‌ی روی صفحه دقیقاً همان مارک‌آپی است که چاپ می‌شود،
// پس چیزی که دیده شده با چیزی که چاپ می‌شود یکی است.
// ═══════════════════════════════════════════════════════════════════════════

import { Button } from '../../components/Button.js';
import { Input } from '../../components/Input.js';
import { showToast } from '../../components/Toast.js';
import { buildDocSheet } from '../../services/docSheet.js';
import { SIDE_LABELS } from '../../services/goldAccount.js';
import { SHEET_DECIMALS } from '../../services/goldEquivalent.js';
import { toPersianDigits, formatNumber } from '../../utils/format.js';

/** حداقل تعداد ردیف جدول، تا برگه‌ی کم‌قلم هم قاب کامل داشته باشد (مثل نمونه). */
const MIN_TABLE_ROWS = 13;

/** عرض A5 بر حسب px در ۹۶dpi — همان ۱۴۸mm که در print.css تعریف شده.
 *  اگر عرض برگه در CSS عوض شد، این عدد هم باید عوض شود. */
const SHEET_WIDTH_PX = (148 / 25.4) * 96;

/**
 * برگه را در عرض موجود جا می‌دهد.
 *
 * چرا در JS و نه در CSS: مقیاس لازم نسبتِ «عرض موجود ÷ عرض A5» است و CSS
 * نمی‌تواند طول را بر طول تقسیم کند (`calc(100vw / 148mm)` نامعتبر است).
 * هرگز بزرگ‌نمایی نمی‌کند (سقف ۱) تا روی دسکتاپ برگه دقیقاً اندازه‌ی کاغذ بماند.
 */
function fitSheet(host) {
  if (!host) return;
  const available = host.clientWidth;
  if (!available) return; // هنوز در DOM جا نگرفته — فراخوانی بعدی درستش می‌کند.
  const scale = Math.min(1, available / SHEET_WIDTH_PX);
  host.style.setProperty('--sheet-scale', String(Math.round(scale * 1000) / 1000));
}

/** «۱۲/۶۸» — ارقام فارسی با ممیز «/»، دقیقاً سبک نمونه. */
// Phase 22: تعداد اعشار از خودِ مدل برگه می‌آید (سند قدیمی ۲ رقم، سند جدید ۳ رقم)،
// تا برگه‌ی یک سند قدیمی دقیقاً مثل قبل چاپ شود. renderDocSheet همگام است و پیش از
// هر فراخوانی gramsText این مقدار را تنظیم می‌کند.
let sheetDecimals = SHEET_DECIMALS;

function gramsText(value) {
  const n = Number(value) || 0;
  return toPersianDigits(n.toFixed(sheetDecimals)).replace('.', '/');
}

function sideGrams(side, grams) {
  const label = SIDE_LABELS[side] || '';
  const text = gramsText(grams);
  return label ? `${label} ${text}` : text;
}

function rialText(value) {
  if (value === null || value === undefined || value === '') return '';
  return toPersianDigits(formatNumber(Math.round(Number(value) || 0), { maximumFractionDigits: 0 }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function metaBox(label, value) {
  const box = el('div', 'sheet__meta-box');
  box.append(el('span', '', label), el('span', 'num', value));
  return box;
}

function cell(row, text, cls = '') {
  const td = el('td', cls, text);
  row.appendChild(td);
  return td;
}

/** مدل برگه → گره DOM. خالص و بدون دسترسی به دیتابیس (تست‌پذیر). */
export function renderDocSheet(model) {
  sheetDecimals = Number.isInteger(model?.decimals) ? model.decimals : SHEET_DECIMALS;
  const sheet = el('div', 'sheet');
  sheet.setAttribute('dir', 'rtl');

  // ── سربرگ ──
  const top = el('div', 'sheet__top');
  top.append(
    el('div', 'sheet__invocation', model.header.invocation),
    el('div', 'sheet__title', model.header.title)
  );
  const meta = el('div', 'sheet__meta');
  meta.append(
    metaBox('تاریخ:', `${toPersianDigits(model.dateJalali)} ${model.weekday}`),
    metaBox('شماره سند:', toPersianDigits(model.number))
  );
  top.appendChild(meta);
  sheet.appendChild(top);

  // ── طرف حساب ──
  const party = el('div', 'sheet__party');
  const left = el('div', 'sheet__party-type', model.typeLabel);
  const right = el('div');
  right.append(
    el('span', '', `حساب: ${model.party.name || '—'}`),
    el('span', '', '   '),
    el('span', '', `کد: ${model.party.code ? toPersianDigits(model.party.code) : '—'}`)
  );
  party.append(right, left);
  sheet.appendChild(party);

  if (model.voided) {
    sheet.appendChild(el('div', 'sheet__warning', 'این سند باطل شده است و اثر مالی ندارد.'));
  }
  if (model.needsRate) {
    sheet.appendChild(
      el(
        'div',
        'sheet__warning',
        'برای تبدیل مبالغ ریالی این سند به طلا، «فی» لازم است و در سند ثبت نشده. فی را در نوار بالا وارد کنید.'
      )
    );
  }

  if (model.previousBalance.incomplete) {
    sheet.appendChild(
      el(
        'div',
        'sheet__warning',
        `مانده‌ی «قبل» کامل نیست: این اسناد فی ندارند و مبلغ ریالی‌شان به طلا تبدیل نشده — ${model.previousBalance.missingRateDocs.join('، ')}`
      )
    );
  }

  // ── جدول ──
  const table = el('table', 'sheet__table');
  const colgroup = document.createElement('colgroup');
  ['8%', '33%', '9%', '15%', '10%', '11%', '14%'].forEach((w) => {
    const col = document.createElement('col');
    col.style.width = w;
    colgroup.appendChild(col);
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const baseLabel = `وزن ${toPersianDigits(model.baseMille)}`;
  ['ردیف', 'شرح', 'عیار', baseLabel, 'وزن', 'فی', 'مبلغ (ریال)'].forEach((h) => {
    headRow.appendChild(el('th', '', h));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let printedRows = 0;

  for (const row of model.rows) {
    const tr = document.createElement('tr');
    cell(tr, toPersianDigits(row.seq), 'c');
    const desc = cell(tr, '');
    desc.appendChild(el('span', '', row.description));
    if (row.note) {
      desc.appendChild(document.createElement('br'));
      desc.appendChild(el('span', 'sheet__row-note', `(${row.note})`));
    }
    cell(tr, row.karatMille ? toPersianDigits(row.karatMille) : '', 'c');
    cell(tr, sideGrams(row.sign > 0 ? 'debit' : 'credit', row.grams), 'c');
    cell(tr, gramsText(row.grams), 'c');
    cell(tr, row.ratePerGram ? rialText(row.ratePerGram) : '', 'n');
    cell(tr, row.amountIRR ? rialText(row.amountIRR) : '', 'n');
    tbody.appendChild(tr);
    printedRows += 1;
  }

  model.summary.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.className = `is-summary${i === 0 ? ' is-summary--first' : ''}`;
    cell(tr, '', 'c');
    cell(tr, `*** ${row.description}`);
    cell(tr, row.karatMille ? toPersianDigits(row.karatMille) : '', 'c');
    cell(tr, sideGrams(row.sign > 0 ? 'debit' : 'credit', row.grams), 'c');
    cell(tr, gramsText(row.grams), 'c');
    cell(tr, '', 'n');
    cell(tr, '', 'n');
    tbody.appendChild(tr);
    printedRows += 1;
  });

  for (let i = printedRows; i < MIN_TABLE_ROWS; i += 1) {
    const tr = document.createElement('tr');
    tr.className = 'is-filler';
    for (let c = 0; c < 7; c += 1) cell(tr, '');
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  sheet.appendChild(table);

  // ── مانده‌ی این سند ──
  const balance = el('div', 'sheet__balance');
  const balLeft = el('div', 'sheet__stamp', `زمان: ${toPersianDigits(model.stamp)}`);
  const balRight = el('div');
  balRight.append(
    el('span', '', 'مانده این سند: '),
    el('span', '', sideGrams(model.docBalance.side, model.docBalance.grams))
  );
  balance.append(balRight, balLeft);
  sheet.appendChild(balance);

  // ── قبل / نهایی + نرخ‌های مرجع ──
  const bottom = el('div', 'sheet__bottom');
  const prevFinal = el('div', 'sheet__prevfinal');
  const prevBox = el('div', 'sheet__prevfinal-box');
  prevBox.append(el('span', '', 'قبل:'), el('span', '', sideGrams(model.previousBalance.side, model.previousBalance.grams)));
  const finalBox = el('div', 'sheet__prevfinal-box');
  finalBox.append(el('span', '', 'نهایی:'), el('span', '', sideGrams(model.finalBalance.side, model.finalBalance.grams)));
  prevFinal.append(prevBox, finalBox);

  const refRates = el('div', 'sheet__refrates');
  refRates.appendChild(el('div', 'sheet__refrate-date', toPersianDigits(model.dateJalali)));
  const refs = [
    ['یک گرم طلا بدون اجرت:', model.footerRates.oneGramNoWage],
    ['یک مثقال طلای ۱۷ عیار:', model.footerRates.mesghal17],
    ['انس طلا:', model.footerRates.ounce],
  ];
  for (const [label, value] of refs) {
    const line = el('div', 'sheet__refrate');
    line.append(el('span', '', label), el('span', 'num', value ? rialText(value) : '—'));
    refRates.appendChild(line);
  }
  bottom.append(refRates, prevFinal);
  sheet.appendChild(bottom);

  // ── متن امانت و امضاها ──
  sheet.appendChild(el('div', 'sheet__terms', model.header.terms));
  const signs = el('div', 'sheet__signs');
  const issuer = el('div', 'sheet__sign-issuer');
  issuer.append(el('div', '', 'صادر کننده سند:'), el('div', '', model.header.issuer));
  signs.append(issuer, el('div', 'sheet__sign-receiver', 'گیرنده سند:'));
  sheet.appendChild(signs);

  return sheet;
}

/**
 * پیش‌نمایش و چاپ برگه‌ی یک سند.
 * @param {object} args `{kind, id}` — kind: sale | purchase | settlement | saleReturn
 */
export async function openDocSheet({ kind, id } = {}) {
  const overlay = el('div', 'sheet-overlay');
  const toolbar = el('div', 'sheet-toolbar');
  const sheetHost = el('div', 'sheet-host');
  overlay.append(toolbar, sheetHost);
  document.body.appendChild(overlay);

  let rateOverride = 0;

  function onResize() {
    fitSheet(sheetHost);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  }
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeydown);

  function print() {
    document.body.classList.add('is-printing-sheet');
    const cleanup = () => {
      document.body.classList.remove('is-printing-sheet');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    try {
      window.print();
    } catch (err) {
      console.error('[DocSheet] print', err);
      showToast('چاپ در این مرورگر ممکن نشد؛ از دکمه‌ی اشتراک‌گذاری سافاری استفاده کنید.', { variant: 'warning' });
    }
    // سافاری روی iOS گاهی afterprint نمی‌دهد؛ پاک‌سازی تأخیری تضمین می‌کند
    // برنامه در حالت «چاپ» گیر نکند.
    setTimeout(cleanup, 1500);
  }

  async function refresh() {
    sheetHost.innerHTML = '';
    let model;
    try {
      model = await buildDocSheet({ kind, id, rateOverride });
    } catch (err) {
      console.error('[DocSheet] build', err);
      sheetHost.appendChild(el('div', 'sheet', err?.message || 'ساخت برگه ناموفق بود.'));
      return;
    }
    sheetHost.appendChild(renderDocSheet(model));
    fitSheet(sheetHost);

    toolbar.innerHTML = '';
    const actions = el('div', 'sheet-toolbar__actions');
    actions.append(
      Button({ label: 'چاپ / ذخیره PDF', onClick: print }),
      Button({ label: 'بستن', variant: 'secondary', onClick: close })
    );

    const rateWrap = el('div', 'sheet-toolbar__rate');
    if (model.needsRate || model.rateFromOverride) {
      const field = Input({
        label: 'فی (ریال هر گرم ۷۵۰)',
        value: rateOverride ? String(rateOverride) : '',
        numeric: true,
        inputmode: 'numeric',
        onInput: (v) => {
          const n = Number(String(v).replace(/[^\d.]/g, ''));
          rateOverride = Number.isFinite(n) && n > 0 ? n : 0;
        },
      });
      const apply = Button({ label: 'اعمال', variant: 'secondary', onClick: () => refresh() });
      rateWrap.append(field, apply);
    }
    toolbar.append(rateWrap, actions);
  }

  await refresh();
  return { close, refresh };
}
