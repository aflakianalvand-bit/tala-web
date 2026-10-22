// KpiTile.js — کارت KPI داشبورد (Phase 13)
//
// روی همان کلاس `kpi-card` موجود (Phase 2) ساخته شده تا واژگان بصری یکی بماند؛
// سه چیز اضافه دارد که داشبورد مدیریتی بدون آن‌ها کار نمی‌کند:
//   • `caption` — یک خط توضیح زیر عدد (واحد، بازه، یا معنای عدد)
//   • `variant` — رنگ معنایی (خطر/موفقیت/هشدار)، نه تزئینی
//   • `onClick` — کارت لمسی: هر عدد باید به صفحه‌ای برسد که پشتش است
//
// دسترس‌پذیری: کارت لمسی `role="button"` و `tabindex` می‌گیرد و با Enter/Space هم
// باز می‌شود (روی iPhone با VoiceOver همان رفتار دکمه را دارد).

const VARIANTS = new Set(['danger', 'success', 'warning', 'muted']);

export function KpiTile({ label, value, caption = '', variant = '', onClick = null, title = '', wide = false, numeric = false } = {}) {
  const card = document.createElement('div');
  card.className = `kpi-card${wide ? ' kpi-card--wide' : ''}${onClick ? ' kpi-card--tap' : ''}`;
  if (title) card.title = title;

  const labelEl = document.createElement('div');
  labelEl.className = 'kpi-card__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('div');
  // `num` جهت را LTR می‌کند و فقط برای مقدار کاملاً عددی درست است. مقداری مثل
  // «۲۳ میلیارد ریال» با LTR وارونه خوانده می‌شود (واحد اول، عدد بعد)، پس در جهت
  // طبیعی RTL رها می‌شود تا الگوریتم دوجهته عدد را سر جای خودش بگذارد.
  valueEl.className = `kpi-card__value${numeric ? ' num' : ''}${VARIANTS.has(variant) ? ` kpi-card__value--${variant}` : ''}`;
  valueEl.textContent = value;

  card.append(labelEl, valueEl);

  if (caption) {
    const capEl = document.createElement('div');
    capEl.className = 'kpi-card__caption';
    capEl.textContent = caption;
    card.appendChild(capEl);
  }

  if (onClick) {
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e);
      }
    });
  }

  return card;
}

/** ردیف چیپ‌های کوچک زیر کارت قهرمان (تفکیک نوع طلا). */
export function ChipRow(chips = []) {
  const row = document.createElement('div');
  row.className = 'kpi-chips';
  for (const chip of chips) {
    const el = document.createElement('div');
    el.className = 'kpi-chip';
    const l = document.createElement('span');
    l.className = 'kpi-chip__label';
    l.textContent = chip.label;
    const v = document.createElement('span');
    v.className = 'kpi-chip__value';
    v.textContent = chip.value;
    el.append(l, v);
    if (chip.title) el.title = chip.title;
    row.appendChild(el);
  }
  return row;
}
