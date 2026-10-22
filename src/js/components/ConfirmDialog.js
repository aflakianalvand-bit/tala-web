// ConfirmDialog.js — مودال تأیید عملیات، برمی‌گرداند Promise<boolean>
import { openModal } from './Modal.js';
import { Button } from './Button.js';

export function confirmDialog({ title = 'تأیید عملیات', message = '', confirmLabel = 'تأیید', cancelLabel = 'انصراف', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = document.createElement('div');

    const msg = document.createElement('p');
    msg.textContent = message;
    body.appendChild(msg);

    const actions = document.createElement('div');
    actions.className = 'modal__actions';

    let settled = false;
    const { close } = openModal({
      title,
      content: body,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });

    const cancelBtn = Button({
      label: cancelLabel,
      variant: 'secondary',
      onClick: () => {
        settled = true;
        close();
        resolve(false);
      },
    });
    const confirmBtn = Button({
      label: confirmLabel,
      variant: danger ? 'danger' : 'primary',
      onClick: () => {
        settled = true;
        close();
        resolve(true);
      },
    });

    actions.append(cancelBtn, confirmBtn);
    body.appendChild(actions);
  });
}
