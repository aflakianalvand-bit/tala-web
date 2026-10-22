// Tabs.js — تب‌های افقی قابل اسکرول (Mobile First، مناسب صفحه جزئیات مشتری/تأمین‌کننده)
// محتوای هر تب به‌صورت Lazy فقط هنگام اولین انتخاب ساخته می‌شود.
export function Tabs({ tabs = [], initial = 0, onChange } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tabs';

  const bar = document.createElement('div');
  bar.className = 'tabs__bar';
  bar.setAttribute('role', 'tablist');

  const panel = document.createElement('div');
  panel.className = 'tabs__panel';
  panel.setAttribute('role', 'tabpanel');

  const buttons = [];
  const cache = new Map();
  let activeIndex = -1;

  function select(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    buttons.forEach((btn, i) => {
      const isActive = i === index;
      btn.classList.toggle('tabs__tab--active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
      btn.tabIndex = isActive ? 0 : -1;
    });

    panel.innerHTML = '';
    let content = cache.get(index);
    if (!content) {
      content = tabs[index].render();
      cache.set(index, content);
    }
    if (content instanceof Node) panel.appendChild(content);
    if (onChange) onChange(index, tabs[index]);
  }

  tabs.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tabs__tab';
    btn.setAttribute('role', 'tab');
    btn.textContent = tab.label;
    if (tab.badge !== undefined && tab.badge !== null && tab.badge !== 0) {
      const count = document.createElement('span');
      count.className = 'tabs__count';
      count.textContent = String(tab.badge);
      btn.appendChild(count);
    }
    btn.addEventListener('click', () => select(i));
    buttons.push(btn);
    bar.appendChild(btn);
  });

  wrap.append(bar, panel);
  select(Math.min(Math.max(initial, 0), Math.max(tabs.length - 1, 0)));

  wrap.select = select;
  /** محتوای Cache شده‌ی یک تب را باطل می‌کند تا در انتخاب بعدی دوباره ساخته شود. */
  wrap.invalidate = (index) => {
    if (index === undefined) cache.clear();
    else cache.delete(index);
  };
  return wrap;
}
