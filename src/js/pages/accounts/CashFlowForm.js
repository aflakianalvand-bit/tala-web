// CashFlowForm.js — مودال واریز/برداشت مستقیم (Phase 9)
// یک فرم برای هر دو جهت؛ تفاوت‌ها **داده** هستند نه کد (ARCHITECTURE §4.1).
import { openModal } from '../../components/Modal.js';
import { Input } from '../../components/Input.js';
import { Select } from '../../components/Select.js';
import { Textarea } from '../../components/Textarea.js';
import { Button } from '../../components/Button.js';
import { Alert } from '../../components/Alert.js';
import { showToast } from '../../components/Toast.js';
import { confirmDialog } from '../../components/ConfirmDialog.js';
import { listSelectableAccounts, InsufficientBalanceError } from '../../services/accounts.js';
import {
  createDeposit,
  createWithdrawal,
  categoriesFor,
  CashFlowValidationError,
} from '../../services/cashFlow.js';
import { toDateInputValue, fromDateInputValue } from '../../utils/date.js';
import { formatRial } from '../../utils/format.js';
import { displayDateLong } from './accountLabels.js';

const COPY = {
  in: {
    title: 'واریز به حساب',
    action: 'ثبت واریز',
    accountLabel: 'واریز به حساب',
    categoryLabel: 'بابت (منبع وجه)',
    categoryHint: 'طرف مقابل این واریز — برای تسویه‌ی مشتری از صفحه‌ی همان مشتری استفاده کنید.',
    success: 'واریز ثبت شد.',
  },
  out: {
    title: 'برداشت از حساب',
    action: 'ثبت برداشت',
    accountLabel: 'برداشت از حساب',
    categoryLabel: 'بابت (مصرف وجه)',
    categoryHint: 'طرف مقابل این برداشت — برای پرداخت به تأمین‌کننده از صفحه‌ی همان تأمین‌کننده استفاده کنید.',
    success: 'برداشت ثبت شد.',
  },
};

/**
 * @param {'in'|'out'} direction
 * @param {object} opts `defaultAccountId` حساب پیش‌انتخاب‌شده
 * @returns {Promise<boolean>} true اگر سندی ثبت شد.
 */
export function openCashFlowForm(direction, { defaultAccountId = null } = {}) {
  const copy = COPY[direction] || COPY.in;

  return new Promise((resolve) => {
    let settled = false;

    const form = document.createElement('form');
    form.noValidate = true;
    const errorBox = document.createElement('div');
    const body = document.createElement('div');
    body.textContent = 'در حال بارگذاری…';
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

    const { close } = openModal({
      title: copy.title,
      content: form,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    let accountField;
    let categoryField;
    let amountField;
    let dateField;
    let notesField;

    (async () => {
      const accounts = await listSelectableAccounts();
      body.innerHTML = '';

      if (!accounts.length) {
        body.appendChild(
          Alert({ variant: 'warning', message: 'هیچ حساب فعالی وجود ندارد. ابتدا یک حساب بسازید.' })
        );
        saveBtn.disabled = true;
        return;
      }

      const balanceById = new Map(accounts.map((a) => [a.id, a.balance]));

      dateField = Input({ label: 'تاریخ', type: 'date', value: toDateInputValue(new Date()) });
      const dateHint = document.createElement('div');
      dateHint.className = 'field__hint';
      dateHint.textContent = displayDateLong(fromDateInputValue(dateField.getInput().value));
      dateField.appendChild(dateHint);
      dateField.getInput().addEventListener('input', () => {
        dateHint.textContent = displayDateLong(fromDateInputValue(dateField.getInput().value));
      });

      accountField = Select({
        label: copy.accountLabel,
        required: true,
        value: defaultAccountId || accounts[0].id,
        options: accounts.map((a) => ({ value: a.id, label: `${a.name} — ${formatRial(a.balance)}` })),
      });

      const balanceHint = document.createElement('div');
      balanceHint.className = 'field__hint num';
      const refreshBalanceHint = () => {
        const current = balanceById.get(accountField.getSelect().value) || 0;
        balanceHint.textContent = `موجودی فعلی: ${formatRial(current)}`;
      };
      refreshBalanceHint();
      accountField.appendChild(balanceHint);
      accountField.getSelect().addEventListener('change', refreshBalanceHint);

      categoryField = Select({
        label: copy.categoryLabel,
        required: true,
        options: categoriesFor(direction).map((c) => ({ value: c.key, label: c.label })),
        hint: copy.categoryHint,
      });

      amountField = Input({ label: 'مبلغ (ریال)', numeric: true, required: true, placeholder: '0' });

      notesField = Textarea({ label: 'توضیحات', rows: 2 });

      body.append(dateField, accountField, categoryField, amountField, notesField);
    })();

    function clearErrors() {
      form.querySelectorAll('.field--invalid').forEach((el) => el.classList.remove('field--invalid'));
      form.querySelectorAll('.field__error').forEach((el) => el.remove());
      errorBox.innerHTML = '';
    }

    function showFieldError(wrap, message) {
      if (!wrap) return;
      wrap.classList.add('field--invalid');
      const err = document.createElement('div');
      err.className = 'field__error';
      err.textContent = message;
      wrap.appendChild(err);
    }

    async function submit(options) {
      const input = {
        date: fromDateInputValue(dateField.getInput().value),
        accountId: accountField.getSelect().value,
        categoryKey: categoryField.getSelect().value,
        amountIRR: Number(amountField.getValue()),
        description: notesField.getTextarea().value,
      };
      return direction === 'in' ? createDeposit(input) : createWithdrawal(input, options);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!accountField) return;
      clearErrors();
      saveBtn.disabled = true;

      try {
        await submit({});
        settled = true;
        close();
        showToast(copy.success, { variant: 'success' });
        resolve(true);
      } catch (err) {
        saveBtn.disabled = false;

        // هشدار موجودی منفی — بلاک نیست؛ تأیید صریح می‌گیریم و دوباره تلاش می‌کنیم.
        if (err instanceof InsufficientBalanceError) {
          const s = err.shortages[0];
          const proceed = await confirmDialog({
            title: 'موجودی کافی نیست',
            message:
              `موجودی «${s.accountName}» ${formatRial(s.available)} است و این برداشت ` +
              `${formatRial(s.requested)} می‌خواهد؛ مانده ${formatRial(s.shortfall)} منفی می‌شود. ` +
              'اگر این برداشت واقعاً انجام شده و با تأخیر ثبت می‌کنید، ادامه دهید.',
            confirmLabel: 'بله، ثبت شود',
            danger: true,
          });
          if (!proceed) return;
          saveBtn.disabled = true;
          try {
            await submit({ allowNegative: true });
            settled = true;
            close();
            showToast(`${copy.success} (با موجودی منفی)`, { variant: 'warning' });
            resolve(true);
          } catch (retryErr) {
            saveBtn.disabled = false;
            console.error('[CashFlowForm] retry', retryErr);
            errorBox.appendChild(Alert({ variant: 'danger', message: retryErr?.message || 'ثبت ناموفق بود.' }));
          }
          return;
        }

        if (err instanceof CashFlowValidationError) {
          const WRAPS = {
            accountId: accountField,
            categoryKey: categoryField,
            amountIRR: amountField,
            date: dateField,
            description: notesField,
          };
          for (const [field, message] of Object.entries(err.fieldErrors)) showFieldError(WRAPS[field], message);
          errorBox.appendChild(Alert({ variant: 'danger', message: 'لطفاً خطاهای فرم را برطرف کنید.' }));
          return;
        }

        console.error('[CashFlowForm]', err);
        errorBox.appendChild(Alert({ variant: 'danger', message: err?.message || 'ثبت ناموفق بود.' }));
      }
    });
  });
}
