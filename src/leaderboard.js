/** Workshop leaderboard + flow coach (ported from Slipstream). */
const KEY = 'aerolab-scores';

const escapeHtml = (value) => {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
};

export function efficiency(cd, cl) {
  if (!Number.isFinite(cd) || !Number.isFinite(cl)) return 0;
  return Math.max(0, Math.min(100, 100 - cd * 24 + Math.min(8, Math.abs(cl) * 3)));
}

export function explain(cd, cl) {
  const wake =
    cd < 0.7
      ? 'The narrow wake suggests the air is rejoining cleanly behind your shape.'
      : cd < 1.4
        ? 'The wake is controlled, but the blunt regions are still shedding visible vortices.'
        : 'A broad, turbulent wake is carrying momentum away from the object.';
  const force =
    Math.abs(cl) < 0.12
      ? 'It is nearly lift-neutral; tilt or curve a surface to redirect more air.'
      : cl > 0
        ? 'The pressure imbalance is producing useful upward lift.'
        : 'The current angle is producing downforce; flip the tilt to reverse it.';
  return `${wake} ${force}`;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

/**
 * Ask the AI coach (a serverless function backed by Claude) to explain this
 * specific result. Silently keeps the rule-based text when the endpoint is
 * missing, unconfigured or slow.
 */
async function askCoach(context, runId) {
  if (!context) return;
  const slot = document.getElementById('coach-ai');
  if (!slot) return;
  slot.hidden = false;
  slot.dataset.state = 'loading';
  slot.textContent = 'Asking the coach…';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const response = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`coach ${response.status}`);
    const data = await response.json();
    const current = document.getElementById('coach-ai');
    if (!current || !data?.text) throw new Error('empty');
    current.dataset.state = 'done';
    current.innerHTML = `<b>AI coach</b> ${escapeHtml(data.text)}`;
  } catch {
    const current = document.getElementById('coach-ai');
    if (current) current.hidden = true;
  }
}

export function createLeaderboard() {
  const board = document.getElementById('leaderboard');
  const coach = document.getElementById('coach-card');

  const render = () => {
    const scores = load();
    if (!scores.length) {
      board.innerHTML =
        '<div class="empty-board"><span>NO RUNS YET</span><h3>Your workshop is waiting.</h3><p>Shape something, let the flow settle, and run a five-second test.</p></div>';
      return;
    }
    board.innerHTML =
      '<div class="board-head"><span>RANK / DESIGN</span><span>DRAG</span><span>SCORE</span></div>' +
      scores
        .map(
          (s, i) =>
            `<div class="board-row"><b>${String(i + 1).padStart(2, '0')}</b><span><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.date)} · ${escapeHtml(s.dim || '2D')}</small></span><code>${Number(s.drag).toFixed(3)}</code><em>${Number(s.efficiency).toFixed(0)}</em></div>`,
        )
        .join('');
  };

  render();

  return {
    /** Record a finished 5-second test. Height normalisation is inherent: Cd is per reference length. */
    record({ cd, cl, dim, label, context }) {
      const score = efficiency(cd, cl);
      const insight = explain(cd, cl);
      const prior = load();
      const name = `${label || 'Prototype'} #${prior.length + 1}`;
      const entry = {
        id: Date.now(),
        name,
        drag: cd,
        lift: cl,
        efficiency: score,
        dim,
        date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      };
      try {
        localStorage.setItem(KEY, JSON.stringify([...prior, entry].sort((a, b) => b.efficiency - a.efficiency).slice(0, 8)));
      } catch {
        /* storage unavailable */
      }
      render();
      coach.innerHTML = `<span class="coach-icon">✦</span><p class="eyebrow">Flow coach · latest run</p><div class="score-badge">${score.toFixed(0)}<small>/100</small></div><h3>${escapeHtml(name)}</h3><p id="coach-text">${insight}</p><p class="coach-ai" id="coach-ai" hidden></p>`;
      askCoach(context, entry.id);
    },
  };
}
