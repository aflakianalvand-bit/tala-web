// xlsx.js — نویسنده‌ی فایل .xlsx واقعی، بدون هیچ کتابخانه‌ی خارجی (Phase 15)
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا نوشته شد و چرا CSV کافی نبود:
//   یک فایل .xlsx در واقع یک آرشیو ZIP از چند فایل XML است. نوشتن آن با
//   TextEncoder و چند صد بایت هدر ZIP کاملاً شدنی است، و در مقابل:
//     • CSV نوع سلول ندارد ⇒ «۰۹۱۲…» به عدد تبدیل و صفر ابتدایی‌اش حذف می‌شود،
//       و مبلغ ۱۲٬۵۰۰٬۰۰۰ در بعضی تنظیمات منطقه‌ای به تاریخ تفسیر می‌شود.
//     • CSV جهت راست‌به‌چپ و چند Sheet ندارد ⇒ هر گزارش یک فایل جدا.
//     • CSV فارسی روی Excel ویندوز بدون BOM خراب می‌شود و با BOM هم در برخی
//       نسخه‌ها جداکننده را اشتباه می‌گیرد.
//   بنابراین این ماژول نوشته شد؛ «بدون Dependency غیرضروری» (دستور پروژه §3)
//   رعایت شد و در عوض همین فایل با تست پوشش داده می‌شود.
//
// فشرده‌سازی: روش `stored` (بدون Deflate). یک ZIP کاملاً معتبر است و Excel،
// Numbers و Google Sheets آن را باز می‌کنند؛ در ازای حجم بیشتر، هیچ پیاده‌سازی
// Deflate دست‌ساز (و ریسک باگش) وارد پروژه نمی‌شود.
//
// واژگان `kind` دقیقاً همان COL در services/reports/model.js است — قرارداد
// مشترکی که Phase 14 عمداً برای همین Phase گذاشته بود.
// ═══════════════════════════════════════════════════════════════════════════

import { formatJalaliDate } from './date.js';

// ─────────────────────────────── CRC-32 ───────────────────────────────
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

function crc32(bytes) {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────── ZIP ───────────────────────────────
const encoder = new TextEncoder();

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, date: day };
}

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }
  bytes(arr) {
    this.chunks.push(arr);
    this.length += arr.length;
  }
  u16(n) {
    this.bytes(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }
  u32(n) {
    this.bytes(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }
  finish() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * چند فایل را در یک آرشیو ZIP (روش stored) بسته‌بندی می‌کند.
 * (Phase 28) فایل دودویی (آیکون، فونت) با `bytes` داده می‌شود — برای بسته‌ی انتشار `tools/release.mjs`.
 * @param {Array<{name: string, content?: string, bytes?: Uint8Array}>} files
 * @param {Date} at زمان فایل‌ها (برای تکرارپذیری تست، قابل تعیین)
 * @returns {Uint8Array}
 */
export function zipFiles(files, at = new Date()) {
  const { time, date } = dosDateTime(at);
  const body = new ByteWriter();
  const central = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = file.bytes instanceof Uint8Array ? file.bytes : encoder.encode(file.content);
    const crc = crc32(data);
    const offset = body.length;

    body.u32(0x04034b50);       // local file header
    body.u16(20);               // version needed
    body.u16(0x0800);           // flags: نام فایل UTF-8
    body.u16(0);                // method: stored
    body.u16(time);
    body.u16(date);
    body.u32(crc);
    body.u32(data.length);      // compressed size = uncompressed (stored)
    body.u32(data.length);
    body.u16(nameBytes.length);
    body.u16(0);                // extra length
    body.bytes(nameBytes);
    body.bytes(data);

    central.push({ nameBytes, crc, size: data.length, offset });
  }

  const dir = new ByteWriter();
  for (const entry of central) {
    dir.u32(0x02014b50);        // central directory header
    dir.u16(20);                // version made by
    dir.u16(20);                // version needed
    dir.u16(0x0800);
    dir.u16(0);
    dir.u16(time);
    dir.u16(date);
    dir.u32(entry.crc);
    dir.u32(entry.size);
    dir.u32(entry.size);
    dir.u16(entry.nameBytes.length);
    dir.u16(0);                 // extra
    dir.u16(0);                 // comment
    dir.u16(0);                 // disk number start
    dir.u16(0);                 // internal attrs
    dir.u32(0);                 // external attrs
    dir.u32(entry.offset);
    dir.bytes(entry.nameBytes);
  }

  const out = new ByteWriter();
  const bodyBytes = body.finish();
  const dirBytes = dir.finish();
  out.bytes(bodyBytes);
  out.bytes(dirBytes);
  out.u32(0x06054b50);          // end of central directory
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(dirBytes.length);
  out.u32(bodyBytes.length);
  out.u16(0);
  return out.finish();
}

// ─────────────────────────────── XML ───────────────────────────────

/**
 * نویسه‌های کنترلی (کد کمتر از ۳۲ به‌جز Tab/LF/CR) در XML معتبر نیستند و یک
 * بایت از آن‌ها کل فایل را برای Excel «خراب» می‌کند. عمداً حلقه‌ی صریح به‌جای
 * Regex، تا دامنه‌ی حذف در کد خوانا و قابل تست بماند.
 */
function stripControlChars(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    out += ch;
  }
  return out;
}

export function escapeXml(value) {
  return stripControlChars(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ۰ → A، ۲۵ → Z، ۲۶ → AA … */
export function columnLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * نام Sheet در Excel: حداکثر ۳۱ نویسه، بدون نویسه‌های ممنوع، و یکتا در فایل.
 * نام تکراری باعث می‌شود Excel کل فایل را «خراب» اعلام کند، پس یکتاسازی اجباری است.
 */
const FORBIDDEN_SHEET_CHARS = [':', '\\', '/', '?', '*', '[', ']'];

export function sanitizeSheetName(name, used = new Set()) {
  let base = String(name || 'Sheet');
  for (const ch of FORBIDDEN_SHEET_CHARS) base = base.split(ch).join(' ');
  base = base.trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  used.add(candidate);
  return candidate;
}

// ─────────────────────────── سبک‌ها (styles.xml) ───────────────────────────
// شماره‌ی هر xf در cellXfs — ترتیب زیر باید دقیقاً با STYLES_XML پایین بخواند.
const S = {
  DEFAULT: 0,
  HEADER: 1,
  IRR: 2,
  GRAMS: 3,
  COUNT: 4,
  PERCENT: 5,
  RATE: 6,
  KARAT: 7,
  BOLD_TEXT: 8,
  BOLD_IRR: 9,
  BOLD_GRAMS: 10,
  BOLD_COUNT: 11,
  BOLD_PERCENT: 12,
  BOLD_RATE: 13,
  BOLD_KARAT: 14,
  TITLE: 15,
  META_LABEL: 16,
};

const KIND_STYLE = {
  text: S.DEFAULT,
  date: S.DEFAULT,
  irr: S.IRR,
  grams: S.GRAMS,
  count: S.COUNT,
  percent: S.PERCENT,
  rate: S.RATE,
  karat: S.KARAT,
};

const KIND_STYLE_BOLD = {
  text: S.BOLD_TEXT,
  date: S.BOLD_TEXT,
  irr: S.BOLD_IRR,
  grams: S.BOLD_GRAMS,
  count: S.BOLD_COUNT,
  percent: S.BOLD_PERCENT,
  rate: S.BOLD_RATE,
  karat: S.BOLD_KARAT,
};

/** نوع‌هایی که سلولشان در Excel «عدد» است (نه متن) — جمع‌پذیر و قابل مرتب‌سازی. */
const NUMERIC_KINDS = new Set(['irr', 'grams', 'count', 'percent', 'rate', 'karat']);

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="#,##0.000"/><numFmt numFmtId="166" formatCode="#,##0.0"/><numFmt numFmtId="167" formatCode="#,##0.##"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E7CE"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="166" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ─────────────────────────── ساخت Sheet ───────────────────────────

function inlineCell(ref, style, text) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function cellXml(ref, value, kind, { bold = false } = {}) {
  const style = (bold ? KIND_STYLE_BOLD[kind] : KIND_STYLE[kind]) ?? (bold ? S.BOLD_TEXT : S.DEFAULT);
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}" s="${style}"/>`;
  }
  if (NUMERIC_KINDS.has(kind)) {
    const n = Number(value);
    if (!Number.isFinite(n)) return inlineCell(ref, style, value);
    // صفر منفی: «-0» در XML نوشته می‌شود و Excel هم همان را نشان می‌دهد
    // (همان مشکلی که ledger.js و model.js با normalizeZero/nz حل کرده‌اند).
    return `<c r="${ref}" s="${style}"><v>${n === 0 ? 0 : n}</v></c>`;
  }
  let text = value;
  if (kind === 'date') {
    const d = new Date(value);
    // تاریخ به‌صورت **متن شمسی** نوشته می‌شود: Excel تقویم جلالی ندارد و سلول
    // تاریخِ میلادی، تاریخ فارسیِ سند را برای کاربر بی‌معنا می‌کرد.
    text = Number.isNaN(d.getTime()) ? String(value) : formatJalaliDate(d);
  }
  return inlineCell(ref, style, text);
}

function sheetXml(sheet) {
  const columns = sheet.columns || [];
  const rows = [];
  let r = 0;
  const pushRow = (cells) => {
    r += 1;
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  };

  if (sheet.title) {
    pushRow([inlineCell('A1', S.TITLE, sheet.title)]);
  }
  for (const [label, value] of sheet.meta || []) {
    const n = r + 1;
    pushRow([inlineCell(`A${n}`, S.META_LABEL, label), inlineCell(`B${n}`, S.DEFAULT, value)]);
  }
  if (sheet.title || (sheet.meta || []).length) r += 1; // یک ردیف خالی بین سربرگ و جدول

  const headerRow = r + 1;
  pushRow(columns.map((c, i) => inlineCell(`${columnLetter(i)}${headerRow}`, S.HEADER, c.header)));

  for (const row of sheet.rows || []) {
    const n = r + 1;
    pushRow(columns.map((c, i) => cellXml(`${columnLetter(i)}${n}`, row[c.key], c.kind || 'text')));
  }

  if (sheet.totals) {
    const n = r + 1;
    pushRow(columns.map((c, i) => cellXml(`${columnLetter(i)}${n}`, sheet.totals[c.key], c.kind || 'text', { bold: true })));
  }

  const cols = columns
    .map((c, i) => {
      const width = c.width || Math.min(42, Math.max(12, String(c.header || '').length + 6));
      return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');

  // قفل ردیف سربرگ: در جدول‌های بلند، عنوان ستون‌ها هنگام اسکرول دیده می‌مانند.
  const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/>`;
  const dim = `A1:${columnLetter(Math.max(0, columns.length - 1))}${Math.max(1, r)}`;
  const colsXml = cols ? `<cols>${cols}</cols>` : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dim}"/><sheetViews><sheetView rightToLeft="1" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${rows.join('')}</sheetData></worksheet>`;
}

const CT_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const CT_SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
const CT_STYLES = 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * ساخت یک فایل .xlsx کامل.
 *
 * @param {Array<{name:string, title?:string, meta?:Array<[string,string]>,
 *                columns:Array<{key:string, header:string, kind?:string, width?:number}>,
 *                rows:Array<object>, totals?:object|null}>} sheets
 * @param {{createdAt?: Date}} options
 * @returns {Uint8Array} بایت‌های فایل
 */
export function buildWorkbook(sheets, { createdAt = new Date() } = {}) {
  const list = (sheets || []).filter(Boolean);
  if (!list.length) throw new Error('ساخت فایل Excel بدون هیچ Sheet ممکن نیست.');

  const used = new Set();
  const named = list.map((s, i) => ({ ...s, name: sanitizeSheetName(s.name || `Sheet${i + 1}`, used) }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT_MAIN}"/>${named
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT_SHEET}"/>`)
    .join('')}<Override PartName="/xl/styles.xml" ContentType="${CT_STYLES}"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS_REL}"><sheets>${named
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}<Relationship Id="rId${named.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;

  const files = [
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) })),
  ];

  return zipFiles(files, createdAt);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
