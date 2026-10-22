// TransferForm.js — مودال انتقال بین حساب‌ها (Phase 9)
//
// فرم عمداً دو حالت دارد (وجه / طلا) اما یک مسیر ثبت: services/transfers.js.
// قاعده‌ی «هم‌واحد بودن» در همان سرویس اعمال می‌شود؛ این فرم فقط گزینه‌های نامعتبر
// را از دید کاربر پنهان می‌کند تا خطا کمتر رخ دهد — نه اینکه قاعده را دوباره پیاده کند.
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import {
  listSelectableAccounts,
  listGoldAccounts,
  InsufficientBalanceError,
} from '../../services/accounts.js';
import { createTransfer, TransferValidationError } from '../../services/transfers.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import { formatRial, formatGrams } from '../../utils/format.js';
import { displayDateLong, GOLD_ACCOUNT_TYPE_LABELS } from './accountLabels.js';

const KIND_OPTIONS = [
  { value: 'money', label: 'انتقال وجه (صندوق / بانک / کارتخوان)' },
  { value: 'gold', label: 'انتقال طلا (بین حساب‌های طلایی هم‌نوع و هم‌عیار)' },
];

/**
 * @param {object} opts `kind` حالت اولیه، `defaultFromAccountId`، `defaultFromRefId`
 * @returns {Promise<boolean>} true اگر انتقالی ثبت شد.
 */
export function openTransferForm({ kind = 'money', defaultFromAccountId = null, defaultFromRefId = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;

    const state = {
      kind: kind === 'gold' ? 'gold' : 'money',
      date: toDateInputValue(new Date()),
      fromAccountId: defaultFromAccountId || '',
      toAccountId: '',
      amountIRR: '',
      fromRefId: defaultFromRefId || '',
      toRefId: '',
      weightGrams: '',
      description: '',
    };

    let accounts = [];
    let goldAccounts = [];

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
    const saveBtn = Button({ label: 'ثبت انتقال', variant: 'primary', type: 'submit' });
    actions.append(cancelBtn, saveBtn);
    form.appendChild(actions);

    const { close } = openModal({
      title: 'انتقال بین حساب‌ها',
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    const fieldErrors = {};

    function attachError(wrap, message) {
      if (!wrap || !message) return wrap;
      wrap.classList.add('field--invalid');
      const err = document.createElement('div');
      err.className = 'field__error';
      err.textContent = message;
      wrap.appendChild(err);
      return wrap;
    }

    /** حساب‌های طلایی هم‌نوع و هم‌عیار با مبدأ — تنها مقصدهای مجاز. */
    function compatibleTargets(source) {
      if (!source) return [];
      const existing = goldAccounts.filter(
        (g) =>
          g.refId !== source.refId &&
          g.goldType === source.goldType &&
          Number(g.karat) === Number(source.karat)
      );

      // سطل عمومی همان نوع/عیار ممکن است هنوز وجود نداشته باشد؛ به‌عنوان مقصدِ
      // «موجودی عمومی» پیشنهاد می‌شود (سرویس آن را با inventoryRefId می‌سازد).
      const genericRefId = `${source.goldType}:${Number(source.karat)}`;
      const hasGeneric = existing.some((g) => g.refId === genericRefId) || source.refId === genericRefId;
      const options = existing.map((g) => ({
        value: g.refId,
        label: `${g.name} — ${formatGrams(g.grams)}`,
      }));
      if (!hasGeneric) {
        options.unshift({
          value: genericRefId,
          label: `${GOLD_ACCOUNT_TYPE_LABELS[source.goldType]} — عیار ${source.karat} (موجودی عمومی)`,
        });
      }
      return options;
    }

    /** refId مقصد → ورودی سرویس (`{goldType, karat, productId}`). */
    function targetInput(refId, source) {
      if (!refId) return { goldType: source?.goldType || null, karat: source?.karat || 0, productId: null };
      if (refId.startsWith('product:')) {
        return { goldType: source.goldType, karat: source.karat, productId: refId.slice('product:'.length) };
      }
      const [goldType, karat] = refId.split(':');
      return { goldType, karat: Number(karat), productId: null };
    }

    function render() {
      body.innerHTML = '';

      body.appendChild(
        Select({
          label: 'نوع انتقال',
          value: state.kind,
          options: KIND_OPTIONS,
          onChange: (v) => {
            state.kind = v;
            render();
          },
        })
      );

      const dateField = Input({
        label: 'تاریخ',
        type: 'date',
        value: state.date,
        hint: displayDateLong(fromDateInputValue(state.date)),
        onInput: (v) => {
          state.date = v;
        },
      });
      body.appendChild(attachError(dateField, fieldErrors.date));

      if (state.kind === 'money') {
        renderMoney();
      } else {
        renderGold();
      }

      const notes = Input({
        label: 'توضیحات',
        value: state.description,
        onInput: (v) => {
          state.description = v;
        },
      });
      body.appendChild(notes);

      body.appendChild(
        Alert({
          variant: 'info',
          message:
            'انتقال یک سند دوطرفه و اتمیک است: خروج از مبدأ و ورود به مقصد با هم ثبت می‌شوند ' +
            'و اگر هر کدام ناموفق باشد، هیچ‌کدام ثبت نمی‌شود.',
        })
      );
    }

    function renderMoney() {
      if (!accounts.length) {
        body.appendChild(Alert({ variant: 'warning', message: 'برای انتقال وجه حداقل به دو حساب فعال نیاز است.' }));
        saveBtn.disabled = true;
        return;
      }
      saveBtn.disabled = false;

      if (!state.fromAccountId) state.fromAccountId = accounts[0].id;
      if (!state.toAccountId) {
        state.toAccountId = (accounts.find((a) => a.id !== state.fromAccountId) || accounts[0]).id;
      }

      const fromField = Select({
        label: 'از حساب',
        required: true,
        value: state.fromAccountId,
        options: accounts.map((a) => ({ value: a.id, label: `${a.name} — ${formatRial(a.balance)}` })),
        onChange: (v) => {
          state.fromAccountId = v;
          render();
        },
      });
      body.appendChild(attachError(fromField, fieldErrors.fromAccountId));

      const toField = Select({
        label: 'به حساب',
        required: true,
        value: state.toAccountId,
        options: accounts
          .filter((a) => a.id !== state.fromAccountId)
          .map((a) => ({ value: a.id, label: `${a.name} — ${formatRial(a.balance)}` })),
        onChange: (v) => {
          state.toAccountId = v;
        },
      });
      body.appendChild(attachError(toField, fieldErrors.toAccountId));

      const amountField = Input({
        label: 'مبلغ (ریال)',
        numeric: true,
        required: true,
        value: state.amountIRR,
        onInput: (v) => {
          state.amountIRR = v;
        },
      });
      body.appendChild(attachError(amountField, fieldErrors.amountIRR));
    }

    function renderGold() {
      if (!goldAccounts.length) {
        body.appendChild(
          Alert({ variant: 'warning', message: 'هیچ حساب طلایی با موجودی وجود ندارد؛ ابتدا خریدی ثبت کنید.' })
        );
        saveBtn.disabled = true;
        return;
      }
      saveBtn.disabled = false;

      if (!state.fromRefId || !goldAccounts.some((g) => g.refId === state.fromRefId)) {
        state.fromRefId = goldAccounts[0].refId;
        state.toRefId = '';
      }
      const source = goldAccounts.find((g) => g.refId === state.fromRefId);

      const fromField = Select({
        label: 'از حساب طلا',
        required: true,
        value: state.fromRefId,
        options: goldAccounts.map((g) => ({ value: g.refId, label: `${g.name} — ${formatGrams(g.grams)}` })),
        onChange: (v) => {
          state.fromRefId = v;
          state.toRefId = '';
          render();
        },
      });
      body.appendChild(attachError(fromField, fieldErrors.fromRefId));

      const targets = compatibleTargets(source);
      if (!targets.length) {
        body.appendChild(
          Alert({
            variant: 'warning',
            message: 'برای این حساب هیچ مقصد هم‌نوع و هم‌عیاری وجود ندارد. تغییر نوع یا عیار طلا «ذوب/تبدیل» است، نه انتقال.',
          })
        );
        saveBtn.disabled = true;
        return;
      }
      if (!state.toRefId) state.toRefId = targets[0].value;

      const toField = Select({
        label: 'به حساب طلا',
        required: true,
        value: state.toRefId,
        options: targets,
        hint: `فقط طلای ${GOLD_ACCOUNT_TYPE_LABELS[source.goldType]} با عیار ${source.karat} قابل انتخاب است.`,
        onChange: (v) => {
          state.toRefId = v;
        },
      });
      body.appendChild(attachError(toField, fieldErrors.to));

      const weightField = Input({
        label: 'وزن (گرم)',
        numeric: true,
        required: true,
        value: state.weightGrams,
        hint: `موجودی مبدأ: ${formatGrams(source.grams)}`,
        onInput: (v) => {
          state.weightGrams = v;
        },
      });
      body.appendChild(attachError(weightField, fieldErrors.weightGrams));
    }

    function buildInput() {
      if (state.kind === 'money') {
        return {
          kind: 'money',
          date: fromDateInputValue(state.date),
          fromAccountId: state.fromAccountId,
          toAccountId: state.toAccountId,
          amountIRR: Number(state.amountIRR),
          description: state.description,
        };
      }
      const source = goldAccounts.find((g) => g.refId === state.fromRefId);
      return {
        kind: 'gold',
        date: fromDateInputValue(state.date),
        fromRefId: state.fromRefId,
        to: targetInput(state.toRefId, source),
        weightGrams: Number(state.weightGrams),
        description: state.description,
      };
    }

    async function reload() {
      [accounts, goldAccounts] = await Promise.all([listSelectableAccounts(), listGoldAccounts({})]);
      render();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      Object.keys(fieldErrors).forEach((k) => delete fieldErrors[k]);
      errorBox.innerHTML = '';
      saveBtn.disabled = true;

      const attempt = async (options) => {
        const { transfer } = await createTransfer(buildInput(), options);
        settled = true;
        close();
        showToast(`انتقال ${transfer.number} ثبت شد.`, { variant: 'success' });
        resolve(true);
      };

      try {
        await attempt({});
      } catch (err) {
        saveBtn.disabled = false;

        if (err instanceof InsufficientBalanceError) {
          const s = err.shortages[0];
          const isGold = state.kind === 'gold';
          const proceed = await confirmDialog({
            title: 'موجودی کافی نیست',
            message: isGold
              ? `موجودی حساب طلای مبدأ ${formatGrams(s.available)} است و این انتقال ${formatGrams(s.requested)} می‌خواهد. ادامه می‌دهید؟`
              : `موجودی «${s.accountName}» ${formatRial(s.available)} است و این انتقال ${formatRial(s.requested)} می‌خواهد؛ مانده منفی می‌شود. ادامه می‌دهید؟`,
            confirmLabel: 'بله، ثبت شود',
            danger: true,
          });
          if (!proceed) return;
          saveBtn.disabled = true;
          try {
            await attempt({ allowNegative: true });
          } catch (retryErr) {
            saveBtn.disabled = false;
            console.error('[TransferForm] retry', retryErr);
            errorBox.appendChild(Alert({ variant: 'danger', message: retryErr?.message || 'ثبت انتقال ناموفق بود.' }));
          }
          return;
        }

        if (err instanceof TransferValidationError) {
          Object.assign(fieldErrors, err.fieldErrors);
          render();
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
          return;
        }

        console.error('[TransferForm]', err);
        errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ثبت انتقال ناموفق بود.' }));
      }
    });

    reload();
  });
}
