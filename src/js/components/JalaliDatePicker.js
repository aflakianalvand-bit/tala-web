// JalaliDatePicker.js — انتخاب تاریخ شمسی بدون کتابخانه (Phase 24)
//
// چرا به‌جای input[type=date]:
//   - انتخاب‌گر بومی iOS تقویم میلادی نشان می‌دهد («09/27/2026»)؛ کاربر این
//     کسب‌وکار با تاریخ شمسی کار می‌کند و هر تبدیل ذهنی یعنی احتمال سند با تاریخ غلط.
//   - ظاهر بومی با تم تیره/روشن برنامه هماهنگ نمی‌شد.
//
// قرارداد سازگاری (مهم‌ترین تصمیم این فایل):
//   `getInput()` همچنان یک <input> برمی‌گرداند که `.value` آن رشته‌ی
//   `YYYY-MM-DD` میلادی است و هنگام انتخاب، رویدادهای `input` و `change` را
//   می‌فرستد — دقیقاً مثل input[type=date]. پس هیچ فرم و هیچ سرویسی تغییر
//   نکرد و `fromDateInputValue()` همان ورودی قبلی را می‌گیرد. مقداردهی
//   برنامه‌ای (`getInput().value = …`) هم نمایش را به‌روز می‌کند.
//
// دسترس‌پذیری: دکمه‌ی فیلد با برچسب، دیالوگ `role="dialog"` + `aria-modal`،
// هر روز یک دکمه‌ی ≥ ۴۸px با aria-label کامل («شنبه ۵ مهر ۱۴۰۵»)، روز انتخاب‌شده
// `aria-pressed`، امروز `aria-current="date"`، کلیدهای جهت/PageUp/PageDown/Home/End/Esc.

import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  JALALI_WEEKDAYS_SHORT,
  isoKeyToJalali,
  jalaliToIsoKey,
  jalaliMonthGrid,
  jalaliMonthLength,
  jalaliWeekday,
  todayJalali,
  addJalaliDays,
  addJalaliMonths,
  sameJalali,
} from '../utils/jalaliCalendar.js';
import { toPersianDigits } from '../utils/format.js';

let uid = 0;
const fa = (n) => toPersianDigits(String(n));
const pad2 = (n) => String(n).padStart(2, '0');

/** «شنبه ۵ مهر ۱۴۰۵» */
export function jalaliLabel(j) {
  if (!j) return '';
  return `${JALALI_WEEKDAYS[jalaliWeekday(j.jy, j.jm, j.jd)]} ${fa(j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${fa(j.jy)}`;
}

/** «۱۴۰۵/۰۷/۰۵» */
export function jalaliNumeric(j) {
  if (!j) return '';
  return fa(`${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`);
}

/**
 * فیلد تاریخ شمسی با همان امضای Input({ type: 'date' }).
 * خروجی: wrapper با getInput() و getValue() (مقدار `YYYY-MM-DD` یا '').
 */
export function JalaliDateField({
  label,
  value = '',
  hint = '',
  error = '',
  required = false,
  placeholder = 'انتخاب تاریخ',
  onInput,
} = {}) {
  const id = `date-field-${++uid}`;
  const wrap = document.createElement('div');
  wrap.className = `field date-field${error ? ' field--invalid' : ''}`;

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'field__label';
    labelEl.setAttribute('for', id);
    labelEl.textContent = label + (required ? ' *' : '');
    wrap.appendChild(labelEl);
  }

  // مقدار واقعی — همان نقشی که input[type=date] داشت.
  const input = document.createElement('input');
  input.type = 'hidden';
  input.className = 'date-field__value';
  if (required) input.required = true;
  wrap.appendChild(input);

  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = 'input date-field__button';
  button.setAttribute('aria-haspopup', 'dialog');
  const text = document.createElement('span');
  text.className = 'date-field__text';
  const icon = document.createElement('span');
  icon.className = 'date-field__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📅';
  button.append(text, icon);
  wrap.appendChild(button);

  // مقداردهی برنامه‌ای (`input.value = …`) هم نمایش را همگام کند.
  const proto = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return proto.get.call(this); },
    set(v) { proto.set.call(this, isoKeyToJalali(v) ? String(v) : ''); render(); },
  });

  function render() {
    const j = isoKeyToJalali(proto.get.call(input));
    // عدد کوتاه روی دکمه (روی ستون باریک فرم در یک خط جا شود)؛ نام روز و ماه در aria-label.
    text.textContent = j ? jalaliNumeric(j) : placeholder;
    button.classList.toggle('date-field__button--empty', !j);
    button.setAttribute('aria-label', `${label || 'تاریخ'}: ${j ? jalaliLabel(j) : 'انتخاب نشده'}`);
  }

  input.value = value || '';

  function commit(next) {
    const before = proto.get.call(input);
    input.value = next || '';
    if (proto.get.call(input) === before) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (onInput) input.addEventListener('input', (e) => onInput(proto.get.call(input), e));

  button.addEventListener('click', () => {
    openJalaliPicker({
      value: proto.get.call(input),
      title: label || 'انتخاب تاریخ',
      allowClear: !required,
      returnFocus: button,
      onSelect: (key) => commit(key),
    });
  });

  if (hint && !error) {
    const hintEl = document.createElement('div');
    hintEl.className = 'field__hint';
    hintEl.textContent = hint;
    wrap.appendChild(hintEl);
  }
  if (error) {
    const errorEl = document.createElement('div');
    errorEl.className = 'field__error';
    errorEl.textContent = error;
    wrap.appendChild(errorEl);
  }

  wrap.getInput = () => input;
  wrap.getButton = () => button;
  wrap.getValue = () => proto.get.call(input);
  return wrap;
}

/**
 * برگه‌ی انتخاب تاریخ. خروجی: { close, root } — برای تست و بستن برنامه‌ای.
 * onSelect(key) با `YYYY-MM-DD` یا '' (پاک کردن) صدا زده می‌شود.
 */
export function openJalaliPicker({ value = '', title = 'انتخاب تاریخ', allowClear = false, onSelect, returnFocus, now = new Date() } = {}) {
  const today = todayJalali(now);
  const selected = isoKeyToJalali(value);
  let cursor = selected ? { ...selected } : { ...today };

  const overlay = document.createElement('div');
  overlay.className = 'jdp-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'jdp';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const titleId = `jdp-title-${++uid}`;
  dialog.setAttribute('aria-labelledby', titleId);
  overlay.appendChild(dialog);

  const head = document.createElement('div');
  head.className = 'jdp__head';
  const titleEl = document.createElement('div');
  titleEl.className = 'jdp__title';
  titleEl.id = titleId;
  titleEl.textContent = title;
  const current = document.createElement('div');
  current.className = 'jdp__current';
  head.append(titleEl, current);

  const nav = document.createElement('div');
  nav.className = 'jdp__nav';
  const prev = navButton('ماه قبل', '›');
  const next = navButton('ماه بعد', '‹');
  const monthSel = document.createElement('select');
  monthSel.className = 'select jdp__month';
  monthSel.setAttribute('aria-label', 'ماه');
  JALALI_MONTHS.forEach((m, i) => monthSel.appendChild(new Option(m, String(i + 1))));
  const yearSel = document.createElement('select');
  yearSel.className = 'select jdp__year';
  yearSel.setAttribute('aria-label', 'سال');
  nav.append(prev, monthSel, yearSel, next);

  const week = document.createElement('div');
  week.className = 'jdp__week';
  week.setAttribute('aria-hidden', 'true');
  JALALI_WEEKDAYS_SHORT.forEach((w, i) => {
    const c = document.createElement('span');
    c.textContent = w;
    if (i === 6) c.className = 'jdp__friday';
    week.appendChild(c);
  });

  const grid = document.createElement('div');
  grid.className = 'jdp__grid';
  grid.setAttribute('role', 'group');

  const foot = document.createElement('div');
  foot.className = 'jdp__foot';
  const todayBtn = footButton('امروز', 'btn--secondary');
  const cancelBtn = footButton('انصراف', 'btn--ghost');
  foot.append(todayBtn);
  if (allowClear) foot.append(footButton('پاک کردن', 'btn--ghost', () => choose('')));
  foot.append(cancelBtn);

  dialog.append(head, nav, week, grid, foot);

  function navButton(label, glyph) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jdp__navbtn';
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    return b;
  }
  function footButton(label, variant, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${variant}`;
    b.textContent = label;
    if (handler) b.addEventListener('click', handler);
    return b;
  }

  function fillYears() {
    const center = cursor.jy;
    const from = Math.min(center, today.jy) - 10;
    const to = Math.max(center, today.jy) + 5;
    yearSel.innerHTML = '';
    for (let y = from; y <= to; y++) yearSel.appendChild(new Option(fa(y), String(y)));
    yearSel.value = String(cursor.jy);
  }

  function render(focus = false) {
    monthSel.value = String(cursor.jm);
    fillYears();
    grid.setAttribute('aria-label', `${JALALI_MONTHS[cursor.jm - 1]} ${fa(cursor.jy)}`);
    current.textContent = selected ? jalaliLabel(selected) : 'تاریخی انتخاب نشده';
    grid.innerHTML = '';
    let focusEl = null;
    jalaliMonthGrid(cursor.jy, cursor.jm).forEach((d, i) => {
      if (d === null) {
        const blank = document.createElement('span');
        blank.className = 'jdp__blank';
        grid.appendChild(blank);
        return;
      }
      const j = { jy: cursor.jy, jm: cursor.jm, jd: d };
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jdp__day';
      if (i % 7 === 6) b.classList.add('jdp__day--friday');
      b.textContent = fa(d);
      b.dataset.day = String(d);
      b.setAttribute('aria-label', jalaliLabel(j));
      const isSel = sameJalali(j, selected);
      b.setAttribute('aria-pressed', isSel ? 'true' : 'false');
      if (isSel) b.classList.add('jdp__day--selected');
      if (sameJalali(j, today)) {
        b.classList.add('jdp__day--today');
        b.setAttribute('aria-current', 'date');
      }
      // فقط یک روز در ترتیب Tab (roving tabindex) — Tab از شبکه بیرون می‌رود.
      const isCursor = d === cursor.jd;
      b.tabIndex = isCursor ? 0 : -1;
      if (isCursor) focusEl = b;
      b.addEventListener('click', () => choose(jalaliToIsoKey(j.jy, j.jm, j.jd)));
      grid.appendChild(b);
    });
    if (focus && focusEl) focusEl.focus();
  }

  function moveTo(next, focus = true) {
    cursor = next;
    render(focus);
  }

  prev.addEventListener('click', () => moveTo(addJalaliMonths(cursor, -1), false));
  next.addEventListener('click', () => moveTo(addJalaliMonths(cursor, 1), false));
  monthSel.addEventListener('change', () => {
    const jm = Number(monthSel.value);
    moveTo({ jy: cursor.jy, jm, jd: Math.min(cursor.jd, jalaliMonthLength(cursor.jy, jm)) }, false);
  });
  yearSel.addEventListener('change', () => {
    const jy = Number(yearSel.value);
    moveTo({ jy, jm: cursor.jm, jd: Math.min(cursor.jd, jalaliMonthLength(jy, cursor.jm)) }, false);
  });
  todayBtn.addEventListener('click', () => choose(jalaliToIsoKey(today.jy, today.jm, today.jd)));
  cancelBtn.addEventListener('click', () => close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // جهت‌ها در RTL: «چپ» یعنی روز بعد.
  const KEYS = {
    ArrowLeft: (c) => addJalaliDays(c, 1),
    ArrowRight: (c) => addJalaliDays(c, -1),
    ArrowDown: (c) => addJalaliDays(c, 7),
    ArrowUp: (c) => addJalaliDays(c, -7),
    PageDown: (c) => addJalaliMonths(c, 1),
    PageUp: (c) => addJalaliMonths(c, -1),
    Home: (c) => ({ ...c, jd: 1 }),
    End: (c) => ({ ...c, jd: jalaliMonthLength(c.jy, c.jm) }),
  };
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (KEYS[e.key] && e.target && e.target.classList && e.target.classList.contains('jdp__day')) {
      e.preventDefault();
      moveTo(KEYS[e.key](cursor));
    }
  }
  overlay.addEventListener('keydown', onKey);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  }
  function choose(key) {
    close();
    if (onSelect) onSelect(key);
  }

  document.body.appendChild(overlay);
  render(true);
  return { close, root: overlay };
}
