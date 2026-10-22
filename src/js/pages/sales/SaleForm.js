// SaleForm.js — فرم ثبت فاکتور فروش (Phase 7)
//
// مثل فرم خرید، هیچ منطق مالی‌ای اینجا نیست: جمع‌ها از computeSaleTotals() سرویس
// می‌آید و ثبت از services/sales.js. دو تفاوت مهم با فرم خرید:
//   ۱) کنار هر قلم، **موجودی قابل فروش** همان سطل نمایش داده می‌شود تا کاربر پیش از
//      ثبت بداند چقدر دارد (فروش بیش از موجودی در سرویس بلاک می‌شود).
//   ۲) فیلدهای سود و مالیات هر قلم و تخفیف کل فاکتور اضافه شده‌اند.
//
// نکته: فاکتور فروش «اصلاح» ندارد. طبق BUSINESS_RULES §9 سند ثبت‌شده ویرایش نمی‌شود؛
// برای اشتباه، سند لغو می‌شود و برای مرجوعی مشتری، سند برگشت ثبت می‌گردد.
import { KaratInput } from '../../components/KaratInput.js';
import { DEFAULT_FINENESS } from '../../services/units.js';
import { GRAM_EPS as GRAM_EPS_750 } from '../../services/units.js';
import { labSuggestions as loadLabSuggestions } from '../../services/labs.js';
import { unitsForConfig } from '../../services/goldTotals.js';
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { listCustomers } from '../../services/customers.js';
import { listProducts } from '../../services/products.js';
import { ensureDefaultAccounts, listAccounts } from '../../services/accounts.js';
import { getPricingConfig } from '../../services/priceRates.js';
import { ratePerGramForKarat } from '../../services/pricing.js';
import { inventoryRefId } from '../../services/ledger.js';
import {
  createSale,
  computeSaleTotals,
  derivePaymentMode,
  availableStock,
  SaleValidationError,
  InsufficientStockError,
} from '../../services/sales.js';
import {
  sectionTitle,
  summaryItem,
  attachError,
  emptySettlement,
  settlementCard,
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
} from './saleLabels.js';

let keySeq = 0;
const nextKey = () => `s${++keySeq}`;

/** راهنمای هر حالت تسویه — همان سه جمله‌ای که جریان فرم را توضیح می‌دهد. */
const MODE_HINTS = {
  credit: 'بدون فی و بدون دریافت؛ کل فاکتور به گرم ۷۵۰ در حساب مشتری می‌نشیند.',
  cash: 'فیِ فاکتور لازم است و دریافت‌ها باید مانده را دقیقاً صفر کنند.',
  mixed: 'فیِ فاکتور لازم است؛ باقیمانده به گرم ۷۵۰ در حساب مشتری می‌ماند.',
};

function emptyLine(config = {}) {
  const karat = DEFAULT_FINENESS; // Phase 22: عیار هزاری
  const rate = ratePerGramForKarat(karat, config);
  return {
    key: nextKey(),
    goldType: 'manufactured',
    productId: '',
    karat: String(karat),
    weightGrams: '',
    // نرخ روز و درصدهای پیش‌فرض فقط **پیشنهاد** اولیه‌اند؛ مقدار نهایی در فاکتور Snapshot می‌شود.
    // (Phase 19) نرخ قلم خالی شروع می‌شود تا «فیِ فاکتور» نرخ واحد کل سند باشد.
    ratePerGram: '',
    wageType: 'percent',
    wageValue: config.defaultWagePercent ? String(config.defaultWagePercent) : '',
    profitPercent: config.defaultProfitPercent ? String(config.defaultProfitPercent) : '',
    taxPercent: config.defaultTaxPercent ? String(config.defaultTaxPercent) : '',
  };
}

/**
 * فرم فروش را باز می‌کند.
 * @returns {Promise<object|null>} فاکتور ثبت‌شده یا null در صورت انصراف
 */
export async function openSaleForm() {
  await ensureDefaultAccounts();
  const [customers, products, accounts, pricingConfig, stock, labNames] = await Promise.all([
    listCustomers({ status: 'active' }),
    listProducts({ status: 'active' }),
    listAccounts(),
    // پیکربندی مؤثر موتور قیمت (نرخ روز + گام‌های گِردکردن) — Phase 8
    getPricingConfig(),
    availableStock(),
    loadLabSuggestions(),
  ]);

  const state = {
    customerId: customers[0]?.id || '',
    date: toDateInputValue(),
    paymentMode: 'credit',
    /** فیِ فاکتور (ریال هر گرم ۷۵۰) — فقط برای بخش ریالی لازم است. */
    ratePerBaseGram: String(pricingConfig.ratePerGram18k || ''),
    dueDate: '',
    discountIRR: '',
    description: '',
    lines: [emptyLine(pricingConfig)],
    receipts: [],
  };

  let errors = { fields: {}, lines: {}, receipts: {} };

  /** موجودی سطلی که این قلم از آن خارج می‌شود (برای نمایش کنار فیلد وزن). */
  function stockOf(line) {
    if (!line.goldType) return null;
    const refId = inventoryRefId({
      goldType: line.goldType,
      karat: Number(line.karat),
      productId: line.productId || null,
    });
    return stock.get(refId)?.grams || 0;
  }

  return new Promise((resolve) => {
    const body = document.createElement('div');
    let settled = false;

    const { modalEl, close } = openModal({
      title: 'ثبت فروش جدید',
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
    form.className = 'purchase-form sale-form';
    body.appendChild(form);

    function buildPayload() {
      return {
        customerId: state.customerId,
        date: fromDateInputValue(state.date),
        paymentMode: state.paymentMode,
        ratePerBaseGram: state.paymentMode === 'credit' ? 0 : Number(state.ratePerBaseGram) || 0,
        dueDate: state.dueDate ? fromDateInputValue(state.dueDate) : null,
        discountIRR: Number(state.discountIRR) || 0,
        description: state.description,
        lines: state.lines.map((l) => ({
          productId: l.productId || null,
          goldType: l.goldType,
          karat: Number(l.karat),
          weightGrams: Number(l.weightGrams),
          ratePerGram: Number(l.ratePerGram),
          wageType: l.wageType,
          wageValue: Number(l.wageValue),
          profitPercent: Number(l.profitPercent),
          taxPercent: Number(l.taxPercent),
        })),
        receipts: state.receipts.map((r) =>
          r.method === 'gold'
            ? {
                method: 'gold',
                goldType: r.goldType,
                karat: Number(r.karat),
                weightGrams: Number(r.weightGrams),
                ratePerGram: Number(r.ratePerGram),
                labName: r.labName || '',
              }
            : { method: 'cash', accountId: r.accountId, amountIRR: Number(r.amountIRR) }
        ),
      };
    }

    const totalsBar = document.createElement('div');
    totalsBar.className = 'summary-bar purchase-totals';
    const dueWrap = document.createElement('div');
    let modeSelect = null;
    const modeHint = document.createElement('div');
    modeHint.className = 'field__hint';

    function updateTotals() {
      const totals = computeSaleTotals(buildPayload(), pricingConfig);
      const derived = derivePaymentMode(totals);

      totalsBar.innerHTML = '';
      totalsBar.append(
        summaryItem('وزن کل', formatGrams(totals.totalWeightGrams)),
        summaryItem('طلای خالص', formatBaseGrams(totals.totalBaseGrams)),
        summaryItem('اجرت', formatBaseGrams(totals.totalWageGrams)),
        summaryItem('سود', formatBaseGrams(totals.totalProfitGrams)),
        summaryItem('تخفیف', formatBaseGrams(totals.discountGrams), totals.discountGrams > 0 ? 'danger' : ''),
        summaryItem('مالیات', formatBaseGrams(totals.totalTaxGrams)),
        summaryItem('جمع فاکتور', formatBaseGrams(totals.grandTotalGrams)),
        summaryItem('دریافت‌شده', formatBaseGrams(totals.receivedTotalGrams), 'success'),
        summaryItem(
          'مانده',
          formatBaseGrams(totals.remainingGrams),
          Math.abs(totals.remainingGrams) > GRAM_EPS_750 ? 'danger' : 'success'
        ),
        summaryItem('نوع تسویه', PAYMENT_MODE_LABELS[derived])
      );
      if (totals.ratePerBaseGram > 0) {
        totalsBar.append(
          summaryItem('معادل ریالی فاکتور', formatRial(totals.grandTotalIRR)),
          summaryItem('معادل ریالی مانده', formatRial(totals.remainingIRR))
        );
      }
      if (modeSelect) {
        const mismatch = derived !== state.paymentMode;
        modeHint.textContent = mismatch
          ? `دریافت‌های واردشده با «${PAYMENT_MODE_LABELS[state.paymentMode]}» نمی‌خواند — بر اساس دریافت‌ها: «${PAYMENT_MODE_LABELS[derived]}».`
          : MODE_HINTS[state.paymentMode];
        modeHint.className = `field__hint${mismatch ? ' field__hint--warn' : ''}`;
      }

      dueWrap.hidden = totals.remainingGrams <= GRAM_EPS_750;
      return totals;
    }

    function renderHeaderFields() {
      const grid = document.createElement('div');
      grid.className = 'form-grid';

      const customerSelect = Select({
        label: 'مشتری',
        required: true,
        value: state.customerId,
        options: customers.length
          ? customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))
          : [{ value: '', label: 'مشتری‌ای ثبت نشده است' }],
        onChange: (v) => {
          state.customerId = v;
        },
      });
      attachError(customerSelect, errors.fields.customerId);

      const dateField = Input({
        label: 'تاریخ فروش',
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
          if (v === 'credit') state.receipts = [];
          render();
        },
      });
      modeSelect.appendChild(modeHint);
      modeHint.textContent = MODE_HINTS[state.paymentMode];
      attachError(modeSelect, errors.fields.paymentMode);

      grid.append(modeSelect, customerSelect, dateField);

      if (state.paymentMode !== 'credit') {
        grid.append(
          Input({
            label: 'فیِ فاکتور — ریال هر گرم ۷۵۰',
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
          })
        );
      }
      return grid;
    }

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
        head.appendChild(
          Button({
            label: 'حذف',
            variant: 'ghost',
            onClick: () => {
              state.lines.splice(index, 1);
              render();
            },
          })
        );
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
        options: [
          { value: '', label: 'بدون کالای مشخص' },
          ...matching.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
        ],
        onChange: (v) => {
          line.productId = v;
          const product = matching.find((p) => p.id === v);
          if (product) {
            // مقادیر کالا فقط **پیش‌فرض** فرم‌اند؛ مقدار نهایی در فاکتور Snapshot می‌شود.
            line.karat = String(product.karat);
            if (product.type === 'manufactured') {
              line.wageType = product.wageType || 'percent';
              line.wageValue = String(product.wageValue ?? '');
              line.profitPercent = String(product.profitPercent ?? '');
            }
            line.taxPercent = String(product.taxPercent ?? '');
            if (product.priceToday) line.ratePerGram = String(product.priceToday);
          }
          render();
        },
      });
      attachError(productSelect, err.productId);

      const available = stockOf(line);
      const karatField = KaratInput({
        value: line.karat,
        error: err.karat || '',
        onInput: (v) => {
          line.karat = v;
          render();
        },
      });
      const weightField = Input({
        label: 'وزن (گرم)',
        numeric: true,
        required: true,
        value: line.weightGrams,
        hint: available !== null ? `موجودی این سطل: ${formatGrams(available)}` : '',
        error: err.weightGrams || '',
        onInput: (v) => {
          line.weightGrams = v;
          updateTotals();
        },
      });
      grid.append(typeSelect, productSelect, karatField, weightField);

      // (Phase 19) قیمت روز هر گرم **اختیاری** است؛ فاکتور رسیدی اصلاً نرخ نمی‌خواهد.
      if (state.paymentMode !== 'credit') {
        const suggestedRate = ratePerGramForKarat(Number(line.karat), pricingConfig);
        const rateField = Input({
          label: 'قیمت روز هر گرم (اختیاری)',
          numeric: true,
          value: line.ratePerGram,
          hint:
            suggestedRate > 0
              ? `خالی بگذارید تا فیِ فاکتور اعمال شود (نرخ روز این عیار: ${formatRial(suggestedRate)})`
              : 'خالی بگذارید تا فیِ فاکتور اعمال شود.',
          error: err.ratePerGram || '',
          onInput: (v) => {
            line.ratePerGram = v;
            updateTotals();
          },
        });
        grid.append(rateField);
      }

      if (line.goldType === 'manufactured') {
        grid.append(
          Select({
            label: 'نوع اجرت',
            value: line.wageType,
            options: WAGE_TYPE_OPTIONS,
            onChange: (v) => {
              line.wageType = v;
              render();
            },
          }),
          Input({
            label: line.wageType === 'perGram' ? 'اجرت هر گرم (ریال)' : 'اجرت (درصد)',
            numeric: true,
            value: line.wageValue,
            error: err.wageValue || '',
            onInput: (v) => {
              line.wageValue = v;
              updateTotals();
            },
          }),
          Input({
            label: 'سود (درصد)',
            numeric: true,
            value: line.profitPercent,
            error: err.profitPercent || '',
            onInput: (v) => {
              line.profitPercent = v;
              updateTotals();
            },
          })
        );
      } else {
        const note = document.createElement('div');
        note.className = 'doc-line__note';
        note.textContent = `${GOLD_TYPE_LABELS[line.goldType]} اجرت و سود ندارد؛ مبلغ از وزن × قیمت روز محاسبه می‌شود.`;
        card.appendChild(note);
      }

      grid.appendChild(
        Input({
          label: 'مالیات (درصد)',
          numeric: true,
          value: line.taxPercent,
          error: err.taxPercent || '',
          onInput: (v) => {
            line.taxPercent = v;
            updateTotals();
          },
        })
      );

      card.appendChild(grid);
      return card;
    }

    function renderReceipt(rec, index) {
      return settlementCard({
        entry: rec,
        index,
        accounts,
        errors: errors.receipts[index] || {},
        label: 'دریافت',
        goldLabel: 'دریافت طلا از مشتری',
        goldTypeLabel: 'نوع طلای دریافتی',
        rateHint: 'ارزش طلای دریافتی که از مبلغ فاکتور کم می‌شود.',
        goldTypeOptions: GOLD_TYPE_OPTIONS,
        labSuggestions: labNames,
        units: unitsForConfig(pricingConfig),
        onStructuralChange: render,
        onValueChange: updateTotals,
        onRemove: () => {
          state.receipts.splice(index, 1);
          render();
        },
      });
    }

    function render() {
      form.innerHTML = '';

      if (!customers.length) {
        form.appendChild(Alert({ variant: 'danger', message: 'ابتدا باید حداقل یک مشتری ثبت کنید.' }));
      }
      if (errors.fields.receipts) {
        form.appendChild(Alert({ variant: 'danger', message: errors.fields.receipts }));
      }

      form.appendChild(renderHeaderFields());

      const linesSection = document.createElement('div');
      linesSection.className = 'form-section';
      linesSection.appendChild(
        sectionTitle(
          'اقلام فروش',
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
      if (errors.fields.lines) linesSection.appendChild(Alert({ variant: 'danger', message: errors.fields.lines }));
      state.lines.forEach((line, i) => linesSection.appendChild(renderLine(line, i)));
      form.appendChild(linesSection);

      const receiptsSection = document.createElement('div');
      receiptsSection.className = 'form-section';
      receiptsSection.hidden = state.paymentMode === 'credit';
      receiptsSection.appendChild(
        sectionTitle(
          'دریافت‌ها',
          Button({
            label: 'افزودن دریافت',
            variant: 'secondary',
            icon: '+',
            onClick: () => {
              state.receipts.push(emptySettlement(accounts[0]?.id, nextKey));
              render();
            },
          })
        )
      );
      if (!state.receipts.length) {
        const note = document.createElement('div');
        note.className = 'doc-line__note';
        note.textContent =
          state.paymentMode === 'cash'
            ? 'برای فاکتور نقدی باید دریافت‌هایی ثبت کنید که مانده را دقیقاً صفر کنند.'
            : 'بخشی را دریافت کنید؛ باقیمانده به گرم ۷۵۰ در حساب مشتری می‌نشیند.';
        receiptsSection.appendChild(note);
      }
      state.receipts.forEach((rec, i) => receiptsSection.appendChild(renderReceipt(rec, i)));
      form.appendChild(receiptsSection);

      form.appendChild(
        Input({
          label: 'تخفیف کل فاکتور (ریال)',
          numeric: true,
          value: state.discountIRR,
          hint: 'تخفیف پیش از محاسبه مالیات و به نسبت مبلغ اقلام سرشکن می‌شود.',
          error: errors.fields.discountIRR || '',
          onInput: (v) => {
            state.discountIRR = v;
            updateTotals();
          },
        })
      );

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
        Button({ label: 'ثبت فروش', variant: 'primary', type: 'submit' })
      );
      form.appendChild(actions);

      updateTotals();
    }

    async function submit() {
      try {
        const result = await createSale(buildPayload());
        settled = true;
        close();
        showToast(`فاکتور ${result.sale.number} ثبت شد.`, { variant: 'success' });
        resolve(result.sale);
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          // بلاک‌کننده است: هیچ مسیر «ادامه با تأیید» وجود ندارد (دستور Phase 7).
          const message = err.shortages
            .map(
              (s) =>
                `${GOLD_TYPE_LABELS[s.goldType] || s.goldType} عیار ${s.karat}: موجودی ${formatGrams(s.available)}، ` +
                `درخواست ${formatGrams(s.requested)} (کسری ${formatGrams(s.shortfall)})`
            )
            .join(' | ');
          errors = { fields: {}, lines: {}, receipts: {} };
          render();
          form.prepend(
            Alert({ variant: 'danger', message: `فروش بیش از موجودی مجاز نیست — ${message}` })
          );
          showToast('موجودی کافی نیست؛ فاکتور ثبت نشد.', { variant: 'danger' });
          return;
        }
        if (err instanceof SaleValidationError) {
          errors = { fields: err.fieldErrors, lines: err.lineErrors, receipts: err.receiptErrors };
          render();
          showToast('لطفاً خطاهای مشخص‌شده را برطرف کنید.', { variant: 'danger' });
          return;
        }
        console.error('[SaleForm] submit', err);
        showToast(err?.message || 'ثبت فاکتور ناموفق بود.', { variant: 'danger' });
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
      Promise.resolve(submit()).finally(() => {
        inFlight = false;
      });
    });

    render();
  });
}
