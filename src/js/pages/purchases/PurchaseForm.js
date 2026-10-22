// PurchaseForm.js — فرم ثبت/اصلاح سند خرید (Phase 6)
//
// این فرم هیچ منطق مالی‌ای ندارد: تمام محاسبات از services/pricing.js از طریق
// computePurchaseTotals() می‌آید و ثبت از services/purchases.js. یعنی عددی که
// کاربر در نوار جمع می‌بیند **همان** عددی است که ذخیره می‌شود، نه یک محاسبه‌ی
// موازی در UI که ممکن است با سرویس واگرا شود.
import { KaratInput } from '../../components/KaratInput.js';
import { DEFAULT_FINENESS } from '../../services/units.js';
import { LabInput } from '../../components/LabInput.js';
import { labApplies, labSuggestions as loadLabSuggestions } from '../../services/labs.js';
import { unitsForConfig } from '../../services/goldTotals.js';
import { GRAM_EPS as GRAM_EPS_750 } from '../../services/units.js';
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { listSuppliers } from '../../services/suppliers.js';
import { listProducts } from '../../services/products.js';
import { ensureDefaultAccounts, listAccounts } from '../../services/accounts.js';
import { getPricingConfig } from '../../services/priceRates.js';
import { ratePerGramForKarat } from '../../services/pricing.js';
import {
  createPurchase,
  amendPurchase,
  computePurchaseTotals,
  derivePaymentMode,
  PurchaseValidationError,
  GoldShortageError,
  getPurchasePayments,
} from '../../services/purchases.js';
import {
  sectionTitle,
  summaryItem,
  attachError,
  emptySettlement,
  settlementFromRecord,
  settlementCard,
  equivalentHint,
} from '../docs/docFormParts.js';
import { formatRial, formatGrams, formatBaseGrams } from '../../utils/format.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import {
  GOLD_TYPE_OPTIONS,
  GOLD_TYPE_LABELS,
  PAYMENT_MODE_OPTIONS,
  PAYMENT_MODE_LABELS,
  WAGE_TYPE_OPTIONS,
  displayDateLong,
} from './purchaseLabels.js';

/** راهنمای هر حالت تسویه — همان سه جمله‌ای که جریان فرم را توضیح می‌دهد. */
const MODE_HINTS = {
  credit: 'بدون فی و بدون پرداخت؛ کل سند به گرم ۷۵۰ در حساب تأمین‌کننده می‌نشیند.',
  cash: 'فیِ سند لازم است و پرداخت‌ها باید مانده را دقیقاً صفر کنند.',
  mixed: 'فیِ سند لازم است؛ باقیمانده به گرم ۷۵۰ در حساب تأمین‌کننده می‌ماند.',
};

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

function emptyLine(config = {}) {
  const karat = DEFAULT_FINENESS; // Phase 22: عیار هزاری
  return {
    key: nextKey(),
    goldType: 'manufactured',
    productId: '',
    karat: String(karat),
    weightGrams: '',
    // (Phase 19) نرخ قلم **خالی** شروع می‌شود تا «فیِ سند» یک نرخ واحد برای کل سند
    // باشد. پیش‌پرکردن آن با نرخ روز باعث می‌شد فیِ واردشده‌ی کاربر روی مبلغ ریالی
    // اثر نکند و یک سند دو نرخ داشته باشد.
    ratePerGram: '',
    wageType: 'percent',
    wageValue: config.defaultWagePercent ? String(config.defaultWagePercent) : '',
    labName: '',
  };
}

function lineFromRecord(line) {
  return {
    key: nextKey(),
    goldType: line.goldType,
    productId: line.productId || '',
    karat: String(line.karat ?? ''),
    weightGrams: String(line.weightGrams ?? ''),
    ratePerGram: String(line.ratePerGram ?? ''),
    wageType: line.wageType || 'percent',
    wageValue: String(line.wageValue ?? ''),
    labName: line.labName || '',
  };
}

/**
 * فرم خرید را باز می‌کند.
 * @param {object} options `purchase` اگر داده شود، حالت «اصلاح» فعال می‌شود
 *   (سند قدیمی باطل و سند جدید ثبت می‌شود — BUSINESS_RULES §9).
 * @returns {Promise<object|null>} سند ثبت‌شده یا null در صورت انصراف
 */
export async function openPurchaseForm({ purchase = null } = {}) {
  const isAmend = !!purchase;

  await ensureDefaultAccounts();
  const [suppliers, products, accounts, pricingConfig, labNames] = await Promise.all([
    listSuppliers({ status: 'active' }),
    listProducts({ status: 'active' }),
    listAccounts(),
    // پیکربندی مؤثر موتور قیمت: نرخ روز + گام‌های گِردکردن (Phase 8).
    // فرم دقیقاً با همین پیکربندی محاسبه می‌کند تا عدد نمایش‌داده‌شده همان عدد ذخیره‌شده باشد.
    getPricingConfig(),
    loadLabSuggestions(),
  ]);
  const units = unitsForConfig(pricingConfig);

  const state = {
    supplierId: purchase?.supplierId || suppliers[0]?.id || '',
    date: toDateInputValue(purchase?.date),
    // (Phase 19) نوع تسویه **اولین انتخاب کاربر** است و ساختار بقیه‌ی فرم را می‌سازد،
    // نه چیزی که از روی پرداخت‌ها حدس زده شود.
    paymentMode: purchase?.paymentMode || 'credit',
    /** فیِ سند (ریال هر گرم ۷۵۰) — فقط برای بخش ریالی لازم است. */
    ratePerBaseGram: String(purchase?.ratePerBaseGram || pricingConfig.ratePerGram18k || ''),
    dueDate: purchase?.dueDate ? toDateInputValue(purchase.dueDate) : '',
    description: purchase?.description || '',
    lines: purchase?.lines?.length ? purchase.lines.map(lineFromRecord) : [emptyLine(pricingConfig)],
    payments: [],
  };

  if (isAmend) {
    const records = await getPurchasePayments(purchase);
    state.payments = records.map((rec) => settlementFromRecord(rec, nextKey));
  }

  let errors = { fields: {}, lines: {}, payments: {} };

  return new Promise((resolve) => {
    const body = document.createElement('div');
    let settled = false;

    const { modalEl, close } = openModal({
      title: isAmend ? `اصلاح سند خرید ${purchase.number}` : 'ثبت خرید جدید',
      content: body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      },
    });
    modalEl.classList.add('modal--full'); // (Phase 12) همین مودال، نه اولین مودال صفحه

    const form = document.createElement('form');
    form.className = 'purchase-form';
    body.appendChild(form);

    // ─────────────── تبدیل وضعیت فرم به ورودی سرویس ───────────────
    function buildPayload() {
      return {
        supplierId: state.supplierId,
        date: fromDateInputValue(state.date),
        paymentMode: state.paymentMode,
        ratePerBaseGram: state.paymentMode === 'credit' ? 0 : Number(state.ratePerBaseGram) || 0,
        dueDate: state.dueDate ? fromDateInputValue(state.dueDate) : null,
        description: state.description,
        lines: state.lines.map((l) => ({
          productId: l.productId || null,
          goldType: l.goldType,
          karat: Number(l.karat),
          weightGrams: Number(l.weightGrams),
          ratePerGram: Number(l.ratePerGram),
          wageType: l.wageType,
          wageValue: Number(l.wageValue),
          labName: l.labName || '',
        })),
        payments: state.payments.map((p) =>
          p.method === 'gold'
            ? {
                method: 'gold',
                goldType: p.goldType,
                karat: Number(p.karat),
                weightGrams: Number(p.weightGrams),
                ratePerGram: Number(p.ratePerGram),
                labName: p.labName || '',
              }
            : { method: 'cash', accountId: p.accountId, amountIRR: Number(p.amountIRR) }
        ),
      };
    }

    // ─────────────────────── نوار جمع فاکتور ───────────────────────
    const totalsBar = document.createElement('div');
    totalsBar.className = 'summary-bar purchase-totals';

    const dueWrap = document.createElement('div');

    function updateTotals() {
      const totals = computePurchaseTotals(buildPayload(), pricingConfig);
      const derived = derivePaymentMode(totals);
      const rate = totals.ratePerBaseGram;

      totalsBar.innerHTML = '';
      // (Phase 19) عدد اصلی «گرم ۷۵۰» است و معادل ریالی کنارش — تصمیم «هر دو کنار هم».
      totalsBar.append(
        summaryItem('وزن کل', formatGrams(totals.totalWeightGrams)),
        summaryItem('طلای خالص', formatBaseGrams(totals.totalBaseGrams)),
        summaryItem('اجرت', formatBaseGrams(totals.totalWageGrams)),
        summaryItem('جمع سند', formatBaseGrams(totals.grandTotalGrams)),
        summaryItem('پرداخت‌شده', formatBaseGrams(totals.paidTotalGrams), 'success'),
        summaryItem(
          'مانده',
          formatBaseGrams(totals.remainingGrams),
          Math.abs(totals.remainingGrams) > GRAM_EPS_750 ? 'danger' : 'success'
        ),
        summaryItem('نوع تسویه', PAYMENT_MODE_LABELS[derived])
      );
      if (rate > 0) {
        totalsBar.append(
          summaryItem('معادل ریالی سند', formatRial(totals.grandTotalIRR)),
          summaryItem('معادل ریالی مانده', formatRial(totals.remainingIRR))
        );
      }

      if (modeSelect) {
        const mismatch = derived !== state.paymentMode;
        modeHint.textContent = mismatch
          ? `پرداخت‌های واردشده با «${PAYMENT_MODE_LABELS[state.paymentMode]}» نمی‌خواند — بر اساس پرداخت‌ها: «${PAYMENT_MODE_LABELS[derived]}».`
          : MODE_HINTS[state.paymentMode];
        modeHint.className = `field__hint${mismatch ? ' field__hint--warn' : ''}`;
      }

      // سررسید فقط وقتی معنا دارد که مقداری باقی مانده باشد
      dueWrap.hidden = totals.remainingGrams <= GRAM_EPS_750;
      return totals;
    }

    // ───────────────────────── فیلدهای سند ─────────────────────────
    let modeSelect = null;
    const modeHint = document.createElement('div');
    modeHint.className = 'field__hint';

    function renderHeaderFields() {
      const grid = document.createElement('div');
      grid.className = 'form-grid';

      const supplierSelect = Select({
        label: 'تأمین‌کننده',
        required: true,
        value: state.supplierId,
        options: suppliers.length
          ? suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))
          : [{ value: '', label: 'تأمین‌کننده‌ای ثبت نشده است' }],
        onChange: (v) => {
          state.supplierId = v;
        },
      });
      attachError(supplierSelect, errors.fields.supplierId);

      const dateField = Input({
        label: 'تاریخ خرید',
        type: 'date',
        required: true,
        value: state.date,
        hint: displayDateLong(fromDateInputValue(state.date)),
        error: errors.fields.date || '',
        onInput: (v) => {
          state.date = v;
          render();
        },
      });

      // ── گام اول: نوع تسویه ──
      modeSelect = Select({
        label: 'نوع تسویه (گام اول)',
        value: state.paymentMode,
        options: PAYMENT_MODE_OPTIONS,
        onChange: (v) => {
          state.paymentMode = v;
          // رسیدی هیچ پرداختی ندارد؛ نگه‌داشتن خطوط قبلی یعنی سندی که کاربر
          // «رسیدی» انتخاب کرده ولی در واقع ترکیبی ثبت شود.
          if (v === 'credit') state.payments = [];
          render();
        },
      });
      modeSelect.appendChild(modeHint);
      modeHint.textContent = MODE_HINTS[state.paymentMode];
      attachError(modeSelect, errors.fields.paymentMode);

      grid.append(modeSelect, supplierSelect, dateField);

      // ── فی فقط برای بخش ریالی ──
      if (state.paymentMode !== 'credit') {
        const rateField = Input({
          label: 'فیِ سند — ریال هر گرم ۷۵۰',
          numeric: true,
          required: true,
          value: state.ratePerBaseGram,
          hint: pricingConfig.ratePerGram18k
            ? `نرخ روز ثبت‌شده: ${formatRial(pricingConfig.ratePerGram18k)}`
            : 'نرخ روز هنوز ثبت نشده — همین‌جا وارد کنید.',
          error: errors.fields.ratePerBaseGram || '',
          onInput: (v) => {
            state.ratePerBaseGram = v;
            updateTotals();
          },
        });
        grid.append(rateField);
      }
      return grid;
    }

    // ──────────────────────── اقلام خرید ────────────────────────
    function renderLine(line, index) {
      const card = document.createElement('div');
      card.className = 'doc-line';
      const err = errors.lines[index] || {};

      const head = document.createElement('div');
      head.className = 'doc-line__head';
      const title = document.createElement('span');
      title.className = 'doc-line__title';
      title.textContent = `قلم ${index + 1}`;
      head.appendChild(title);
      if (state.lines.length > 1) {
        const removeBtn = Button({
          label: 'حذف',
          variant: 'ghost',
          onClick: () => {
            state.lines.splice(index, 1);
            render();
          },
        });
        head.appendChild(removeBtn);
      }
      card.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'form-grid';

      const typeSelect = Select({
        label: 'نوع طلا',
        value: line.goldType,
        options: GOLD_TYPE_OPTIONS,
        onChange: (v) => {
          line.goldType = v;
          line.productId = '';
          render();
        },
      });

      const matching = products.filter((p) => p.type === line.goldType);
      const productSelect = Select({
        label: 'کالا (اختیاری)',
        value: line.productId,
        options: [{ value: '', label: 'بدون کالای مشخص' }, ...matching.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }))],
        hint: err.productId ? '' : 'انتخاب کالا موجودی را به همان کالا نسبت می‌دهد.',
        onChange: (v) => {
          line.productId = v;
          const product = matching.find((p) => p.id === v);
          if (product) {
            line.karat = String(product.karat);
            if (product.type === 'manufactured') {
              line.wageType = product.wageType || 'percent';
              line.wageValue = String(product.wageValue ?? '');
            }
            if (product.priceToday) line.ratePerGram = String(product.priceToday);
          }
          render();
        },
      });
      attachError(productSelect, err.productId);

      const isLab = labApplies(line.goldType);
      const equiv = equivalentHint(line, units);
      const karatField = KaratInput({
        value: line.karat,
        error: err.karat || '',
        hint: isLab ? 'عیار واقعی از برگه‌ی آزمایشگاه (هزاری، مثلاً ۷۴۰)' : undefined,
        onInput: (v) => {
          line.karat = v;
          equiv.update();
          // نرخ پیشنهادی به عیار وابسته است، پس کارت قلم دوباره رندر می‌شود.
          if (!line.ratePerGram && state.paymentMode !== 'credit') render();
          else updateTotals();
        },
      });
      const weightField = Input({
        label: 'وزن (گرم)',
        numeric: true,
        required: true,
        value: line.weightGrams,
        error: err.weightGrams || '',
        onInput: (v) => {
          line.weightGrams = v;
          equiv.update();
          updateTotals();
        },
      });
      grid.append(typeSelect, productSelect, karatField, weightField, equiv);
      // Phase 23: آزمایشگاه برای آبشده/متفرقه (اختیاری؛ Snapshot روی قلم).
      if (isLab) {
        grid.append(
          LabInput({
            value: line.labName,
            suggestions: labNames,
            error: err.labName || '',
            onInput: (v) => {
              line.labName = v;
            },
          })
        );
      }

      // (Phase 19) نرخ هر گرم **اختیاری** است: سند رسیدی به گرم ۷۵۰ حساب می‌شود و
      // هیچ نرخی نمی‌خواهد. در حالت نقدی/ترکیبی هم اگر خالی بماند، فیِ سند
      // استفاده می‌شود؛ این فیلد فقط برای قلمی است که نرخ توافقی جدا دارد.
      if (state.paymentMode !== 'credit') {
        const suggestedRate = ratePerGramForKarat(Number(line.karat), pricingConfig);
        const rateField = Input({
          label: 'نرخ هر گرم (اختیاری)',
          numeric: true,
          value: line.ratePerGram,
          hint:
            suggestedRate > 0
              ? `خالی بگذارید تا فیِ سند اعمال شود (نرخ روز این عیار: ${formatRial(suggestedRate)})`
              : 'خالی بگذارید تا فیِ سند اعمال شود.',
          error: err.ratePerGram || '',
          onInput: (v) => {
            line.ratePerGram = v;
            updateTotals();
          },
        });
        grid.append(rateField);
      }

      if (line.goldType === 'manufactured') {
        const wageTypeSelect = Select({
          label: 'نوع اجرت',
          value: line.wageType,
          options: WAGE_TYPE_OPTIONS,
          onChange: (v) => {
            line.wageType = v;
            updateTotals();
          },
        });
        const wageField = Input({
          label: line.wageType === 'perGram' ? 'اجرت هر گرم (ریال)' : 'اجرت (درصد)',
          numeric: true,
          value: line.wageValue,
          error: err.wageValue || '',
          onInput: (v) => {
            line.wageValue = v;
            updateTotals();
          },
        });
        grid.append(wageTypeSelect, wageField);
      } else {
        const note = document.createElement('div');
        note.className = 'doc-line__note';
        note.textContent = `${GOLD_TYPE_LABELS[line.goldType]} اجرت ندارد؛ مبلغ فقط وزن × نرخ است.`;
        card.appendChild(note);
      }

      card.appendChild(grid);
      return card;
    }

    // ───────────────────────── پرداخت‌ها ─────────────────────────
    // کارت خط پرداخت با فرم فروش مشترک است (pages/docs/docFormParts.js).
    function renderPayment(pay, index) {
      return settlementCard({
        entry: pay,
        index,
        accounts,
        errors: errors.payments[index] || {},
        label: 'پرداخت',
        goldLabel: 'پرداخت با طلا',
        goldTypeLabel: 'نوع طلای پرداختی',
        rateHint: 'ارزش طلای پرداختی که از بدهی کم می‌شود.',
        goldTypeOptions: GOLD_TYPE_OPTIONS,
        labSuggestions: labNames,
        units,
        onStructuralChange: render,
        onValueChange: updateTotals,
        onRemove: () => {
          state.payments.splice(index, 1);
          render();
        },
      });
    }

    // ─────────────────────────── رندر کامل ───────────────────────────
    function render() {
      form.innerHTML = '';

      if (isAmend) {
        form.appendChild(
          Alert({
            variant: 'warning',
            message: `اصلاح سند ${purchase.number}: سند فعلی باطل می‌شود و یک سند جدید با شماره تازه ثبت می‌گردد (اثر مالی سند قبلی کاملاً برگردانده می‌شود).`,
          })
        );
      }
      if (!suppliers.length) {
        form.appendChild(Alert({ variant: 'danger', message: 'ابتدا باید حداقل یک تأمین‌کننده ثبت کنید.' }));
      }
      if (errors.fields.payments) {
        form.appendChild(Alert({ variant: 'danger', message: errors.fields.payments }));
      }

      form.appendChild(renderHeaderFields());

      // اقلام
      const linesSection = document.createElement('div');
      linesSection.className = 'form-section';
      linesSection.appendChild(
        sectionTitle(
          'اقلام خرید',
          Button({
            label: 'افزودن قلم',
            variant: 'secondary',
            icon: '+',
            onClick: () => {
              state.lines.push(emptyLine(pricingConfig));
              render();
            },
          })
        )
      );
      if (errors.fields.lines) {
        linesSection.appendChild(Alert({ variant: 'danger', message: errors.fields.lines }));
      }
      state.lines.forEach((line, i) => linesSection.appendChild(renderLine(line, i)));
      form.appendChild(linesSection);

      // پرداخت‌ها — در حالت «رسیدی» اصلاً نمایش داده نمی‌شود
      if (state.paymentMode !== 'credit') {
        const paySection = document.createElement('div');
        paySection.className = 'form-section';
        paySection.appendChild(
          sectionTitle(
            'پرداخت‌ها',
            Button({
              label: 'افزودن پرداخت',
              variant: 'secondary',
              icon: '+',
              onClick: () => {
                state.payments.push(emptySettlement(accounts[0]?.id, nextKey));
                render();
              },
            })
          )
        );
        if (!state.payments.length) {
          const note = document.createElement('div');
          note.className = 'doc-line__note';
          note.textContent =
            state.paymentMode === 'cash'
              ? 'برای سند نقدی باید پرداخت‌هایی ثبت کنید که مانده را دقیقاً صفر کنند.'
              : 'برای سند ترکیبی، بخشی را پرداخت کنید؛ باقیمانده به گرم ۷۵۰ در حساب تأمین‌کننده می‌نشیند.';
          paySection.appendChild(note);
        }
        state.payments.forEach((pay, i) => paySection.appendChild(renderPayment(pay, i)));
        form.appendChild(paySection);
      } else {
        const note = document.createElement('div');
        note.className = 'doc-line__note';
        note.textContent =
          'سند رسیدی: کل مقدار به گرم ۷۵۰ در حساب تأمین‌کننده می‌نشیند. نه فی لازم است، نه پرداخت.';
        form.appendChild(note);
      }

      // سررسید + توضیحات
      dueWrap.innerHTML = '';
      dueWrap.appendChild(
        Input({
          label: 'تاریخ سررسید مانده (اختیاری)',
          type: 'date',
          value: state.dueDate,
          error: errors.fields.dueDate || '',
          hint: state.dueDate
            ? displayDateLong(fromDateInputValue(state.dueDate))
            : 'خالی بگذارید اگر سررسید مشخصی ندارد.',
          onInput: (v) => {
            state.dueDate = v;
            render();
          },
        })
      );
      form.appendChild(dueWrap);

      form.appendChild(
        Textarea({
          label: 'توضیحات',
          value: state.description,
          rows: 2,
          onInput: (v) => {
            state.description = v;
          },
        })
      );

      form.appendChild(totalsBar);

      const actions = document.createElement('div');
      actions.className = 'modal__actions';
      actions.append(
        Button({ label: 'انصراف', variant: 'secondary', onClick: () => close() }),
        Button({ label: isAmend ? 'ثبت سند اصلاحی' : 'ثبت خرید', variant: 'primary', type: 'submit' })
      );
      form.appendChild(actions);

      updateTotals();
    }

    // ─────────────────────────── ارسال فرم ───────────────────────────
    async function submit(allowNegativeGold = false) {
      const payload = buildPayload();
      try {
        const result = isAmend
          ? await amendPurchase(purchase.id, payload, { allowNegativeGold })
          : await createPurchase(payload, { allowNegativeGold });
        settled = true;
        close();
        showToast(
          isAmend ? `سند اصلاحی ${result.purchase.number} ثبت شد.` : `خرید ${result.purchase.number} ثبت شد.`,
          { variant: 'success' }
        );
        resolve(result.purchase);
      } catch (err) {
        if (err instanceof GoldShortageError) {
          const lines = err.shortages
            .map(
              (s) =>
                `${GOLD_TYPE_LABELS[s.goldType] || s.goldType} عیار ${s.karat}: موجودی ${formatGrams(s.available)}، ` +
                `درخواست ${formatGrams(s.requested)} (کسری ${formatGrams(s.shortfall)})`
            )
            .join('\n');
          const confirmed = await confirmDialog({
            title: 'موجودی طلا کافی نیست',
            message: `${lines}\n\nثبت این سند موجودی را منفی می‌کند. ادامه می‌دهید؟`,
            confirmLabel: 'بله، ثبت کن',
            danger: true,
          });
          if (confirmed) await submit(true);
          return;
        }
        if (err instanceof PurchaseValidationError) {
          errors = { fields: err.fieldErrors, lines: err.lineErrors, payments: err.paymentErrors };
          render();
          showToast('لطفاً خطاهای مشخص‌شده را برطرف کنید.', { variant: 'danger' });
          return;
        }
        console.error('[PurchaseForm] submit', err);
        showToast(err?.message || 'ثبت سند خرید ناموفق بود.', { variant: 'danger' });
      }
    }

    // Phase 17: گاردِ ثبت دوباره. روی صفحه‌ی لمسی، دو ضربه‌ی پشت‌سرهم روی «ثبت»
    // دو بار این فرم را ارسال می‌کرد؛ اگر ضربه‌ی دوم پس از تکمیل اولی می‌رسید،
    // یک سند **تکراری** با شماره‌ی جدید ساخته می‌شد و طلا دو بار از انبار خارج می‌شد.
    let inFlight = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (inFlight) return;
      inFlight = true;
      Promise.resolve(submit(false)).finally(() => {
        inFlight = false;
      });
    });

    render();
  });
}
