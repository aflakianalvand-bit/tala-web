// sheetImage.js — برگه‌ی سند به‌صورت تصویر PNG برای ارسال (واتساپ، تلگرام، پیامک، چاپ).
//
// چرا روی canvas و از روی مدل، نه عکس گرفتن از DOM: تبدیل HTML به تصویر بدون کتابخانه فقط با
// SVG foreignObject ممکن است و Safari بوم حاصل را آلوده می‌کند (toBlob خطا می‌دهد). مدل برگه
// همان buildDocSheet است؛ هیچ عددی اینجا محاسبه نمی‌شود.
import { toPersianDigits } from '../../utils/format.js';
import { gramsText, sideGrams, rialText } from './sheetFormat.js';

export const SHEET_IMAGE_WIDTH = 1240;
const MARGIN = 56;
const FONT = 'Vazirmatn, Tahoma, sans-serif';
const COLS = [0.08, 0.33, 0.09, 0.15, 0.1, 0.11, 0.14]; // همان ستون‌های برگه، از راست
const MIN_ROWS = 8;

/** طرح‌های برگه؛ متن همه یکی است و فقط نما فرق می‌کند. */
export const SHEET_TEMPLATES = [
  { key: 'simple', label: 'ساده' },
  { key: 'classic', label: 'کلاسیک' },
  { key: 'modern', label: 'مدرن' },
  { key: 'formal', label: 'رسمی' },
];
const STYLE = {
  simple: { ink: '#111111', line: '#111111', head: null, headInk: '#111111', band: null, bandInk: '#111111', frame: null, box: null, titleInk: '#111111' },
  classic: { ink: '#2b2110', line: '#a8842f', head: '#f4ead0', headInk: '#5a4312', band: null, bandInk: '#2b2110', frame: '#a8842f', box: '#fbf5e4', titleInk: '#7a5a14' },
  modern: { ink: '#1c1c1e', line: '#d8d8dd', head: '#f2f2f7', headInk: '#1c1c1e', band: '#1c1c1e', bandInk: '#ffffff', frame: null, box: '#f2f2f7', titleInk: '#ffffff' },
  formal: { ink: '#14233a', line: '#1f3a5f', head: '#1f3a5f', headInk: '#ffffff', band: null, bandInk: '#14233a', frame: '#1f3a5f', box: '#e9eef5', titleInk: '#1f3a5f' },
};

/** شکستن متن به خطوط هم‌عرض ستون. */
function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/**
 * برگه را روی یک context می‌کشد و ارتفاع مصرف‌شده را برمی‌گرداند.
 * خالص نسبت به مرورگر، تا تست با یک context ساختگی متن‌ها را بررسی کند.
 */
export function paintSheet(ctx, model, width = SHEET_IMAGE_WIDTH, template = 'simple') {
  const T = STYLE[template] || STYLE.simple;
  const dec = model.decimals;
  const left = MARGIN;
  const right = width - MARGIN;
  const inner = right - left;
  let y = MARGIN;

  const font = (size, bold = false) => { ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`; };
  const text = (s, x, baseY, align = 'right') => {
    ctx.textAlign = align;
    ctx.fillText(String(s ?? ''), x, baseY);
  };
  const line = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  const box = (x, top, w, h) => ctx.strokeRect(x, top, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, 100000);
  ctx.fillStyle = T.ink;
  ctx.strokeStyle = T.line;
  ctx.lineWidth = 2;
  const fill = (color, x, top, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, top, w, h);
    ctx.fillStyle = T.ink;
  };
  if (T.band) fill(T.band, 0, 0, width, 176);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';

  // سربرگ
  ctx.fillStyle = T.bandInk;
  font(24);
  text(model.header.invocation, right, y + 20);
  ctx.fillStyle = T.titleInk;
  font(40, true);
  text(model.header.title, left + inner / 2, y + 26, 'center');
  ctx.fillStyle = T.bandInk;
  font(24);
  text(`${toPersianDigits(model.dateJalali)} ${model.weekday}`, left + 200, y + 16, 'center');
  text(toPersianDigits(model.number), left + 200, y + 56, 'center');
  ctx.fillStyle = T.ink;
  y += T.band ? 136 : 96;

  // طرف حساب
  if (T.box) fill(T.box, left, y, inner, 60);
  box(left, y, inner, 60);
  font(26, true);
  text(`حساب: ${model.party.name || '—'}   کد: ${model.party.code ? toPersianDigits(model.party.code) : '—'}`, right - 18, y + 30);
  text(model.typeLabel, left + 18, y + 30, 'left');
  y += 76;

  if (model.voided) {
    font(26, true);
    text('این سند باطل شده است و اثر مالی ندارد.', right, y + 18);
    y += 48;
  }

  // جدول
  const widths = COLS.map((c) => c * inner);
  const xs = [];
  let cursor = right;
  for (const w of widths) { xs.push(cursor); cursor -= w; }
  const cellCenter = (i) => xs[i] - widths[i] / 2;
  const headers = ['ردیف', 'شرح', 'عیار', `وزن ${toPersianDigits(model.baseMille)}`, 'وزن', 'فی', 'مبلغ (ریال)'];
  const tableTop = y;
  const headH = 54;
  font(22, true);
  if (T.head) fill(T.head, left, y, inner, headH);
  ctx.fillStyle = T.headInk;
  headers.forEach((h, i) => text(h, cellCenter(i), y + headH / 2, 'center'));
  ctx.fillStyle = T.ink;
  y += headH;
  line(left, y, right, y);

  const rows = [
    ...model.rows.map((r) => ({
      cells: [toPersianDigits(r.seq), '', r.karatMille ? toPersianDigits(r.karatMille) : '', sideGrams(r.sign > 0 ? 'debit' : 'credit', r.grams, dec), gramsText(r.grams, dec), r.ratePerGram ? rialText(r.ratePerGram) : '', r.amountIRR ? rialText(r.amountIRR) : ''],
      desc: r.note ? `${r.description} (${r.note})` : r.description,
      bold: false,
    })),
    ...model.summary.map((r) => ({
      cells: ['', '', r.karatMille ? toPersianDigits(r.karatMille) : '', sideGrams(r.sign > 0 ? 'debit' : 'credit', r.grams, dec), gramsText(r.grams, dec), '', ''],
      desc: `*** ${r.description}`,
      bold: true,
    })),
  ];
  const lineH = 32;
  for (const row of rows) {
    font(22, row.bold);
    const descLines = wrap(ctx, row.desc, widths[1] - 20);
    const h = Math.max(52, descLines.length * lineH + 20);
    row.cells.forEach((c, i) => { if (c) text(c, cellCenter(i), y + h / 2, 'center'); });
    descLines.forEach((l, i) => text(l, xs[1] - 10, y + 10 + lineH * i + lineH / 2));
    y += h;
    line(left, y, right, y);
  }
  for (let i = rows.length; i < MIN_ROWS; i += 1) {
    y += 40;
    line(left, y, right, y);
  }
  box(left, tableTop, inner, y - tableTop);
  xs.slice(1).forEach((x) => line(x, tableTop, x, y));
  y += 18;

  // مانده
  if (T.box) fill(T.box, left, y, inner, 60);
  box(left, y, inner, 60);
  font(26, true);
  text(`مانده این سند: ${sideGrams(model.docBalance.side, model.docBalance.grams, dec)}`, right - 18, y + 30);
  font(22);
  text(`زمان: ${toPersianDigits(model.stamp)}`, left + 18, y + 30, 'left');
  y += 78;

  font(26, true);
  text(`قبل: ${sideGrams(model.previousBalance.side, model.previousBalance.grams, dec)}`, right, y + 18);
  text(`نهایی: ${sideGrams(model.finalBalance.side, model.finalBalance.grams, dec)}`, left + inner / 2, y + 18);
  y += 58;

  font(20);
  for (const l of wrap(ctx, model.header.terms, inner)) {
    text(l, right, y + 15);
    y += 32;
  }
  y += 40;
  font(22);
  text(`صادر کننده سند: ${model.header.issuer}`, right, y);
  text('گیرنده سند:', left, y, 'left');
  const height = y + MARGIN;
  if (T.frame) {
    ctx.strokeStyle = T.frame;
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, width - 40, height - 40);
    if (template === 'classic') {
      ctx.lineWidth = 1.5;
      ctx.strokeRect(30, 30, width - 60, height - 60);
    }
  }
  return height;
}

/** صورت‌حساب ریز روی بوم. */
export function paintStatement(ctx, model, width = SHEET_IMAGE_WIDTH) {
  const left = MARGIN;
  const right = width - MARGIN;
  const inner = right - left;
  const COLS2 = [0.17, 0.35, 0.14, 0.14, 0.2];
  const words = { debit: 'بد', credit: 'بس', zero: 'تسویه' };
  const bal = (v, side) => (side === 'zero' ? words.zero : `${gramsText(v, 3)} ${words[side]}`);
  const g = (v) => (v ? gramsText(v, 3) : '');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, 100000);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#c9c9ce';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = '#111111';
  const font = (size, bold) => { ctx.font = `${bold ? 700 : 400} ${size}px ${FONT}`; };
  const text = (s, x, yy, align = 'center') => { ctx.textAlign = align; ctx.fillText(String(s ?? ''), x, yy); };
  let y = MARGIN;
  font(22); text(model.header.invocation, width / 2, y + 12);
  y += 46;
  font(38, true); text(`صورت‌حساب ${model.party.name}`, width / 2, y + 20);
  y += 58;
  font(22); text(`${model.kindLabel} · کد ${toPersianDigits(model.party.code || '—')} · تاریخ ${toPersianDigits(model.printedAt)}`, width / 2, y + 12);
  y += 44;
  const xs = [];
  let c = right;
  for (const w of COLS2) { xs.push(c - (w * inner) / 2); c -= w * inner; }
  const row = (cells, h, bold, bg) => {
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(left, y, inner, h); ctx.fillStyle = '#111111'; }
    font(21, bold);
    cells.forEach((t, i) => text(toPersianDigits(t), xs[i], y + h / 2));
    y += h;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  };
  row(['تاریخ', 'سند', 'بد', 'بس', 'مانده'], 52, true, '#f2f2f7');
  for (const m of model.months) {
    ctx.fillStyle = '#f6ebd3'; ctx.fillRect(left, y, inner, 46); ctx.fillStyle = '#6b4b00';
    font(23, true); text(m.label, right - 16, y + 23, 'right'); ctx.fillStyle = '#111111';
    y += 46;
    for (const r of m.rows) row([r.date, r.doc, g(r.debit), g(r.credit), bal(r.balance, r.side)], 46, false);
    row([`جمع ماه`, '', g(m.debit), g(m.credit), bal(m.closing, m.closingSide)], 48, true, '#fafafc');
  }
  y += 24;
  font(26, true);
  text(`جمع بد ${gramsText(model.debit, 3)}   جمع بس ${gramsText(model.credit, 3)}   مانده نهایی ${bal(model.closing, model.closingSide)}`, width / 2, y + 16);
  return y + 40 + MARGIN;
}

/** Blob تصویر برگه، یا null اگر مرورگر canvas ندارد. */
export async function buildSheetImage(model, template = 'simple') {
  return buildCanvasImage((ctx, width) => paintSheet(ctx, model, width, template));
}

export async function buildCanvasImage(paint) {
  const canvas = document.createElement('canvas');
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return null;
  // بدون این، بوم پیش از آماده‌شدن Vazirmatn با فونت جایگزین کشیده می‌شود.
  try {
    await Promise.all([document.fonts.load(`400 24px Vazirmatn`), document.fonts.load(`700 24px Vazirmatn`)]);
  } catch { /* فونت جایگزین بهتر از نبودن تصویر است */ }
  canvas.width = SHEET_IMAGE_WIDTH;
  canvas.height = 6000;
  const height = paint(ctx, SHEET_IMAGE_WIDTH);
  canvas.height = Math.ceil(height); // تغییر اندازه بوم را پاک می‌کند؛ پس دوباره می‌کشیم
  paint(ctx, SHEET_IMAGE_WIDTH);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
