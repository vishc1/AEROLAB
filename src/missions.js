/**
 * Missions: guided aerodynamic challenges with a live target.
 *
 * Each mission loads a starting shape, measures a baseline once the flow has
 * settled, then watches the live telemetry until the goal holds for a moment.
 * Completing one reveals the lesson behind it.
 */
const DONE_KEY = 'aerolab-missions';
const SETTLE_MIN_MS = 4000; // never trust a baseline before the wake has formed
const SETTLE_MAX_MS = 9000; // but always start by then
const SETTLE_WINDOW = 12; // samples that must agree within SETTLE_SPREAD
const SETTLE_SPREAD = 0.08;
const HOLD_TICKS = 24; // ~1.2 s of UI ticks at 20 Hz

export const MISSIONS = [
  {
    id: 'streamline',
    index: '01',
    title: 'Streamline the cylinder',
    preset: 'cylinder',
    goal: { type: 'cd_reduce', pct: 0.35 },
    brief:
      'A round body leaves a wide, flapping wake. Sculpt a tapered tail behind it and cut its drag coefficient by 35%.',
    hint: 'Draw a long, narrow tail that ends in a point. Erase with Shift if it gets too fat.',
    lesson:
      'The tail gives the air a gentle path back together, so pressure recovers behind the body instead of sucking it backwards. This is the shape change that turned box-shaped 1920s cars into teardrops and cut their fuel burn by a third.',
  },
  {
    id: 'lift',
    index: '02',
    title: 'Make it fly',
    preset: 'plate',
    goal: { type: 'cl_above', target: 0.3 },
    brief:
      'Start from a vertical plate. Erase it and draw a thin shape that pushes air downward until the lift coefficient passes +0.30.',
    hint: 'A thin curve with its front slightly higher than its back works well. Watch the Cl number turn positive.',
    lesson:
      'Lift is the air being deflected downward. Curve and tilt send more air down, the body gets pushed up. The same pressure imbalance holds up every wing, and the lift-to-drag ratio in the rail is what aircraft designers chase.',
  },
  {
    id: 'car',
    index: '03',
    title: 'Beat the car',
    preset: 'car',
    goal: { type: 'cd_reduce', pct: 0.2 },
    brief:
      'This car profile is a bluff body. Reshape its roofline and tail to cut its drag by 20% against its own baseline.',
    hint: 'Round the leading edge, lower the rear, and add a boat-tail. Keep the height so the comparison is fair.',
    lesson:
      'At highway speed most of a car\'s engine power goes into pushing air aside. The road panel shows what your 20% means in litres and CO₂. Drag cuts of this size are why modern EVs chase a Cd near 0.20.',
  },
  {
    id: 'laminar',
    index: '04',
    title: 'Calm the wake',
    preset: 'cylinder',
    goal: { type: 'laminar' },
    brief:
      'Turn the Vorticity view on, then raise the viscosity slider until the flow regime reads LAMINAR and the vortex street disappears.',
    hint: 'Viscosity is the bottom slider second from the left. Thicker air means a lower Reynolds number.',
    lesson:
      'The Reynolds number compares momentum to viscosity. Low Re flow is smooth and predictable, like honey. High Re flow sheds vortices, like a flag in the wind. The same cylinder behaves completely differently depending on the fluid and speed.',
  },
  {
    id: 'real',
    index: '05',
    title: 'Test a real object',
    input: 'camera',
    goal: { type: 'camera_test' },
    brief:
      'Switch to Camera, hold a coloured object or your hand up, freeze the shape and run a five-second test on it.',
    hint: 'Click the object in the video to pick its colour, or use Hand AI. Freeze before you run the test.',
    lesson:
      'You just ran a wind-tunnel test on a physical object with no wind tunnel. Paper prototypes, clay models and hands all get the same pressure integral the presets do.',
  },
  {
    id: 'wing3d',
    index: '06',
    title: 'Fly a real wing',
    dim: '3d',
    plan: 'straight',
    preset: 'airfoil',
    goal: { type: 'test', dim: '3D' },
    predict: {
      q: 'In 2D the wing is infinitely wide. A real wing has tips. Will its drag go up or down?',
      options: ['Up', 'Down', 'Same'],
      answer: 0,
    },
    brief: 'You are now in 3D. The wing has a finite span and the air can slip around its tips. Run a five-second test.',
    hint: 'Let the flow settle, turn on Vorticity to see the tips, then press Run test.',
    lesson:
      'Air leaks from the high-pressure underside round the tip to the low-pressure top and rolls up into wingtip vortices. Making them costs energy, which shows up as induced drag. This is the extra drag every real wing pays for having tips.',
  },
  {
    id: 'tips3d',
    index: '07',
    title: 'Round the tips',
    dim: '3d',
    plan: 'straight',
    preset: 'airfoil',
    goal: { type: 'test', dim: '3D', plan: 'ellipse' },
    predict: {
      q: 'Which planform wastes the least energy on tip vortices?',
      options: ['Rectangle', 'Elliptical', 'Delta triangle'],
      answer: 1,
    },
    brief: 'Switch the planform (top-down outline) to Ellipse in the sketch dock, then run a five-second test and compare the score to the rectangle.',
    hint: 'The planform chips sit next to the top-down canvas. Pick Ellipse, wait for the flow to settle, then Run test.',
    lesson:
      'An elliptical wing spreads lift evenly, which gives the minimum possible induced drag. The Spitfire used exactly this outline. Real designers approximate it with taper and swept, rounded tips.',
  },
  {
    id: 'vortex3d',
    index: '08',
    title: 'See the wingtip vortex',
    dim: '3d',
    plan: 'straight',
    preset: 'airfoil',
    goal: { type: 'vorticity3d' },
    predict: {
      q: 'Behind a lifting wing, which way does the air spin at the tips?',
      options: ['Around the tip, up and over', 'Straight back', 'Randomly'],
      answer: 0,
    },
    brief: 'Turn the Vorticity view on in 3D and watch the tracers behind the wing. Warm and cool colours show spin in opposite directions.',
    hint: 'Press the Vorticity button in the shape bar. Warm and cool tracers should peel off each tip.',
    lesson:
      'Each tip sheds a tube of spinning air that trails for kilometres behind a jet. Pilots call it wake turbulence, and it is why airports space out landings.',
  },
];

function loadDone() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function createMissions(store, actions) {
  const $ = (id) => document.getElementById(id);
  const chips = $('mission-chips');
  const brief = $('mission-brief');
  const hud = $('mission-hud');
  const hudIndex = $('mission-hud-index');
  const hudTitle = $('mission-hud-title');
  const hudTarget = $('mission-hud-target');
  const hudValue = $('mission-hud-value');
  const hudBar = $('mission-hud-bar');
  const hudText = $('mission-hud-text');
  const nextButton = $('mission-next');
  const quitButton = $('mission-quit');

  const done = loadDone();
  let active = null; // { mission, phase, baseline, hold, startedAt }
  let lastHud = '';

  const saveDone = () => {
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
    } catch {
      /* storage unavailable */
    }
  };

  const renderChips = () => {
    chips.innerHTML = MISSIONS.map((m) => {
      const isDone = done.has(m.id);
      const isActive = active?.mission.id === m.id;
      return `<button type="button" class="mission-chip${isActive ? ' is-active' : ''}${isDone ? ' is-done' : ''}" data-mission="${m.id}"><b>${isDone ? '✓' : m.index}</b>${m.title}</button>`;
    }).join('');
    const count = done.size;
    $('mission-count').textContent = `${count} / ${MISSIONS.length}`;
    if (!active) {
      brief.innerHTML =
        count === MISSIONS.length
          ? '<strong>All eight missions complete.</strong> You have covered wakes, lift, bluff bodies, Reynolds number, real-object testing and 3D wing physics.'
          : '<strong>Pick a mission.</strong> Each one teaches a single aerodynamic idea with a live target you have to hit in the tunnel.';
    } else if (active.phase === 'done') {
      brief.innerHTML = `<strong>${active.mission.title} · complete.</strong> ${verdict()}${active.mission.lesson}`;
    } else {
      brief.innerHTML = `<strong>${active.mission.title}.</strong> ${active.mission.brief}`;
    }
  };

  const targetLabel = (m, baseline) => {
    const g = m.goal;
    if (g.type === 'cd_below') return `Cd below ${g.target.toFixed(2)}`;
    if (g.type === 'cd_reduce')
      return baseline ? `Cd below ${(baseline.cd * (1 - g.pct)).toFixed(3)} (−${Math.round(g.pct * 100)}%)` : `Cut Cd by ${Math.round(g.pct * 100)}%`;
    if (g.type === 'cl_above') return `Cl above +${g.target.toFixed(2)}`;
    if (g.type === 'laminar') return 'Regime LAMINAR (Re < 180)';
    if (g.type === 'test') return g.plan ? `Finish a 3D test with the ${g.plan} planform` : 'Finish a 5-second test in 3D';
    if (g.type === 'vorticity3d') return 'Vorticity view on, in 3D';
    if (g.type === 'camera_test') return 'Finish a 5-second test in Camera mode';
    return '';
  };

  /** Returns { value, progress, met, display } for the live state. */
  const evaluate = () => {
    const m = active.mission;
    const g = m.goal;
    const s = store.state;
    const met = s.metrics;
    const b = active.baseline;
    const live = met.boundaryCells > 0 && Number.isFinite(met.cd);
    if (g.type === 'cd_below' || g.type === 'cd_reduce') {
      const target = g.type === 'cd_below' ? g.target : b.cd * (1 - g.pct);
      const cd = met.cd;
      return {
        display: live ? `Cd ${cd.toFixed(3)}` : 'Cd —',
        progress: clamp01((b.cd - cd) / Math.max(b.cd - target, 1e-4)),
        met: live && cd > 0 && cd < target,
      };
    }
    if (g.type === 'cl_above') {
      const cl = met.cl;
      return {
        display: live ? `Cl ${cl >= 0 ? '+' : '−'}${Math.abs(cl).toFixed(3)}` : 'Cl —',
        progress: clamp01((cl - Math.min(b.cl, 0)) / (g.target - Math.min(b.cl, 0))),
        met: live && cl > g.target,
      };
    }
    if (g.type === 'laminar') {
      const re = met.re;
      return {
        display: `Re ${Math.round(re)} · ${met.regime}`,
        progress: clamp01(1 - (re - 180) / Math.max(b.re - 180, 1)),
        met: met.regime === 'LAMINAR',
      };
    }
    if (g.type === 'test') {
      return { display: s.dim === '3d' ? 'Ready · run a test' : 'Switch to 3D', progress: s.dim === '3d' ? 0.4 : 0, met: false };
    }
    if (g.type === 'vorticity3d') {
      const on = s.dim === '3d' && s.vorticity;
      return { display: on ? 'Vorticity on' : 'Press Vorticity', progress: on ? 1 : 0.2, met: on };
    }
    return {
      display: s.input === 'camera' ? 'Camera live' : 'Switch to Camera',
      progress: s.input === 'camera' ? (met.boundaryCells > 0 ? 0.6 : 0.3) : 0,
      met: false,
    };
  };

  const predictBox = $('mission-predict');
  const renderPredict = () => {
    if (!predictBox) return;
    const pr = active?.mission.predict;
    if (!pr || active.phase === 'done') {
      predictBox.hidden = true;
      predictBox.innerHTML = '';
      return;
    }
    predictBox.hidden = false;
    if (active.guess !== null) {
      predictBox.innerHTML = `<small>You predicted: <b>${pr.options[active.guess]}</b>. Test it.</small>`;
      return;
    }
    predictBox.innerHTML = `<small>PREDICT FIRST</small><span>${pr.q}</span><div>${pr.options
      .map((o, i) => `<button type="button" data-guess="${i}">${o}</button>`)
      .join('')}</div>`;
  };
  predictBox?.addEventListener('click', (event) => {
    const b = event.target.closest('[data-guess]');
    if (!b || !active || active.guess !== null) return;
    active.guess = Number(b.dataset.guess);
    renderPredict();
  });

  const verdict = () => {
    const pr = active?.mission.predict;
    if (!pr) return '';
    if (active.guess === null) return `Answer: ${pr.options[pr.answer]}. `;
    return active.guess === pr.answer
      ? `You predicted ${pr.options[active.guess]}: correct. `
      : `You predicted ${pr.options[active.guess]}; the answer is ${pr.options[pr.answer]}. `;
  };

  const renderHud = (ev) => {
    if (!active) {
      hud.hidden = true;
      lastHud = '';
      return;
    }
    const m = active.mission;
    hud.hidden = false;
    hud.dataset.phase = active.phase;
    hudIndex.textContent = `MISSION ${m.index}`;
    hudTitle.textContent = m.title;
    if (active.phase === 'settle') {
      hudTarget.textContent = targetLabel(m, null);
      const cd = store.state.metrics.cd;
      hudValue.textContent = `Measuring baseline… ${Number.isFinite(cd) && cd > 0 ? `Cd ${cd.toFixed(3)}` : ''}`;
      hudBar.style.width = `${Math.round((active.settle || 0) * 100)}%`;
      hudText.textContent = m.brief;
    } else if (active.phase === 'live') {
      const key = `${ev.display}|${Math.round(ev.progress * 100)}|${ev.met}`;
      if (key === lastHud) return;
      lastHud = key;
      hudTarget.textContent = targetLabel(m, active.baseline);
      hudValue.textContent = ev.display;
      hudBar.style.width = `${Math.round(ev.progress * 100)}%`;
      hudText.textContent = ev.met ? 'Hold it there…' : m.hint;
    } else {
      hudTarget.textContent = 'Complete';
      hudValue.textContent = ev?.display ?? '';
      hudBar.style.width = '100%';
      hudText.textContent = verdict() + m.lesson;
    }
    hud.classList.toggle('is-met', active.phase === 'live' && Boolean(ev?.met));
  };

  const complete = (ev) => {
    active.phase = 'done';
    done.add(active.mission.id);
    saveDone();
    renderChips();
    renderPredict();
    renderHud(ev);
    const next = MISSIONS.find((m) => !done.has(m.id));
    nextButton.hidden = !next;
    nextButton.textContent = next ? `Next · ${next.title}` : 'Done';
  };

  const start = (id) => {
    const mission = MISSIONS.find((m) => m.id === id);
    if (!mission) return;
    const want = mission.dim || '2d';
    if (store.state.dim !== want) actions.setDim(want);
    if (want === '3d') {
      if (store.state.build !== 'sketch') actions.setBuild?.('sketch');
      if (store.state.input !== 'draw') actions.setInput('draw');
      if (mission.preset) actions.selectPreset(mission.preset);
      if (mission.plan) actions.setPlan?.(mission.plan);
      if (mission.goal.type === 'vorticity3d' && store.state.vorticity) {
        store.patch({ vorticity: false });
        actions.syncStatic?.();
      }
    } else if (mission.input === 'camera') {
      actions.setInput('camera');
    } else {
      if (store.state.input !== 'draw') actions.setInput('draw');
      if (mission.preset) actions.selectPreset(mission.preset);
      if (mission.goal.type === 'laminar' && !store.state.vorticity) {
        store.patch({ vorticity: true });
        actions.syncStatic?.();
      }
    }
    active = { mission, phase: 'settle', baseline: null, hold: 0, startedAt: performance.now(), guess: null };
    renderPredict();
    nextButton.hidden = true;
    lastHud = '';
    renderChips();
    renderHud(null);
    document.getElementById('stage')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const quit = () => {
    active = null;
    renderPredict();
    renderChips();
    renderHud(null);
  };

  chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mission]');
    if (!button) return;
    if (active?.mission.id === button.dataset.mission) quit();
    else start(button.dataset.mission);
  });
  quitButton.addEventListener('click', quit);
  nextButton.addEventListener('click', () => {
    const next = MISSIONS.find((m) => !done.has(m.id));
    if (next) start(next.id);
    else quit();
  });

  renderChips();
  renderHud(null);

  return {
    MISSIONS,
    start,
    quit,
    get active() {
      return active;
    },
    get done() {
      return [...done];
    },
    /** Called from the frame loop when a five-second test finishes. */
    onTestComplete({ input, dim, plan }) {
      if (!active || active.phase === 'done') return;
      const g = active.mission.goal;
      if (g.type === 'test' && String(dim).toUpperCase() === g.dim && (!g.plan || plan === g.plan)) {
        complete({ display: 'Test complete', progress: 1, met: true });
        return;
      }
      if (active.mission.goal.type === 'camera_test' && input === 'camera') {
        complete({ display: 'Test complete', progress: 1, met: true });
      }
    },
    tick() {
      if (!active || active.phase === 'done') return;
      const s = store.state;
      if (active.phase === 'settle') {
        if (['camera_test', 'test', 'vorticity3d'].includes(active.mission.goal.type)) {
          active.phase = 'live';
          active.baseline = { cd: 0, cl: 0, re: s.metrics.re };
        } else {
          const history = s.metrics.history || [];
          const elapsed = performance.now() - active.startedAt;
          const recent = history.slice(-SETTLE_WINDOW);
          const spread = recent.length
            ? (Math.max(...recent) - Math.min(...recent)) / Math.max(Math.max(...recent), 1e-4)
            : 1;
          const stable = recent.length >= SETTLE_WINDOW && spread < SETTLE_SPREAD;
          const ready = elapsed >= SETTLE_MAX_MS || (elapsed >= SETTLE_MIN_MS && stable);
          if (!s.running || !ready || !(s.metrics.boundaryCells > 0)) {
            active.settle = Math.min(1, elapsed / SETTLE_MAX_MS);
            renderHud(null);
            return;
          }
          active.phase = 'live';
          active.baseline = {
            cd: Math.max(0.02, mean(recent)),
            cl: s.metrics.cl,
            re: s.metrics.re,
          };
          active.baselineVersion = actions.maskVersion?.();
        }
      }
      const ev = evaluate();
      // A sculpting mission only counts once the shape has actually changed,
      // so a baseline that is still settling can never "beat itself".
      if (['cd_reduce', 'cl_above', 'cd_below'].includes(active.mission.goal.type) && actions.maskVersion) {
        if (actions.maskVersion() === active.baselineVersion) {
          if (ev.met) ev.display = `${ev.display} · change the shape first`;
          ev.met = false;
        }
      }
      if (ev.met && s.running) {
        active.hold += 1;
        if (active.hold >= HOLD_TICKS) {
          complete(ev);
          return;
        }
      } else {
        active.hold = 0;
      }
      renderHud(ev);
    },
  };
}
