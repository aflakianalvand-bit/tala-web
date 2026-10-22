// SettlementForm.js — مودال ثبت دریافت از مشتری / پرداخت به تأمین‌کننده (Phase 11)
//
// یک فرم برای هر دو جهت؛ تفاوت‌ها **داده** هستند نه کد (ARCHITECTURE §4.1).
// کارت هر خط تسویه از pages/docs/docFormParts.js می‌آید — همان کارتی که در فرم خرید و
// فرم فروش استفاده می‌شود، پس اصلاح یک ایراد در آن، هر سه فرم را با هم درست می‌کند.
//
// آنچه این فرم عمداً **ندارد**: انتخاب فاکتور. طبق تصمیم Phase 11 تخصیص هنگام ثبت
// همیشه خودکار و FIFO است. فرم پیش از ثبت نشان می‌دهد این مبلغ کدام فاکتورها را
// می‌بندد و چقدرش علی‌الحساب می‌ماند، و اصلاح بعدی از دکمه‌ی «ویرایش تخصیص» انجام
// می‌شود — نه از اینجا.
import { GRAM_EPS as GRAM_EPS_750, DEFAULT_FINENESS } from '../../services/units.js';
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { Table } from '../../components/Table.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { listSelectableAccounts, InsufficientBalanceError } from '../../services/accounts.js';
import {
  createSettlement,
  previewSettlementTotals,
  SettlementValidationError,
  SettlementGoldShortageError,
} from '../../services/settlements.js';
import { partyInvoices } from '../../services/allocations.js';
import { getPricingConfig } from '../../services/priceRates.js';
import { ratePerGramForKarat } from '../../services/pricing.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import { formatRial, formatGrams, formatBaseGrams } from '../../utils/format.js';
import { GOLD_TYPE_OPTIONS, displayDate, displayDateLong } from '../docs/docLabels.js';
import { settlementCard, emptySettlement, sectionTitle, summaryItem } from '../docs/docFormParts.js';
import { unitsForConfig } from '../../services/goldTotals.js';
import { labSuggestions as loadLabSuggestions } from '../../services/labs.js';

const COPY = {
  customer: {
    title: 'ثبت دریافت از مشتری',
    action: 'ثبت دریافت',
    lineWord: 'دریافت',
    goldOption: 'دریافت طلا',
    goldTypeLabel: 'نوع طلای دریافتی',
    rateHint: 'نرخ توافقی ارزش‌گذاری طلای دریافتی (Snapshot در همین سند).',
    addLine: 'افزودن خط دریافت',
    openTitle: 'فاکتورهای باز مشتری',
    outstandingLabel: 'مانده باز مشتری',
    discountLabel: 'تخفیف تسویه (ریال)',
    discountHint: 'مبلغی از بدهی مشتری که می‌بخشید؛ فاکتور را می‌بندد بدون آنکه پولی جابه‌جا شود.',
    unallocatedLabel: 'علی‌الحساب (بدون فاکتور)',
    success: 'سند دریافت ثبت شد.',
    emptyOpen: 'این مشتری فاکتور باز ندارد؛ کل مبلغ علی‌الحساب ثبت می‌شود.',
  },
  supplier: {
    title: 'ثبت پرداخت به تأمین‌کننده',
    action: 'ثبت پرداخت',
    lineWord: 'پرداخت',
    goldOption: 'پرداخت با طلا',
    goldTypeLabel: 'نوع طلای پرداختی',
    rateHint: 'نرخ توافقی ارزش‌گذاری طلای پرداختی (Snapshot در همین سند).',
    addLine: 'افزودن خط پرداخت',
    openTitle: 'فاکتورهای باز خرید',
    outstandingLabel: 'بدهی باز ما',
    discountLabel: 'تخفیف تسویه (ریال)',
    discountHint: 'مبلغی از بدهی ما که تأمین‌کننده می‌بخشد؛ فاکتور را می‌بندد بدون جابه‌جایی وجه.',
    unallocatedLabel: 'علی‌الحساب (بدون فاکتور)',
    success: 'سند پرداخت ثبت شد.',
    emptyOpen: 'فاکتور باز خریدی وجود ندارد؛ کل مبلغ علی‌الحساب ثبت می‌شود.',
  },
};

/**
 * (Phase 22) جهت معکوس: «پرداخت به مشتری» (پس دادن پیش‌دریافت/طلا) و «دریافت از
 * تأمین‌کننده» (طلای امانی/برگشتی). این اسناد فاکتوری نمی‌بندند و تخفیف ندارند.
 */
const REVERSE_COPY = {
  customer: {
    title: 'پرداخت به مشتری',
    action: 'ثبت پرداخت',
    lineWord: 'پرداخت',
    goldOption: 'پرداخت با طلا',
    goldTypeLabel: 'نوع طلای پرداختی',
    rateHint: 'نرخ توافقی ارزش‌گذاری طلای پرداختی (Snapshot در همین سند).',
    addLine: 'افزودن خط پرداخت',
    success: 'سند پرداخت به مشتری ثبت شد.',
    note: 'پس دادن طلا یا وجه به مشتری (مثلاً پیش‌دریافت یا طلای امانی). به هیچ فاکتوری تخصیص نمی‌یابد؛ مانده‌ی مشتری به همین اندازه به سمت «بد» می‌رود.',
  },
  supplier: {
    title: 'دریافت از تأمین‌کننده',
    action: 'ثبت دریافت',
    lineWord: 'دریافت',
    goldOption: 'دریافت طلا',
    goldTypeLabel: 'نوع طلای دریافتی',
    rateHint: 'نرخ توافقی ارزش‌گذاری طلای دریافتی (Snapshot در همین سند).',
    addLine: 'افزودن خط دریافت',
    success: 'سند دریافت از تأمین‌کننده ثبت شد.',
    note: 'طلا یا وجهی که تأمین‌کننده به ما می‌دهد (مثلاً طلای امانی یا برگشت پیش‌پرداخت). طلا وارد انبار می‌شود و به هیچ فاکتوری تخصیص نمی‌یابد.',
  },
};

let keySeq = 0;
const nextKey = () => `s${(keySeq += 1)}`;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {'customer'|'supplier'} partyType
 * @param {string} partyId
 * @param {object} opts `reverse`: جهت معکوس (پرداخت به مشتری / دریافت از تأمین‌کننده)
 * @returns {Promise<boolean>} true اگر سندی ثبت شد.
 */
export function openSettlementForm(partyType, partyId, { reverse = false } = {}) {
  const normal = COPY[partyType] || COPY.customer;
  const copy = reverse ? { ...normal, ...REVERSE_COPY[partyType === 'supplier' ? 'supplier' : 'customer'] } : normal;
  const direction = (partyType === 'supplier') !== reverse ? 'out' : 'in';

  return new Promise((resolve) => {
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;
    const body = document.createElement('div');
    body.textContent = 'در حال بارگذاری…';
    const errorBox = document.createElement('div');
    form.append(body, errorBox);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';
    const cancelBtn = Button({
      label: 'انصراف',
      variant: 'secondary',
      onClick: () => {
        settled = true;
        close();
        resolve(false);
      },
    });
    const saveBtn = Button({ label: copy.action, variant: 'primary', type: 'submit' });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close, modalEl } = openModal({
      title: copy.title,
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    modalEl.classList.add('modal--full');

    // وضعیت فرم
    const state = {
      date: toDateInputValue(new Date()),
      lines: [],
      /** (Phase 19) فیِ سند — فقط برای تبدیل بخش ریالی به گرم ۷۵۰ لازم است. */
      ratePerBaseGram: '',
      discountIRR: '',
      discountNote: '',
      description: '',
    };
    let accounts = [];
    let openRows = [];
    let pricingConfig = null;
    let labNames = [];
    let lineErrors = {};
    let fieldErrors = {};

    let linesHost;
    let previewHost;
    let discountField;

    (async () => {
      [accounts, openRows, pricingConfig, labNames] = await Promise.all([
        listSelectableAccounts(),
        // سند معکوس فاکتوری نمی‌بندد، پس فهرست فاکتورهای باز لازم نیست.
        reverse ? Promise.resolve([]) : partyInvoices(partyType, partyId, { onlyOpen: true }),
        getPricingConfig(),
        loadLabSuggestions(),
      ]);
      state.lines = [emptySettlement(accounts[0]?.id || '', nextKey)];
      if (!state.ratePerBaseGram && pricingConfig?.ratePerGram18k) {
        state.ratePerBaseGram = String(pricingConfig.ratePerGram18k);
      }
      renderAll();
    })();

    // ── پیش‌نمایش: فرمول در services/settlements.js (Phase 27 — گارد معماری) ──
    function totals() {
      return previewSettlementTotals({
        lines: state.lines,
        discountIRR: state.discountIRR,
        ratePerBaseGram: state.ratePerBaseGram,
        openRows,
        pricingConfig,
      });
    }

    function renderPreview() {
      const t = totals();
      previewHost.innerHTML = '';

      const bar = document.createElement('div');
      bar.className = 'summary-bar';
      bar.append(
        summaryItem(copy.outstandingLabel, formatBaseGrams(t.outstandingGrams)),
        summaryItem('جمع این سند', formatBaseGrams(t.totalGrams), 'primary'),
        summaryItem('تسویه‌ی فاکتور', formatBaseGrams(t.allocatedGrams), 'success'),
        summaryItem(
          copy.unallocatedLabel,
          formatBaseGrams(t.unallocatedGrams),
          t.unallocatedGrams > GRAM_EPS_750 ? 'warning' : ''
        ),
        summaryItem('معادل ریالی', formatRial(t.total))
      );
      previewHost.appendChild(bar);
      if (t.needsRate) {
        previewHost.appendChild(
          Alert({
            variant: 'warning',
            message: 'این سند بخش ریالی دارد؛ تا «فیِ سند» را وارد نکنید، مقدار گرمی آن محاسبه نمی‌شود.',
          })
        );
      }

      previewHost.appendChild(sectionTitle('تخصیص خودکار (قدیمی‌ترین فاکتور اول)'));
      previewHost.appendChild(
        Table({
          columns: [
            { header: 'فاکتور', cell: (r) => r.number || '—' },
            { header: 'مانده قبل', numeric: true, cell: (r) => formatBaseGrams(r.outstandingBefore) },
            { header: 'تخصیص', numeric: true, cell: (r) => formatBaseGrams(r.amountGrams) },
            { header: 'مانده بعد', numeric: true, cell: (r) => formatBaseGrams(r.outstandingAfter) },
          ],
          rows: t.splits,
          emptyTitle: 'تخصیصی انجام نمی‌شود',
          emptyDesc: openRows.length ? 'مبلغی وارد کنید.' : copy.emptyOpen,
        })
      );

      if (t.unallocatedGrams > GRAM_EPS_750) {
        previewHost.appendChild(
          Alert({
            variant: 'info',
            message:
              `${formatBaseGrams(t.unallocatedGrams)} از این سند به فاکتوری تخصیص نمی‌یابد و «علی‌الحساب» ثبت می‌شود. ` +
              'هر وقت فاکتور جدیدی باز شد، می‌توانید آن را تخصیص دهید.',
          })
        );
      }
    }

    function renderLines() {
      linesHost.innerHTML = '';
      state.lines.forEach((line, index) => {
        linesHost.appendChild(
          settlementCard({
            entry: line,
            index,
            accounts,
            errors: lineErrors[index] || {},
            label: copy.lineWord,
            goldLabel: copy.goldOption,
            goldTypeLabel: copy.goldTypeLabel,
            rateHint: copy.rateHint,
            goldTypeOptions: GOLD_TYPE_OPTIONS,
            labSuggestions: labNames,
            units: unitsForConfig(pricingConfig || {}),
            onStructuralChange: () => {
              // پیش‌فرض نرخ طلا از نرخ روز همان عیار — کاربر می‌تواند تغییرش دهد.
              if (line.method === 'gold' && !line.ratePerGram && pricingConfig) {
                // Phase 22: ترتیب آرگومان‌ها اصلاح شد (قبلاً برعکس بود و نرخ پیش‌فرض همیشه صفر می‌شد).
                line.ratePerGram = String(ratePerGramForKarat(num(line.karat) || DEFAULT_FINENESS, pricingConfig));
              }
              renderLines();
              renderPreview();
            },
            onValueChange: renderPreview,
            onRemove: () => {
              state.lines.splice(index, 1);
              if (!state.lines.length) state.lines.push(emptySettlement(accounts[0]?.id || '', nextKey));
              renderLines();
              renderPreview();
            },
          })
        );
      });
    }

    function renderAll() {
      body.innerHTML = '';
      lineErrors = {};
      fieldErrors = {};

      if (!accounts.length) {
        body.appendChild(
          Alert({ variant: 'warning', message: 'هیچ حساب فعالی وجود ندارد. ابتدا یک حساب بسازید.' })
        );
        saveBtn.disabled = true;
        return;
      }

      const dateField = Input({ label: 'تاریخ سند', type: 'date', value: state.date });
      const dateHint = document.createElement('div');
      dateHint.className = 'field__hint';
      const refreshDateHint = () => {
        dateHint.textContent = displayDateLong(fromDateInputValue(dateField.getInput().value));
      };
      refreshDateHint();
      dateField.appendChild(dateHint);
      dateField.getInput().addEventListener('input', () => {
        state.date = dateField.getInput().value;
        refreshDateHint();
      });
      body.appendChild(dateField);

      // ── (Phase 19) فیِ سند: تنها پلی که ریال را به گرم ۷۵۰ تبدیل می‌کند ──
      body.appendChild(
        Input({
          label: 'فیِ سند — ریال هر گرم ۷۵۰',
          numeric: true,
          value: state.ratePerBaseGram,
          hint: pricingConfig?.ratePerGram18k
            ? `نرخ روز ثبت‌شده: ${formatRial(pricingConfig.ratePerGram18k)} — برای تسویه‌ی طلا در برابر طلا لازم نیست.`
            : 'برای بخش نقدی لازم است؛ تسویه‌ی طلا در برابر طلا بدون فی انجام می‌شود.',
          error: fieldErrors.ratePerBaseGram || '',
          onInput: (v) => {
            state.ratePerBaseGram = v;
            renderPreview();
          },
        })
      );

      // ── فاکتورهای باز (فقط اطلاع‌رسانی — انتخاب دستی وجود ندارد) ──
      if (reverse) body.appendChild(Alert({ variant: 'info', message: copy.note }));
      if (!reverse) body.appendChild(sectionTitle(copy.openTitle));
      if (!reverse) body.appendChild(
        Table({
          columns: [
            { header: 'شماره', cell: (r) => r.number || '—' },
            { header: 'تاریخ', cell: (r) => displayDate(r.date) },
            { header: 'جمع سند', numeric: true, cell: (r) => formatBaseGrams(r.grossGrams) },
            { header: 'مانده', numeric: true, cell: (r) => formatBaseGrams(r.outstandingGrams) },
          ],
          rows: openRows,
          emptyTitle: 'فاکتور بازی وجود ندارد',
          emptyDesc: copy.emptyOpen,
        })
      );

      // ── خطوط تسویه ──
      body.appendChild(
        sectionTitle(
          `خطوط ${copy.lineWord}`,
          Button({
            label: copy.addLine,
            variant: 'secondary',
            onClick: () => {
              state.lines.push(emptySettlement(accounts[0]?.id || '', nextKey));
              renderLines();
              renderPreview();
            },
          })
        )
      );
      linesHost = document.createElement('div');
      body.appendChild(linesHost);

      // ── تخفیف تسویه (فقط جهت عادی) ──
      if (!reverse) body.appendChild(sectionTitle('تخفیف تسویه (اختیاری)'));
      discountField = Input({
        label: copy.discountLabel,
        numeric: true,
        value: state.discountIRR,
        hint: copy.discountHint,
        onInput: (v) => {
          state.discountIRR = v;
          renderPreview();
        },
      });
      if (!reverse) body.appendChild(discountField);

      const notesField = Textarea({ label: 'توضیحات سند', rows: 2, value: state.description });
      notesField.getTextarea().addEventListener('input', () => {
        state.description = notesField.getTextarea().value;
      });
      body.appendChild(notesField);

      // ── پیش‌نمایش تخصیص ──
      previewHost = document.createElement('div');
      body.appendChild(previewHost);

      renderLines();
      renderPreview();
    }

    function clearErrors() {
      errorBox.innerHTML = '';
      form.querySelectorAll('.field--invalid').forEach((el) => el.classList.remove('field--invalid'));
      form.querySelectorAll('.field__error').forEach((el) => el.remove());
    }

    function buildInput() {
      return {
        partyType,
        partyId,
        direction,
        date: fromDateInputValue(state.date),
        ratePerBaseGram: num(state.ratePerBaseGram),
        discountIRR: num(state.discountIRR),
        discountNote: state.discountNote,
        description: state.description,
        lines: state.lines.map((l) =>
          l.method === 'gold'
            ? {
                method: 'gold',
                goldType: l.goldType,
                karat: num(l.karat),
                weightGrams: num(l.weightGrams),
                ratePerGram: num(l.ratePerGram),
                labName: l.labName || '',
              }
            : { method: 'cash', accountId: l.accountId, amountIRR: num(l.amountIRR) }
        ),
      };
    }

    async function submit(options) {
      return createSettlement(buildInput(), options);
    }

    function reportResult(result, extraNote = '') {
      settled = true;
      close();
      const rest = result.totals.unallocatedIRR;
      showToast(
        rest > 0.5
          ? `${copy.success} (${formatRial(rest)} علی‌الحساب)${extraNote}`
          : `${copy.success}${extraNote}`,
        { variant: rest > 0.5 ? 'warning' : 'success' }
      );
      resolve(true);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!accounts.length) return;
      clearErrors();
      saveBtn.disabled = true;

      let options = {};
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await submit(options);
          reportResult(result);
          return;
        } catch (err) {
          saveBtn.disabled = false;

          if (err instanceof SettlementGoldShortageError) {
            const s = err.shortages[0];
            const ok = await confirmDialog({
              title: 'موجودی طلا کافی نیست',
              message:
                `موجودی این سطل ${formatGrams(s.available)} است و این پرداخت ${formatGrams(s.requested)} ` +
                `می‌خواهد؛ کسری ${formatGrams(s.shortfall)}. اگر طلا واقعاً تحویل شده و با تأخیر ثبت می‌کنید، ادامه دهید.`,
              confirmLabel: 'بله، ثبت شود',
              danger: true,
            });
            if (!ok) return;
            options = { ...options, allowNegativeGold: true };
            saveBtn.disabled = true;
            continue;
          }

          if (err instanceof InsufficientBalanceError) {
            const s = err.shortages[0];
            const ok = await confirmDialog({
              title: 'موجودی حساب کافی نیست',
              message:
                `موجودی «${s.accountName}» ${formatRial(s.available)} است و این پرداخت ${formatRial(s.requested)} ` +
                `می‌خواهد؛ مانده ${formatRial(s.shortfall)} منفی می‌شود.`,
              confirmLabel: 'بله، ثبت شود',
              danger: true,
            });
            if (!ok) return;
            options = { ...options, allowNegativeCash: true };
            saveBtn.disabled = true;
            continue;
          }

          if (err instanceof SettlementValidationError) {
            lineErrors = err.lineErrors || {};
            fieldErrors = err.fieldErrors || {};
            renderLines();
            if (fieldErrors.discountIRR && discountField) {
              discountField.classList.add('field--invalid');
              const e2 = document.createElement('div');
              e2.className = 'field__error';
              e2.textContent = fieldErrors.discountIRR;
              discountField.appendChild(e2);
            }
            const messages = Object.values(fieldErrors).filter((m) => m !== fieldErrors.discountIRR);
            errorBox.appendChild(
              Alert({
                variant: 'danger',
                message: messages.length ? messages.join(' ') : 'لطفاً خطاهای فرم را برطرف کنید.',
              })
            );
            return;
          }

          console.error('[SettlementForm]', err);
          errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ثبت ناموفق بود.' }));
          return;
        }
      }
    });
  });
}
