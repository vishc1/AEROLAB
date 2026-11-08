/** Three-step first-visit tour, shown once per browser. */
const KEY = 'aerolab-tour';

const STEPS = [
  { title: 'Drag on the tunnel to sculpt', text: 'Cream is solid. Shift-drag erases. The air reacts the same frame.' },
  { title: 'Read the air on the right', text: 'Cd is drag, Cl is lift. The road panel turns drag into litres of fuel and CO₂.' },
  { title: 'Pick a mission below', text: 'Five challenges, each one teaches an aerodynamic idea with a live target.' },
];

export function createTour() {
  const card = document.getElementById('tour');
  const title = document.getElementById('tour-title');
  const text = document.getElementById('tour-text');
  const step = document.getElementById('tour-step');
  const next = document.getElementById('tour-next');
  const skip = document.getElementById('tour-skip');
  let index = 0;
  let seen = false;
  try {
    seen = localStorage.getItem(KEY) === 'done';
  } catch {
    seen = false;
  }
  if (seen || !card) return { open() {}, close() {} };

  const render = () => {
    const s = STEPS[index];
    step.textContent = `${index + 1} / ${STEPS.length}`;
    title.textContent = s.title;
    text.textContent = s.text;
    next.textContent = index === STEPS.length - 1 ? 'Start' : 'Next';
  };
  const close = () => {
    card.hidden = true;
    try {
      localStorage.setItem(KEY, 'done');
    } catch {
      /* ignore */
    }
  };
  next.addEventListener('click', () => {
    if (index >= STEPS.length - 1) {
      close();
      document.getElementById('mission-dock')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    index += 1;
    render();
  });
  skip.addEventListener('click', close);

  render();
  card.hidden = false;
  return { open: () => (card.hidden = false), close };
}
