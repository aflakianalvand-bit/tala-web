// Card.js
export function Card({ children, flat = false } = {}) {
  const card = document.createElement('div');
  card.className = `card ${flat ? 'card--flat' : 'card--shadow'}`;
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (typeof child === 'string') {
        const p = document.createElement('p');
        p.textContent = child;
        card.appendChild(p);
      } else if (child instanceof Node) {
        card.appendChild(child);
      }
    });
  }
  return card;
}

export function KpiCard({ label, value }) {
  const card = document.createElement('div');
  card.className = 'kpi-card';
  const labelEl = document.createElement('div');
  labelEl.className = 'kpi-card__label';
  labelEl.textContent = label;
  const valueEl = document.createElement('div');
  valueEl.className = 'kpi-card__value num';
  valueEl.textContent = value;
  card.append(labelEl, valueEl);
  return card;
}
