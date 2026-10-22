// Price.js — صفحه‌ی «قیمت» (Phase 25)
//
// نرخ روز طلای ۷۵۰ از «تنظیمات» به یک آیتم مستقل نوار پایین آمد، چون هر روز
// (گاهی چند بار در روز) عوض می‌شود و نباید زیر فرم تنظیمات عمومی پنهان باشد.
//
// سه بخش:
//   ۱) ثبت نرخ — یک فیلد بزرگ + یک دکمه. پیش‌فرض‌های دیگر (کارمزد تبدیل، اجرت،
//      سود، مالیات) از نرخ قبلی **همان‌طور** منتقل می‌شوند، پس ثبت نرخ روز
//      عملاً «تایپ عدد و یک لمس» است. دکمه‌های ±۱۰۰ هزار / ±۱ میلیون فقط
//      فیلد را جابه‌جا می‌کنند، چیزی ثبت نمی‌کنند.
//   ۲) پیش‌نمایش نرخ عیارهای رایج + عیار دلخواه (services/units.rateForFineness).
//   ۳) تاریخچه — همان priceRates، Append-only: فقط خواندن؛ هیچ دکمه‌ی ویرایش/حذف.
//
// هیچ منطق مالی اینجا نیست: ثبت فقط از services/priceRates.setDailyRate و نرخ عیار
// فقط از services/units. تفاوت با نرخ قبلی صرفاً یک تفریق نمایشی است.
import { Input } from '../components/Input.js';
import { Button } from '../components/Button.js';
import { showToast } from '../components/Toast.js';
import { formatRial, formatNumber } from '../utils/format.js';
import { toDate } from '../utils/date.js';
import { displayDateLong } from './docs/docLabels.js';
import {
  getCurrentRate,
  listRateHistory,
  setDailyRate,
  PriceRateValidationError,
} from '../services/priceRates.js';
import { rateForFineness, isValidFineness, FINENESS_ERROR } from '../services/units.js';

/** عیارهای پیش‌نمایش (هزاری) — همان میان‌برهای فیلد عیار (Phase 22). */
export const PRICE_PREVIEW_FINENESS = [705, 750, 875, 916, 999, 585];
// علامت و عدد در یک بخش LTR جدا (<bdi>)، وگرنه جهت RTL «+۱» را «۱+» نشان می‌دهد.
const STEPS = [
  { delta: -1_000_000, sign: '−۱', unit: 'میلیون', aria: 'کاهش یک میلیون ریال' },
  { delta: -100_000, sign: '−۱۰۰', unit: 'هزار', aria: 'کاهش صد هزار ریال' },
  { delta: 100_000, sign: '+۱۰۰', unit: 'هزار', aria: 'افزایش صد هزار ریال' },
  { delta: 1_000_000, sign: '+۱', unit: 'میلیون', aria: 'افزایش یک میلیون ریال' },
];
const HISTORY_PAGE = 20;

function card(tag, title, subtitle = '') {
  const el = document.createElement(tag);
  el.className = 'card card--shadow';
  if (title) {
    const h = document.createElement('h2');
    h.className = 'section__title';
    h.textContent = title;
    el.appendChild(h);
  }
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'doc-line__note';
    sub.textContent = subtitle;
    el.appendChild(sub);
  }
  return el;
}

function timeOf(iso) {
  const d = toDate(iso);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** «▲ 500,000» / «▼ …» / «بدون تغییر» — تفاوت با نرخ ثبت‌شده‌ی قبلی. */
function deltaChip(current, previous) {
  if (!previous || !current) return null;
  const diff = Math.round(current.ratePerGram18k - previous.ratePerGram18k);
  const chip = document.createElement('span');
  chip.className = 'price-delta';
  if (diff === 0) {
    chip.textContent = 'بدون تغییر';
    chip.classList.add('price-delta--flat');
  } else {
    const up = diff > 0;
    chip.classList.add(up ? 'price-delta--up' : 'price-delta--down');
    chip.textContent = `${up ? '▲' : '▼'} ${formatNumber(Math.abs(diff), { maximumFractionDigits: 0 })}`;
    chip.setAttribute('aria-label', `${up ? 'افزایش' : 'کاهش'} ${formatRial(Math.abs(diff))} نسبت به نرخ قبلی`);
  }
  return chip;
}

export default async function PricePage() {
  const wrap = document.createElement('div');
  wrap.className = 'price-page';

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'قیمت';
  header.appendChild(h1);
  wrap.appendChild(header);

  let current = await getCurrentRate();
  let historyLimit = HISTORY_PAGE;

  // ─────────────── ۱) نرخ فعلی ───────────────
  const hero = document.createElement('section');
  hero.className = 'card card--shadow price-hero';
  hero.setAttribute('aria-live', 'polite');
  wrap.appendChild(hero);

  async function renderHero() {
    const [latest, previous] = await listRateHistory({ limit: 2 });
    hero.innerHTML = '';
    const label = document.createElement('div');
    label.className = 'price-hero__label';
    label.textContent = 'نرخ روز هر گرم طلای ۷۵۰';
    const value = document.createElement('div');
    value.className = 'price-hero__value';
    const sub = document.createElement('div');
    sub.className = 'price-hero__sub';
    if (latest) {
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = formatNumber(latest.ratePerGram18k, { maximumFractionDigits: 0 });
      const unit = document.createElement('span');
      unit.className = 'price-hero__unit';
      unit.textContent = 'ریال';
      value.append(n, unit);
      sub.textContent = `${displayDateLong(latest.effectiveDate)} — ساعت ${timeOf(latest.effectiveDate)}`;
      const chip = deltaChip(latest, previous);
      if (chip) sub.append(' ', chip);
    } else {
      value.textContent = 'ثبت نشده';
      value.classList.add('price-hero__value--empty');
      sub.textContent = 'تا نرخ روز ثبت نشود، نرخ هر قلم در فاکتور دستی وارد می‌شود.';
    }
    hero.append(label, value, sub);
  }

  // ─────────────── ۲) ثبت نرخ جدید ───────────────
  const form = card('form', 'ثبت نرخ جدید');
  form.classList.add('price-form');
  form.noValidate = true;

  const rateField = Input({
    label: 'نرخ هر گرم ۷۵۰ (ریال)',
    value: current?.ratePerGram18k ? String(current.ratePerGram18k) : '',
    numeric: true,
    inputmode: 'numeric',
    required: true,
  });
  rateField.classList.add('price-form__rate');
  const rateInput = rateField.getInput();

  const steps = document.createElement('div');
  steps.className = 'price-steps';
  steps.setAttribute('role', 'group');
  steps.setAttribute('aria-label', 'تغییر سریع نرخ');
  for (const s of STEPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'price-step';
    const num = document.createElement('bdi');
    num.dir = 'ltr';
    num.textContent = s.sign;
    b.append(num, ` ${s.unit}`);
    b.setAttribute('aria-label', s.aria);
    b.dataset.delta = String(s.delta);
    b.addEventListener('click', () => {
      const base = Number(rateField.getValue()) || current?.ratePerGram18k || 0;
      const next = Math.max(0, base + s.delta);
      rateInput.value = String(next);
      rateInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    steps.appendChild(b);
  }

  // پیش‌فرض‌های دیگر: از نرخ قبلی منتقل می‌شوند؛ فقط اگر بخواهید عوض کنید باز کنید.
  const more = document.createElement('details');
  more.className = 'price-more';
  const summary = document.createElement('summary');
  summary.textContent = 'کارمزد، اجرت، سود و مالیات پیش‌فرض';
  const moreNote = document.createElement('div');
  moreNote.className = 'doc-line__note';
  moreNote.textContent = 'بدون باز کردن این بخش، همان مقادیر نرخ قبلی با نرخ جدید ثبت می‌شوند.';
  const pctField = (label, v, hint = '') =>
    Input({ label, value: String(v ?? 0), numeric: true, hint });
  const meltFeeField = pctField('کارمزد تبدیل آبشده/متفرقه (درصد)', current?.meltedFeePercent, 'فقط در فروش آبشده و متفرقه.');
  const wageField = pctField('اجرت پیش‌فرض (درصد)', current?.defaultWagePercent);
  const profitField = pctField('سود پیش‌فرض (درصد)', current?.defaultProfitPercent);
  const taxField = pctField('مالیات پیش‌فرض (درصد)', current?.defaultTaxPercent);
  more.append(summary, moreNote, meltFeeField, wageField, profitField, taxField);

  const submit = Button({ label: 'ثبت نرخ', variant: 'primary', type: 'submit', fullWidth: true });
  submit.classList.add('price-form__submit');
  const appendNote = document.createElement('div');
  appendNote.className = 'doc-line__note';
  appendNote.textContent = 'هر ثبت یک رکورد تازه می‌سازد؛ نرخ‌های قبلی و فاکتورهای گذشته دست نمی‌خورند.';

  form.append(rateField, steps, submit, appendNote, more);
  wrap.appendChild(form);

  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return; // دو لمس پشت‌سرهم = یک رکورد
    saving = true;
    submit.disabled = true;
    try {
      const saved = await setDailyRate({
        ratePerGram18k: Number(rateField.getValue()),
        meltedFeePercent: Number(meltFeeField.getValue()) || 0,
        defaultWagePercent: Number(wageField.getValue()) || 0,
        defaultProfitPercent: Number(profitField.getValue()) || 0,
        defaultTaxPercent: Number(taxField.getValue()) || 0,
      });
      current = saved;
      showToast(`نرخ روز ثبت شد: ${formatRial(saved.ratePerGram18k)} برای هر گرم ۷۵۰.`, { variant: 'success' });
      await Promise.all([renderHero(), renderHistory()]);
    } catch (err) {
      if (err instanceof PriceRateValidationError) {
        showToast(Object.values(err.fieldErrors)[0], { variant: 'danger' });
      } else {
        console.error('[Price] setDailyRate', err);
        showToast('ثبت نرخ روز ناموفق بود.', { variant: 'danger' });
      }
    } finally {
      saving = false;
      submit.disabled = false;
    }
  });

  // ─────────────── ۳) پیش‌نمایش عیارها ───────────────
  const preview = card('section', 'نرخ عیارها', 'نرخ هر عیار = نرخ ۷۵۰ × (عیار ÷ ۷۵۰). در فاکتور می‌توانید نرخ هر قلم را دستی تغییر دهید.');
  preview.classList.add('price-preview');
  const grid = document.createElement('div');
  grid.className = 'price-grid';
  const customField = Input({ label: 'عیار دلخواه', value: '', numeric: true, inputmode: 'numeric', group: false, placeholder: 'مثلاً ۷۴۰' });
  const customResult = document.createElement('div');
  customResult.className = 'price-custom';
  customResult.setAttribute('aria-live', 'polite');
  preview.append(grid, customField, customResult);
  wrap.appendChild(preview);

  function renderPreview() {
    const base = Number(rateField.getValue()) || 0;
    grid.innerHTML = '';
    for (const f of PRICE_PREVIEW_FINENESS) {
      const cell = document.createElement('div');
      cell.className = 'price-grid__cell';
      cell.dataset.fineness = String(f);
      const l = document.createElement('span');
      l.className = 'price-grid__label';
      l.textContent = `عیار ${f}`;
      const v = document.createElement('span');
      v.className = 'price-grid__value num';
      v.textContent = base > 0 ? formatNumber(rateForFineness(base, f), { maximumFractionDigits: 0 }) : '—';
      cell.append(l, v);
      grid.appendChild(cell);
    }
    const raw = String(customField.getValue()).trim();
    if (!raw) {
      customResult.textContent = '';
    } else if (!isValidFineness(Number(raw))) {
      customResult.textContent = FINENESS_ERROR;
      customResult.classList.add('price-custom--error');
      return;
    } else {
      customResult.textContent =
        base > 0 ? `عیار ${raw}: ${formatRial(rateForFineness(base, Number(raw)))} برای هر گرم` : 'اول نرخ ۷۵۰ را وارد کنید.';
    }
    customResult.classList.remove('price-custom--error');
  }
  rateInput.addEventListener('input', renderPreview);
  customField.getInput().addEventListener('input', renderPreview);

  // ─────────────── ۴) تاریخچه ───────────────
  const history = card('section', 'تاریخچه‌ی نرخ‌ها', 'فقط افزودنی — هیچ نرخی ویرایش یا حذف نمی‌شود.');
  history.classList.add('price-history');
  const list = document.createElement('ol');
  list.className = 'price-history__list';
  const moreBtn = Button({ label: 'نمایش نرخ‌های قدیمی‌تر', variant: 'secondary', fullWidth: true });
  moreBtn.addEventListener('click', () => {
    historyLimit += HISTORY_PAGE;
    renderHistory();
  });
  history.append(list, moreBtn);
  wrap.appendChild(history);

  async function renderHistory() {
    // یکی بیشتر می‌خوانیم تا تفاوتِ آخرین ردیف و وجود «قدیمی‌تر» معلوم شود.
    const rows = await listRateHistory({ limit: historyLimit + 1 });
    list.innerHTML = '';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'price-history__empty';
      li.textContent = 'هنوز نرخی ثبت نشده است.';
      list.appendChild(li);
    }
    rows.slice(0, historyLimit).forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'price-history__row';
      li.dataset.rateId = r.id;
      const when = document.createElement('span');
      when.className = 'price-history__when';
      when.textContent = `${displayDateLong(r.effectiveDate)} · ${timeOf(r.effectiveDate)}`;
      const val = document.createElement('span');
      val.className = 'price-history__value';
      const n = document.createElement('span');
      n.className = 'num';
      n.textContent = formatNumber(r.ratePerGram18k, { maximumFractionDigits: 0 });
      val.appendChild(n);
      const chip = deltaChip(r, rows[i + 1]);
      if (chip) val.appendChild(chip);
      li.append(when, val);
      list.appendChild(li);
    });
    moreBtn.hidden = rows.length <= historyLimit;
  }

  await Promise.all([renderHero(), renderHistory()]);
  renderPreview();
  return wrap;
}
