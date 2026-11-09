// Icon.js — آیکن‌های خطی یکدست (SVG درون‌خطی، سبک iOS) به‌جای ایموجی رنگارنگ.
// کلید همان glyph است که در navigation.js و کاشی‌ها ثبت شده؛ glyph ناشناخته متن می‌ماند.
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  chart: '<path d="M4 19h16"/><path d="m5 15 4.5-5 3.5 3 6-7"/>',
  bars: '<path d="M5 20v-7M12 20V5M19 20v-10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="m5 7-3 7h6zM19 7l-3 7h6z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bank: '<path d="m3 9.5 9-5.5 9 5.5"/><path d="M5 10v7M10 10v7M14 10v7M19 10v7M3 20h18"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14.5 3v4.5H19M9 12h7M9 16h7"/>',
  cart: '<path d="M3 4h2.5l2.4 11h10l2-8H6.5"/><circle cx="9" cy="19.5" r="1.2"/><circle cx="17" cy="19.5" r="1.2"/>',
  ring: '<circle cx="12" cy="14.5" r="6"/><path d="m9.5 4.5 2.5 3 2.5-3-1-1.5h-3z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3-6 6.5-6s6 2 6.5 6"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5c2 .8 3.2 2.7 3.5 5.5"/>',
  factory: '<path d="M3 20V10l6 3.5V10l6 3.5V5h6v15z"/><path d="M7 17h2M12 17h2M17 17h1"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h7V3M8 21v-7h8v7"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  deal: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
  cash: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 10v4M17.5 10v4"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.3 2 2.7C10.700 9 11 6 12 3z"/>',
  down: '<path d="M12 4v13M6.500 12 12 17.500 17.500 12M5 21h14"/>',
  up: '<path d="M12 20V7M6.500 12 12 6.500 17.500 12M5 3h14"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  empty: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.500 2.500h5L16 13h5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2.500M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300l1.800 1.800M16.900 16.900l1.800 1.800M18.700 5.300l-1.800 1.800M7.100 16.900l-1.800 1.800"/>',
  moon: '<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4a8.500 8.500 0 1 0 10.500 10.500z"/>',
  call: '<path d="M5 3.500h3.500l1.500 5-2.200 1.700a13 13 0 0 0 6 6L15.500 14l5 1.500V19a2 2 0 0 1-2 2C10.500 21 3 13.500 3 5.500a2 2 0 0 1 2-2z"/>',
  chat: '<path d="M21 11.500a8.500 8.500 0 0 1-12.500 7.500L3 20.500l1.500-5.500A8.500 8.500 0 1 1 21 11.500z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.500 4.500"/>',
  share: '<path d="M12 15V3.500M8 7l4-3.500L16 7"/><path d="M6 11H4.500v9.500h15V11H18"/>',
};
const GLYPHS = {
  '🏠': 'home', '📈': 'chart', '⚙️': 'gear', '📊': 'bars', '⚖️': 'scale', '⏰': 'clock', '🏦': 'bank',
  '🧾': 'doc', '🛒': 'cart', '💍': 'ring', '👥': 'people', '🏭': 'factory', '💾': 'save', '📲': 'phone', '🗂️': 'grid',
  '🤝': 'deal', '💵': 'cash', '🔥': 'flame', '⬇️': 'down', '⬆️': 'up', '🔁': 'swap', '📭': 'empty', '☀️': 'sun', '🌙': 'moon',
};

/** نام آیکن یا glyph قدیمی ⇒ رشته‌ی SVG؛ ناشناخته ⇒ null. */
export function iconSvg(key) {
  const d = P[GLYPHS[key] || key];
  return d ? `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>` : null;
}

/** محتوای عنصر را با آیکن پر می‌کند؛ glyph ناشناخته (مثلاً ⚠️) به‌صورت متن می‌ماند. */
export function setIcon(el, key) {
  const svg = iconSvg(key);
  if (svg) el.innerHTML = svg;
  else el.textContent = key;
  return el;
}
