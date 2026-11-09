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
export function paintSheet(ctx, model, width = SHEET_IMAGE_WIDTH) {
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
  ctx.fillStyle = '#111111';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 2;
  ctx.direction = 'rtl';
  ctx.textBaseline = 'middle';

  // سربرگ
  font(24);
  text(model.header.invocation, right, y + 20);
  font(40, true);
  text(model.header.title, left + inner / 2, y + 26, 'center');
  font(24);
  text(`${toPersianDigits(model.dateJalali)} ${model.weekday}`, left + 200, y + 16, 'center');
  text(toPersianDigits(model.number), left + 200, y + 56, 'center');
  y += 96;

  // طرف حساب
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
  headers.forEach((h, i) => text(h, cellCenter(i), y + headH / 2, 'center'));
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
  return y + MARGIN;
}

/** Blob تصویر برگه، یا null اگر مرورگر canvas ندارد. */
export async function buildSheetImage(model) {
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
  const height = paintSheet(ctx, model);
  canvas.height = Math.ceil(height); // تغییر اندازه بوم را پاک می‌کند؛ پس دوباره می‌کشیم
  paintSheet(ctx, model);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
