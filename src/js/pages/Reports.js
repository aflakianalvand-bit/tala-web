// Reports.js — صفحه‌ی «گزارش‌ها» (Phase 14)
//
// این صفحه هیچ عددی محاسبه نمی‌کند و هیچ Store ای را نمی‌خواند؛ فهرست گزارش‌ها،
// پارامترها و اجرا همه از services/reports/index.js می‌آید و خروجی با ReportView
// رندر می‌شود. همه‌ی گزارش‌ها فیلتر تاریخ دارند (خواسته‌ی صریح Phase 14).
import { Select } from '../components/Select.js';
import { Input } from '../components/Input.js';
import { Alert } from '../components/Alert.js';
import { LoadingState } from '../components/LoadingState.js';
import { REPORT_GROUPS, reportsInGroup, getReportDef, paramOptions, runReport, PARAM_FIELD } from '../services/reports/index.js';
import { RANGE_PRESETS, presetRange, normalizeRange, DateRangeError } from '../utils/dateRange.js';
import { ReportView } from './reports/ReportView.js';
import { formatSummary } from './reports/reportFormat.js';
import { Button } from '../components/Button.js';
import { showToast } from '../components/Toast.js';
import { buildReportWorkbook } from '../services/excelExport.js';
import { deliverFile } from '../utils/download.js';
import { XLSX_MIME } from '../utils/xlsx.js';

const DEFAULT_STATE = {
  group: 'sales',
  reportKey: 'sales.byDay',
  preset: 'thisMonth',
  from: null,
  to: null,
  params: {},
};

// انتخاب‌های کاربر در طول همان نشست حفظ می‌شود (برگشت از صفحه‌ی دیگر، گزارش را از نو نمی‌چیند).
let lastState = null;

/** وضعیت اولیه با بازه‌ی گزینه‌ی آماده نسبت به امروز. */
export function initialReportState(today = new Date()) {
  const base = lastState ? { ...lastState, params: { ...lastState.params } } : { ...DEFAULT_STATE, params: {} };
  if (base.preset !== 'custom') Object.assign(base, presetRange(base.preset, today));
  return base;
}

export function resetReportState() {
  lastState = null;
}

export default async function ReportsPage() {
  const state = initialReportState();
  let seq = 0;

  const wrap = document.createElement('div');
  wrap.className = 'reports-page';

  const header = document.createElement('div');
  header.className = 'page-header';
  const h1 = document.createElement('h1');
  h1.textContent = 'گزارش‌ها';
  header.appendChild(h1);
  wrap.appendChild(header);

  const filters = document.createElement('div');
  filters.className = 'product-filters report-filters';
  wrap.appendChild(filters);

  const output = document.createElement('div');
  output.className = 'report-output';
  wrap.appendChild(output);

  function renderFilters() {
    filters.innerHTML = '';

    const row1 = document.createElement('div');
    row1.className = 'product-filters__row';
    const groupSelect = Select({
        label: 'گروه',
        options: REPORT_GROUPS.map((g) => ({ value: g.key, label: `${g.icon} ${g.label}` })),
        value: state.group,
        onChange: (v) => {
          state.group = v;
          state.reportKey = reportsInGroup(v)[0].key;
          state.params = {};
          renderFilters();
          refresh();
        },
      });
    const reportSelect = Select({
        label: 'گزارش',
        options: reportsInGroup(state.group).map((r) => ({ value: r.key, label: r.title })),
        value: state.reportKey,
        onChange: (v) => {
          state.reportKey = v;
          state.params = {};
          renderFilters();
          refresh();
        },
      });
    groupSelect.getSelect().dataset.role = 'group';
    reportSelect.getSelect().dataset.role = 'report';
    row1.append(groupSelect, reportSelect);
    filters.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'product-filters__row';
    const presetSelect = Select({
        label: 'بازه‌ی تاریخ',
        options: RANGE_PRESETS.map((p) => ({ value: p.key, label: p.label })),
        value: state.preset,
        onChange: (v) => {
          state.preset = v;
          if (v !== 'custom') Object.assign(state, presetRange(v));
          renderFilters();
          refresh();
        },
      });
    presetSelect.getSelect().dataset.role = 'preset';
    row2.appendChild(presetSelect);
    const paramSlot = document.createElement('div');
    row2.appendChild(paramSlot);
    filters.appendChild(row2);
    renderParam(paramSlot);

    const row3 = document.createElement('div');
    row3.className = 'product-filters__row';
    const dateInput = (label, field) => {
      const el = Input({ label, type: 'date', value: state[field] || '' });
      el.getInput().dataset.rangeField = field;
      el.getInput().addEventListener('change', (e) => {
        state[field] = e.target.value || null;
        state.preset = 'custom';
        const presetSelect = filters.querySelector('select[data-role="preset"]');
        if (presetSelect) presetSelect.value = 'custom';
        refresh();
      });
      return el;
    };
    row3.append(dateInput('از تاریخ', 'from'), dateInput('تا تاریخ', 'to'));
    filters.appendChild(row3);
  }

  async function renderParam(slot) {
    const def = getReportDef(state.reportKey);
    slot.innerHTML = '';
    if (!def?.param) return;
    const field = PARAM_FIELD[def.param];
    const options = await paramOptions(def.param);
    const labels = { customer: 'مشتری', supplier: 'تأمین‌کننده', account: 'حساب', goldType: 'نوع طلا' };
    const sel = Select({
      label: labels[def.param],
      options,
      value: state.params[field] ?? options[0]?.value ?? '',
      required: Boolean(def.paramRequired),
      onChange: (v) => {
        state.params[field] = v;
        refresh();
      },
    });
    sel.getSelect().dataset.role = 'param';
    slot.appendChild(sel);
  }

  async function refresh() {
    lastState = { ...state, params: { ...state.params } };
    const my = ++seq;
    output.innerHTML = '';

    let range;
    try {
      // متن شمسی بازه در سربرگ خود گزارش نمایش داده می‌شود (ReportView)؛ اینجا فقط اعتبارسنجی.
      range = normalizeRange({ from: state.from, to: state.to });
    } catch (err) {
      output.appendChild(Alert({ variant: 'danger', message: err instanceof DateRangeError ? err.message : 'بازه‌ی تاریخ نامعتبر است.' }));
      return;
    }

    output.appendChild(LoadingState({ label: 'در حال ساخت گزارش…' }));
    let report;
    try {
      report = await runReport(state.reportKey, { ...range, ...state.params });
    } catch (err) {
      if (my !== seq) return;
      console.error('[ReportsPage] runReport', err);
      output.innerHTML = '';
      output.appendChild(Alert({ variant: 'danger', message: 'ساخت گزارش ناموفق بود. دوباره تلاش کنید.' }));
      return;
    }
    // پاسخ یک درخواست قدیمی‌تر (کاربر در این فاصله فیلتر را عوض کرده) کنار گذاشته می‌شود.
    if (my !== seq) return;
    output.innerHTML = '';
    output.appendChild(ReportView(report));
    // خروجی Excel از **همان** شیء گزارشی ساخته می‌شود که روی صفحه رندر شد،
    // پس فایل و صفحه هرگز دو عدد متفاوت نشان نمی‌دهند (Phase 15).
    if (!report.needsParam && report.sections.length) {
      output.appendChild(ExcelButton(report));
    }
  }

  function ExcelButton(report) {
    const btn = Button({
      label: 'خروجی Excel این گزارش',
      variant: 'secondary',
      fullWidth: true,
      icon: '📊',
      onClick: async () => {
        btn.disabled = true;
        try {
          const file = buildReportWorkbook(report, { formatSummary });
          await deliverFile(file.bytes, file.fileName, XLSX_MIME);
          showToast(`فایل Excel با ${file.rowCount} ردیف ساخته شد.`, { variant: 'success' });
        } catch (err) {
          console.error('[ReportsPage] excel', err);
          showToast('ساخت فایل Excel ناموفق بود.', { variant: 'danger' });
        } finally {
          btn.disabled = false;
        }
      },
    });
    btn.dataset.role = 'report-excel';
    return btn;
  }

  renderFilters();
  await refresh();
  return wrap;
}
