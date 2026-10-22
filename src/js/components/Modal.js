// Modal.js — پایه‌ی Modal، مبنای ConfirmDialog و فرم‌های آینده
export function openModal({ title = '', content, onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const header = document.createElement('div');
  header.className = 'modal__header';
  const titleEl = document.createElement('h2');
  titleEl.className = 'modal__title';
  titleEl.textContent = title;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal__close';
  closeBtn.setAttribute('aria-label', 'بستن');
  closeBtn.textContent = '✕';
  header.append(titleEl, closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'modal__body';
  if (content instanceof Node) body.appendChild(content);
  else if (typeof content === 'string') body.textContent = content;
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKeydown);
    if (onClose) onClose();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);

  // فوکوس اولیه برای دسترسی‌پذیری
  closeBtn.focus();

  return { close, modalEl: modal, bodyEl: body };
}
