// ThemeSwitch.js — کلید سه‌حالته‌ی تم (خودکار / روشن / تیره) — Phase 24
//
// ظاهر همان «کلید بازه»ی داشبورد (period-switch) است تا کاربر یک الگوی آشنا
// ببیند؛ از نظر دسترس‌پذیری یک radiogroup است (نه سه دکمه‌ی بی‌ربط).
import { THEME_OPTIONS, themeState, setThemePreference, THEME_CHANGE_EVENT } from '../utils/theme.js';

export function ThemeSwitch() {
  const group = document.createElement('div');
  group.className = 'period-switch theme-switch';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'تم برنامه');

  const buttons = THEME_OPTIONS.map((opt) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'period-switch__btn';
    b.setAttribute('role', 'radio');
    b.dataset.theme = opt.value;
    b.textContent = opt.label;
    b.addEventListener('click', () => {
      setThemePreference(opt.value);
      sync();
    });
    group.appendChild(b);
    return b;
  });

  function sync() {
    const { preference } = themeState();
    for (const b of buttons) {
      const on = b.dataset.theme === preference;
      b.classList.toggle('period-switch__btn--active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    }
  }
  sync();
  // اگر کاربر از کلید هدر تم را عوض کند، این کلید هم همگام بماند.
  const onChange = () => { if (group.isConnected) sync(); };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return group;
}
