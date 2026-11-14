/**
 * Small "?" buttons with a hover or tap explanation, plus the display size
 * controls (tunnel layout and readout text size). Both are purely cosmetic
 * and remembered per browser.
 */
const VIEW_KEY = 'aerolab-view';

export function initHints() {
  const tip = document.getElementById('hint-tip');
  if (!tip) return;
  let current = null;

  const show = (button) => {
    current = button;
    tip.textContent = button.dataset.hint || '';
    tip.hidden = false;
    const r = button.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    tip.style.width = `${width}px`;
    let left = r.left + r.width / 2 - width / 2;
    left = Math.max(12, Math.min(window.innerWidth - width - 12, left));
    const above = r.top > 140;
    tip.style.left = `${left}px`;
    tip.style.top = above ? `${r.top - 10}px` : `${r.bottom + 10}px`;
    tip.dataset.place = above ? 'above' : 'below';
  };
  const hide = () => {
    current = null;
    tip.hidden = true;
  };

  document.addEventListener('mouseover', (event) => {
    const button = event.target.closest('.hint');
    if (button) show(button);
    else if (current && !tip.contains(event.target)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const button = event.target.closest('.hint');
    if (button) show(button);
  });
  document.addEventListener('focusout', (event) => {
    if (event.target.closest?.('.hint')) hide();
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.hint');
    if (button) {
      event.preventDefault();
      show(button);
    } else if (!tip.hidden) hide();
  });
  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
}

export function initViewControls() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
  } catch {
    saved = {};
  }
  const apply = (view, text) => {
    document.body.dataset.view = view;
    document.documentElement.style.setProperty('--ui', String(text));
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    document.querySelectorAll('[data-text]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.text) === text)));
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ view, text }));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('resize'));
  };
  let view = saved.view === 'large' ? 'large' : 'normal';
  let text = [1, 1.25, 1.5].includes(Number(saved.text)) ? Number(saved.text) : 1;
  apply(view, text);
  document.querySelectorAll('.view-controls [data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view;
      apply(view, text);
    }),
  );
  document.querySelectorAll('.view-controls [data-text]').forEach((b) =>
    b.addEventListener('click', () => {
      text = Number(b.dataset.text);
      apply(view, text);
    }),
  );
}
