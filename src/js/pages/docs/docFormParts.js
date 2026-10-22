// docFormParts.js — اجزای مشترک فرم اسناد تجاری (خرید Phase 6 / فروش Phase 7)
//
// ═══════════════════════════════════════════════════════════════════════════
// چرا این فایل در Phase 7 استخراج شد:
// فرم خرید و فرم فروش از نظر ساختار یکی‌اند — سربرگ سند، فهرست اقلام، فهرست خطوط
// تسویه، نوار جمع چسبان. تنها تفاوت‌شان واژگان و جهت است. اگر کارت «خط تسویه»
// دو نسخه داشت، اصلاح یک ایراد (مثلاً نمایش نرخ ارزش‌گذاری طلا) باید دو بار انجام
// می‌شد و به‌مرور واگرا می‌شدند — همان اشتباهی که در Phase 5 برای مشتری/تأمین‌کننده
// رفع شد. منطق مالی این خطوط از قبل در services/settlement.js مشترک است؛ این فایل
// همتای UI همان اشتراک است.
// ═══════════════════════════════════════════════════════════════════════════

import { KaratInput } from '../../components/KaratInput.js';
import { LabInput } from '../../components/LabInput.js';
import { DEFAULT_FINENESS, CURRENT_UNITS, equivalent750, isValidFineness, isValidScaleWeight } from '../../services/units.js';
import { labApplies } from '../../services/labs.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Button } from '../../components/Button.js';

/** سربرگ یک بخش فرم، با دکمه‌ی اقدام اختیاری در سمت چپ. */
export function sectionTitle(text, actionEl) {
  const row = document.createElement('div');
  row.className = 'form-section__head';
  const title = document.createElement('div');
  title.className = 'section__title';
  title.textContent = text;
  row.appendChild(title);
  if (actionEl) row.appendChild(actionEl);
  return row;
}

/** یک خانه‌ی نوار خلاصه/جمع. */
export function summaryItem(label, value, variant = '') {
  const item = document.createElement('div');
  item.className = 'summary-bar__item';
  const l = document.createElement('span');
  l.className = 'summary-bar__label';
  l.textContent = label;
  const v = document.createElement('span');
  // (درس Phase 13، UI_GUIDELINES §۶.۵) کلاس `num` جهت را LTR می‌کند و فقط روی
  // مقدار **کاملاً عددی** درست است. روی «۵٫۵ گرم ۷۵۰» باعث می‌شد واحد اول و عدد
  // بعد خوانده شود («گرم ۷۵۰ ۵٫۵»). پس فقط وقتی اعمال می‌شود که واحدی در متن نباشد.
  const text = String(value ?? '');
  const isPureNumber = /^[-+()\d.,\u06F0-\u06F9\u066B\u066C\s٪%]+$/.test(text);
  v.className =
    `summary-bar__value${variant ? ` summary-bar__value--${variant}` : ''}` +
    (isPureNumber ? ' num' : '');
  if (!isPureNumber) v.style.textAlign = 'right';
  v.textContent = text;
  item.append(l, v);
  return item;
}

/** پیام خطا را زیر یک فیلد (مثلاً Select که خودش پارامتر error ندارد) اضافه می‌کند. */
export function attachError(fieldEl, message) {
  if (!message) return fieldEl;
  const e = document.createElement('div');
  e.className = 'field__error';
  e.textContent = message;
  fieldEl.appendChild(e);
  fieldEl.classList.add('field--invalid');
  return fieldEl;
}

/**
 * Phase 23 — نمایش زنده‌ی «معادل ۷۵۰» زیر وزن/عیار یک خط طلا.
 * عدد از همان تابع سرویس (`equivalent750`) می‌آید که سند ثبت‌شده با آن حساب می‌شود،
 * با همان حالت گِرد کردن تنظیمات — پس عدد پیش‌نمایش و عدد دفتر یکی است.
 * @returns {HTMLElement} عنصری با متد `update()`
 */
export function equivalentHint(entry, units = CURRENT_UNITS) {
  const el = document.createElement('div');
  el.className = 'gold-equiv';
  el.setAttribute('aria-live', 'polite');
  el.update = () => {
    const w = Number(entry.weightGrams);
    const f = Number(entry.karat);
    if (!(w > 0) || !isValidScaleWeight(w) || !isValidFineness(f)) {
      el.textContent = 'معادل ۷۵۰: —';
      el.dataset.grams = '';
      return;
    }
    const grams = equivalent750(w, f, units);
    el.dataset.grams = String(grams);
    el.textContent = `معادل ۷۵۰: ${grams.toFixed(3)} گرم` + (f === 750 ? '' : ` (${w} گرم × ${f} ÷ ۷۵۰)`);
  };
  el.update();
  return el;
}

/** یک خط تسویه‌ی خالی (پرداخت یا دریافت) با حساب پیش‌فرض. */
export function emptySettlement(defaultAccountId, keyFn) {
  return {
    key: keyFn(),
    method: 'cash',
    accountId: defaultAccountId || '',
    amountIRR: '',
    goldType: 'melted',
    karat: String(DEFAULT_FINENESS), // Phase 22: عیار هزاری
    weightGrams: '',
    ratePerGram: '',
    labName: '',
  };
}

/** رکورد ذخیره‌شده‌ی پرداخت/دریافت → وضعیت فرم. */
export function settlementFromRecord(record, keyFn) {
  return {
    key: keyFn(),
    method: record.method,
    accountId: record.accountId || '',
    amountIRR: record.method === 'cash' ? String(record.amountIRR ?? '') : '',
    goldType: record.goldType || 'melted',
    karat: String(record.karat ?? DEFAULT_FINENESS),
    weightGrams: record.method === 'gold' ? String(record.weightGrams ?? '') : '',
    ratePerGram: record.method === 'gold' ? String(record.ratePerGram ?? '') : '',
    labName: record.method === 'gold' ? record.labName || '' : '',
  };
}

/**
 * کارت ویرایش یک خط تسویه — مشترک بین «پرداخت» خرید و «دریافت» فروش.
 *
 * @param {object} options
 * @param {object} options.entry وضعیت خط (mutable — همان‌جا به‌روزرسانی می‌شود)
 * @param {number} options.index شماره خط (برای عنوان و نگاشت خطا)
 * @param {Array}  options.accounts حساب‌های فعال (صندوق/بانک/کارتخوان)
 * @param {object} options.errors نگاشت field → پیام خطا برای همین خط
 * @param {string} options.label واژه‌ی دامنه: «پرداخت» یا «دریافت»
 * @param {string} options.goldLabel برچسب گزینه‌ی طلا: «پرداخت با طلا» / «دریافت طلا»
 * @param {string} options.goldTypeLabel برچسب فیلد نوع طلا
 * @param {string} options.rateHint راهنمای فیلد نرخ ارزش‌گذاری
 * @param {Function} options.goldTypeOptions گزینه‌های نوع طلا
 * @param {Function} options.onStructuralChange تغییری که نیاز به رندر دوباره دارد
 * @param {Function} options.onValueChange تغییر عددی (فقط جمع‌ها بازمحاسبه می‌شوند)
 * @param {Function} options.onRemove حذف این خط
 */
export function settlementCard({
  entry,
  index,
  accounts,
  errors = {},
  label = 'پرداخت',
  goldLabel = 'پرداخت با طلا',
  goldTypeLabel = 'نوع طلا',
  rateHint = '',
  goldTypeOptions = [],
  labSuggestions = [],
  units = CURRENT_UNITS,
  onStructuralChange,
  onValueChange,
  onRemove,
}) {
  const card = document.createElement('div');
  card.className = 'doc-line doc-line--payment';

  const head = document.createElement('div');
  head.className = 'doc-line__head';
  const title = document.createElement('span');
  title.className = 'doc-line__title';
  title.textContent = `${label} ${index + 1}`;
  head.appendChild(title);
  head.appendChild(Button({ label: 'حذف', variant: 'ghost', onClick: onRemove }));
  card.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'form-grid';

  const methodValue = entry.method === 'gold' ? 'gold' : `account:${entry.accountId}`;
  grid.appendChild(
    Select({
      label: `روش ${label}`,
      value: methodValue,
      options: [
        ...accounts.map((a) => ({ value: `account:${a.id}`, label: a.name })),
        { value: 'gold', label: goldLabel },
      ],
      onChange: (v) => {
        if (v === 'gold') {
          entry.method = 'gold';
        } else {
          entry.method = 'cash';
          entry.accountId = v.slice('account:'.length);
        }
        onStructuralChange();
      },
    })
  );

  if (entry.method === 'cash') {
    grid.appendChild(
      Input({
        label: 'مبلغ (ریال)',
        numeric: true,
        required: true,
        value: entry.amountIRR,
        error: errors.amountIRR || errors.accountId || '',
        onInput: (v) => {
          entry.amountIRR = v;
          onValueChange();
        },
      })
    );
  } else {
    const equiv = equivalentHint(entry, units);
    const isLab = labApplies(entry.goldType);
    grid.append(
      Select({
        label: goldTypeLabel,
        value: entry.goldType,
        options: goldTypeOptions,
        onChange: (v) => {
          entry.goldType = v;
          // Phase 23: فیلد آزمایشگاه فقط برای آبشده/متفرقه — تغییر نوع، ساختار کارت را عوض می‌کند.
          onStructuralChange();
        },
      }),
      KaratInput({
        value: entry.karat,
        error: errors.karat || '',
        hint: isLab ? 'عیار واقعی از برگه‌ی آزمایشگاه (هزاری، مثلاً ۷۴۰)' : undefined,
        onInput: (v) => {
          entry.karat = v;
          equiv.update();
          onValueChange();
        },
      }),
      Input({
        label: 'وزن (گرم)',
        numeric: true,
        required: true,
        value: entry.weightGrams,
        error: errors.weightGrams || '',
        onInput: (v) => {
          entry.weightGrams = v;
          equiv.update();
          onValueChange();
        },
      }),
      equiv
    );
    if (isLab) {
      grid.appendChild(
        LabInput({
          value: entry.labName,
          suggestions: labSuggestions,
          error: errors.labName || '',
          onInput: (v) => {
            entry.labName = v;
          },
        })
      );
    }
    grid.appendChild(
      Input({
        label: 'نرخ ارزش‌گذاری هر گرم (ریال)',
        numeric: true,
        required: true,
        value: entry.ratePerGram,
        hint: rateHint,
        error: errors.ratePerGram || '',
        onInput: (v) => {
          entry.ratePerGram = v;
          onValueChange();
        },
      })
    );
  }

  card.appendChild(grid);
  return card;
}
