/**
 * Describe and race.
 *
 * Type two objects. Each becomes a silhouette (from the built-in library, or
 * drawn by Claude for anything unusual), is placed in the tunnel, left to
 * settle, measured for five seconds, and the two results are compared in
 * drag, fuel and CO2. In camera mode with hand tracking the object is held in
 * the user's palm instead of drawn, so it moves with the hand.
 */
import { findShape, drawPolygon, cleanPolygon, RACE_EXAMPLES } from './shapes.js';
import { roadImpact } from './impact.js';

const SETTLE_MIN_MS = 2500;
const SETTLE_MAX_MS = 8000;
const SETTLE_WINDOW = 12;
const SETTLE_SPREAD = 0.08;
const AI_TIMEOUT_MS = 14000;

const escapeHtml = (value) => {
  const el = document.createElement('span');
  el.textContent = value;
  return el.innerHTML;
};

async function askAi(prompts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch('/api/shapes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompts }),
      signal: controller.signal,
    });
    if (response.status === 503) throw new Error('offline');
    if (!response.ok) throw new Error(`shapes ${response.status}`);
    const data = await response.json();
    return (data.shapes || []).map((s) => {
      const points = cleanPolygon(s.points);
      return points ? { label: s.name, points, why: s.why || '', source: 'ai' } : null;
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createRace(store, { mask, camera, impact, startBenchmark, setInput, setAutoName, clearFlow, syncStatic }) {
  const $ = (id) => document.getElementById(id);
  const form = $('race-form');
  const inputA = $('race-a');
  const inputB = $('race-b');
  const goButton = $('race-go');
  const handButton = $('race-hand');
  const stopButton = $('race-stop');
  const status = $('race-status');
  const bar = $('race-bar');
  const result = $('race-result');
  const examples = $('race-examples');
  const tag = $('race-tag');
  if (!form) return { tick() {}, active: null };

  let active = null;
  let useHand = false;

  examples.innerHTML = RACE_EXAMPLES.map(
    ([a, b]) => `<button type="button" class="race-example" data-a="${escapeHtml(a)}" data-b="${escapeHtml(b)}">${escapeHtml(a)} <i>vs</i> ${escapeHtml(b)}</button>`,
  ).join('');
  examples.addEventListener('click', (event) => {
    const chip = event.target.closest('.race-example');
    if (!chip) return;
    inputA.value = chip.dataset.a;
    inputB.value = chip.dataset.b;
    start();
  });

  const setStatus = (text, state = '') => {
    status.textContent = text;
    status.dataset.state = state;
  };
  const setBar = (fraction) => {
    bar.hidden = fraction == null;
    if (fraction != null) bar.style.setProperty('--p', String(Math.max(0, Math.min(1, fraction))));
  };
  const setTag = (text) => {
    tag.hidden = !text;
    if (text) tag.textContent = text;
  };
  const busy = (flag) => {
    goButton.disabled = flag;
    inputA.disabled = flag;
    inputB.disabled = flag;
    stopButton.hidden = !flag;
    form.classList.toggle('is-busy', flag);
  };

  const snapshot = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 264;
    canvas.height = 132;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#07100f';
    ctx.fillRect(0, 0, 264, 132);
    ctx.drawImage(mask.canvas, 0, 0, 264, 132);
    return canvas;
  };

  async function resolve(prompts) {
    const shapes = prompts.map((p) => findShape(p));
    const missing = prompts.map((p, i) => (shapes[i] ? null : p)).filter(Boolean);
    if (missing.length) {
      setStatus(`Asking the coach to draw ${missing.map((m) => `“${m}”`).join(' and ')}…`, 'loading');
      let drawn;
      try {
        drawn = await askAi(missing);
      } catch (error) {
        const known = 'teardrop, brick, ball, egg, wing, plate, bullet, cone, dome, parachute, fish, bird, rocket, pencil, bus, truck, car, sports car, train, leaf, person, hand, bottle';
        if (error.message === 'offline') {
          throw new Error(`The AI drawer is not switched on here, so I can only draw objects I know: ${known}.`);
        }
        throw new Error(`I couldn't draw that right now. Try one of: ${known}.`);
      }
      let d = 0;
      for (let i = 0; i < shapes.length; i += 1) {
        if (shapes[i]) continue;
        const shape = drawn[d];
        d += 1;
        if (!shape) throw new Error(`I couldn't make a silhouette for “${prompts[i]}”. Try describing it as a simpler object.`);
        shapes[i] = shape;
      }
    }
    return shapes.map((s, i) => ({ ...s, prompt: prompts[i] }));
  }

  function place(index) {
    const shape = active.shapes[index];
    active.index = index;
    active.phase = 'settle';
    active.placedAt = performance.now();
    active.boundaryAt = 0;
    active.sawRunning = false;
    active.retries = 0;
    store.patch({ preset: 'custom', tool: 'draw' });
    if (active.hand) {
      if (camera.frozen) camera.setFrozen(false);
      camera.setHeldShape({ label: shape.label, points: shape.points });
      mask.clear();
      mask.upload();
      clearFlow();
    } else {
      if (store.state.input !== 'draw') setInput('draw');
      drawPolygon(mask, shape.points);
      mask.upload();
      clearFlow();
    }
    syncStatic();
    setTag(`RACE ${index + 1} / 2 · ${shape.label.toUpperCase()} · SETTLING`);
    setStatus(active.hand ? `Hold up your open palm. ${shape.label} will appear in it.` : `${shape.label} is in the tunnel. Letting the wake form…`, 'loading');
    setBar(0);
  }

  async function start() {
    if (active) return;
    const prompts = [inputA.value, inputB.value].map((v) => v.trim()).filter(Boolean);
    if (prompts.length < 2) {
      setStatus('Describe two objects, then press Race.', 'warn');
      (inputA.value.trim() ? inputB : inputA).focus();
      return;
    }
    result.hidden = true;
    busy(true);
    setStatus('Drawing the silhouettes…', 'loading');
    let shapes;
    try {
      shapes = await resolve(prompts);
    } catch (error) {
      busy(false);
      setStatus(error.message, 'warn');
      return;
    }
    const hand = useHand;
    if (hand) {
      await setInput('camera');
      const handMode = document.getElementById('cam-mode-hand');
      if (handMode && !handMode.classList.contains('is-active')) handMode.click();
      if (!camera.active) camera.startCamera();
    }
    active = { shapes, hand, results: [], index: 0, phase: 'settle' };
    place(0);
  }

  function cancel(message) {
    if (!active) return;
    const wasHand = active.hand;
    active = null;
    busy(false);
    setBar(null);
    setTag(null);
    setAutoName(null);
    if (wasHand) camera.setHeldShape(null);
    setStatus(message, 'warn');
  }

  function finish() {
    const [a, b] = active.results;
    const shapes = active.shapes;
    const wasHand = active.hand;
    active = null;
    busy(false);
    setBar(null);
    setTag(null);
    setAutoName(null);
    if (wasHand && camera.frozen) camera.setFrozen(false);

    const roadA = roadImpact(a.cd);
    const roadB = roadImpact(b.cd);
    const winner = a.cd <= b.cd ? 0 : 1;
    const loser = 1 - winner;
    const pair = [a, b];
    const pct = Math.round((1 - pair[winner].cd / Math.max(1e-6, pair[loser].cd)) * 100);
    const litres = Math.abs(roadA.litresPer100km - roadB.litresPer100km) * 100;
    const co2 = (Math.abs(roadA.co2gPerKm - roadB.co2gPerKm) * 10000) / 1000;
    const tie = Math.abs(a.cd - b.cd) < 0.015;

    const card = (r, s, i) => `
      <article class="race-entry ${i === winner && !tie ? 'is-winner' : ''}">
        <img src="${r.thumb.toDataURL('image/png')}" alt="Silhouette of ${escapeHtml(r.label)}" />
        <div class="race-entry-body">
          <span class="race-entry-tag">${i === winner && !tie ? 'LESS DRAG' : i === loser && !tie ? 'MORE DRAG' : 'EVEN'} · ${escapeHtml(s.source === 'ai' ? 'drawn by Claude' : 'library')}</span>
          <h3>${escapeHtml(r.label)}</h3>
          <div class="race-entry-stats">
            <span><b>${r.cd.toFixed(3)}</b><small>C<sub>d</sub></small></span>
            <span><b>${r.cl.toFixed(2)}</b><small>C<sub>l</sub></small></span>
            <span><b>${roadImpact(r.cd).litresPer100km.toFixed(1)}</b><small>L / 100 km</small></span>
          </div>
          <p>${escapeHtml(s.why || '')}</p>
        </div>
      </article>`;

    const headline = tie
      ? `${a.label} and ${b.label} are within a whisker of each other.`
      : `${pair[winner].label} wins with ${pct}% less drag than ${pair[loser].label}.`;
    const sub = tie
      ? 'Try a shape with a tail against one without to see a real gap.'
      : `On a car at highway speed, over 10,000 km that is about ${litres.toFixed(0)} litres of petrol and ${co2.toFixed(0)} kg of CO₂, from drag alone.`;

    result.innerHTML = `
      <div class="race-headline">
        <span class="eyebrow">Result</span>
        <h3>${escapeHtml(headline)}</h3>
        <p>${escapeHtml(sub)}</p>
      </div>
      <div class="race-entries">${card(a, shapes[0], 0)}${card(b, shapes[1], 1)}</div>
      <div class="race-actions">
        <button type="button" class="shape-chip shape-chip-strong" id="race-swap">Run it in reverse</button>
        <button type="button" class="shape-chip" id="race-copy">Copy result</button>
        <button type="button" class="shape-chip" id="race-clear">New race</button>
      </div>`;
    result.hidden = false;
    setStatus(`Done. ${pair[winner].label} is pinned as the baseline, so anything you sculpt now is compared against it.`, 'done');
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    $('race-swap').addEventListener('click', () => {
      const va = inputA.value;
      inputA.value = inputB.value;
      inputB.value = va;
      start();
    });
    $('race-clear').addEventListener('click', () => {
      result.hidden = true;
      inputA.value = '';
      inputB.value = '';
      inputA.focus();
      setStatus('', '');
      if (wasHand) camera.setHeldShape(null);
    });
    $('race-copy').addEventListener('click', async () => {
      const text = `AEROLAB race: ${headline} ${sub} (${a.label} Cd ${a.cd.toFixed(3)} vs ${b.label} Cd ${b.cd.toFixed(3)}) ${location.origin}`;
      try {
        await navigator.clipboard.writeText(text);
        $('race-copy').textContent = 'Copied';
      } catch {
        $('race-copy').textContent = 'Copy failed';
      }
    });
  }

  function tick() {
    if (!active) return;
    const now = performance.now();
    const s = store.state;
    const m = s.metrics;
    const shape = active.shapes[active.index];

    if (active.phase === 'settle') {
      if (!m.boundaryCells) {
        active.boundaryAt = 0;
        if (active.hand) setStatus(`Show your open palm to the camera. ${shape.label} will sit in it.`, 'loading');
        if (now - active.placedAt > 45000) cancel('No shape appeared in the tunnel. Check the camera and try again.');
        return;
      }
      if (!active.boundaryAt) active.boundaryAt = now;
      const elapsed = now - active.boundaryAt;
      const history = m.history || [];
      const recent = history.slice(-SETTLE_WINDOW).map((h) => (Array.isArray(h) ? h[0] : h?.cd ?? h));
      const finite = recent.filter((v) => Number.isFinite(v));
      const mean = finite.reduce((a, b) => a + b, 0) / Math.max(1, finite.length);
      const spread = finite.length ? (Math.max(...finite) - Math.min(...finite)) / Math.max(1e-6, Math.abs(mean)) : 1;
      const stable = finite.length >= SETTLE_WINDOW && spread < SETTLE_SPREAD;
      setBar(Math.min(1, elapsed / SETTLE_MAX_MS) * 0.4);
      if (elapsed >= SETTLE_MAX_MS || (elapsed >= SETTLE_MIN_MS && stable)) {
        setAutoName(shape.label);
        startBenchmark();
        active.phase = 'test';
        active.testRequestedAt = now;
        active.sawRunning = false;
        setTag(`RACE ${active.index + 1} / 2 · ${shape.label.toUpperCase()} · MEASURING`);
        setStatus(`Measuring ${shape.label} for five seconds…`, 'loading');
      }
      return;
    }

    if (active.phase === 'test') {
      const b = s.benchmark;
      if (b.running) {
        active.sawRunning = true;
        setBar(0.4 + b.progress * 0.6);
        setStatus(`Measuring ${shape.label}… ${Math.round(b.progress * 100)}%`, 'loading');
        return;
      }
      if (b.done && active.sawRunning) {
        const thumb = snapshot();
        active.results.push({ label: shape.label, cd: b.cd, cl: b.cl, thumb });
        if (active.index === 0) {
          impact.setBaseline({ cd: b.cd, cl: b.cl, name: shape.label, canvas: thumb });
          place(1);
        } else {
          finish();
        }
        return;
      }
      if (active.sawRunning) {
        cancel('The test was interrupted. Press Race to try again.');
        return;
      }
      if (now - active.testRequestedAt > 1200) {
        active.retries += 1;
        if (active.retries > 4) {
          cancel(active.hand ? 'The camera outline was not steady enough to test. Hold still and try again.' : 'The test could not start. Try again.');
          return;
        }
        active.testRequestedAt = now;
        startBenchmark();
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    start();
  });
  stopButton.addEventListener('click', () => cancel('Race stopped.'));
  handButton.addEventListener('click', () => {
    useHand = !useHand;
    handButton.setAttribute('aria-pressed', String(useHand));
    handButton.classList.toggle('is-active', useHand);
    setStatus(useHand ? 'The objects will appear in your hand through the camera.' : 'The objects will be drawn straight into the tunnel.', '');
  });
  if (!navigator.mediaDevices?.getUserMedia) handButton.hidden = true;

  return {
    tick,
    start,
    cancel,
    get active() {
      return active;
    },
  };
}
