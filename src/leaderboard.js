/**
 * Workshop leaderboard + flow coach.
 *  - shared: talks to /api/scores (see server/scores-api.mjs); everyone on the
 *    same host sees the same board. Falls back to this browser's storage.
 *  - 2D and 3D have separate boards; rank by score or by lift-to-drag.
 *  - naming happens inline in the coach card (no window.prompt).
 */
import { efficiency, explain, liftToDrag, normaliseDim } from './scoring.js';

export { efficiency, explain };

const KEY = 'aerolab-scores-v2';
const BASE = (import.meta.env?.VITE_LEADERBOARD_URL || '').replace(/\/$/, '');

const escapeHtml = (value) => {
  const el = document.createElement('span');
  el.textContent = String(value ?? '');
  return el.innerHTML;
};

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocal(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 60)));
  } catch {
    /* storage unavailable */
  }
}

async function request(path, options) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3500);
  try {
    const res = await fetch(`${BASE}${path}`, { ...options, signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
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
  const badge = document.getElementById('board-source');
  const ui = { dim: '2D', sort: 'efficiency', remote: null, source: 'local', players: 0, pending: null };

  const rows = () => {
    const base = ui.source === 'live' && ui.remote ? ui.remote : loadLocal().filter((s) => s.dim === ui.dim);
    return base
      .slice()
      .sort((a, b) => (ui.sort === 'ld' ? b.ld - a.ld : b.efficiency - a.efficiency))
      .slice(0, 8);
  };

  const render = () => {
    document.querySelectorAll('[data-board-dim]').forEach((b) => b.classList.toggle('is-active', b.dataset.boardDim === ui.dim));
    document.querySelectorAll('[data-board-sort]').forEach((b) => b.classList.toggle('is-active', b.dataset.boardSort === ui.sort));
    if (badge) {
      badge.dataset.state = ui.source;
      badge.textContent = ui.source === 'live' ? `LIVE · ${ui.players} player${ui.players === 1 ? '' : 's'}` : 'LOCAL · this browser';
    }
    const list = rows();
    if (!list.length) {
      board.innerHTML = `<div class="empty-board"><span>NO ${ui.dim} RUNS YET</span><h3>Your workshop is waiting.</h3><p>Shape something, let the flow settle, and run a five-second test.</p></div>`;
      return;
    }
    const last = ui.sort === 'ld' ? 'L/D' : 'SCORE';
    board.innerHTML =
      `<div class="board-head"><span>RANK / DESIGN</span><span>DRAG</span><span>${last}</span></div>` +
      list
        .map((s, i) => {
          const value = ui.sort === 'ld' ? Number(s.ld).toFixed(2) : Number(s.efficiency).toFixed(0);
          const date = s.ts ? new Date(s.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : s.date || '';
          return `<div class="board-row"><b>${String(i + 1).padStart(2, '0')}</b><span><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(date)} · ${escapeHtml(s.dim || '2D')} · L/D ${Number(s.ld ?? 0).toFixed(2)}</small></span><code>${Number(s.drag).toFixed(3)}</code><em>${value}</em></div>`;
        })
        .join('');
  };

  const refresh = async () => {
    try {
      const data = await request(`/api/scores?dim=${ui.dim}`);
      ui.remote = data.scores;
      ui.players = data.players;
      ui.source = 'live';
    } catch {
      ui.source = 'local';
    }
    render();
  };

  document.querySelectorAll('[data-board-dim]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.dim = b.dataset.boardDim;
      render();
      refresh();
    }),
  );
  document.querySelectorAll('[data-board-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      ui.sort = b.dataset.boardSort;
      render();
    }),
  );

  const renderCoach = () => {
    const p = ui.pending;
    if (!p) return;
    const form = p.submitted
      ? `<p class="coach-saved">Saved to the ${ui.source === 'live' ? 'shared' : 'local'} ${p.dim} board.</p>`
      : `<form class="name-form" id="name-form"><input id="name-input" maxlength="24" autocomplete="off" placeholder="${escapeHtml(p.fallback)}" aria-label="Design name" /><button type="submit" class="shape-chip is-active">Save to board</button></form>`;
    const prevAi = coach.querySelector('#coach-ai');
    const keep = prevAi && !prevAi.hidden ? { html: prevAi.innerHTML, state: prevAi.dataset.state } : null;
    coach.innerHTML = `<span class="coach-icon">✦</span><p class="eyebrow">Flow coach · ${p.dim} run</p><div class="score-badge">${p.score.toFixed(0)}<small>/100</small></div><h3>${escapeHtml(p.name || 'Name your design')}</h3><p>${p.insight}</p><p class="coach-ai" id="coach-ai" hidden></p><p class="coach-ld">L/D ${p.ld.toFixed(2)} · Cd ${p.cd.toFixed(3)} · Cl ${p.cl.toFixed(3)}</p>${form}`;
    if (keep) {
      const ai = coach.querySelector('#coach-ai');
      ai.hidden = false;
      ai.innerHTML = keep.html;
      ai.dataset.state = keep.state;
    }
    const f = coach.querySelector('#name-form');
    if (f) {
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        api.submit(coach.querySelector('#name-input').value);
      });
      coach.querySelector('#name-input').focus({ preventScroll: true });
    }
  };

  const api = {
    /** Finish a 5-second test. Shows the inline name form (or auto-saves when `name` is given). */
    record({ cd, cl, dim, name, label, context }) {
      const d = normaliseDim(dim);
      const prior = loadLocal().filter((s) => s.dim === d).length;
      ui.pending = {
        cd, cl, dim: d, submitted: false,
        score: efficiency(cd, cl, d),
        ld: liftToDrag(cd, cl),
        insight: explain(cd, cl, d),
        fallback: `${label || 'Prototype'} #${prior + 1}`,
        context,
        name: '',
      };
      ui.dim = d;
      render();
      renderCoach();
      askCoach(context, Date.now());
      if (name) return api.submit(name);
      return Promise.resolve();
    },

    async submit(rawName) {
      const p = ui.pending;
      if (!p || p.submitted) return;
      const name = String(rawName || '').trim().slice(0, 24) || p.fallback;
      p.name = name;
      p.submitted = true;
      const entry = {
        id: Date.now(), name, dim: p.dim, drag: p.cd, lift: p.cl, ld: p.ld,
        efficiency: p.score, ts: Date.now(),
      };
      saveLocal([entry, ...loadLocal()]);
      try {
        await request('/api/scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, cd: p.cd, cl: p.cl, dim: p.dim }),
        });
        ui.source = 'live';
      } catch {
        ui.source = 'local';
      }
      await refresh();
      renderCoach();
    },
    refresh,
  };

  render();
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 8000);
  return api;
}
