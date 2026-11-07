/**
 * Road-speed translation of a drag coefficient.
 *
 * The tunnel reports a relative 2D drag coefficient. To make it tangible we
 * scale it onto a mid-size car's frontal area at highway speed and report the
 * drag share of its power, fuel and CO₂. It is an estimate for comparison, not
 * a certified figure — the point is that a 20% drag cut is 20% less fuel spent
 * pushing air, and the panel shows that in litres.
 */
export const ROAD = {
  rho: 1.2, // kg/m³, air at sea level
  area: 2.2, // m², frontal area of a mid-size car
  speedKmh: 100,
  fuelMJ: 34.2, // MJ per litre of petrol
  engineEff: 0.25, // tank-to-wheel efficiency
  co2PerLitre: 2310, // grams of CO₂ per litre burnt
};

export function roadImpact(cd) {
  if (!Number.isFinite(cd) || cd <= 0) return null;
  const v = ROAD.speedKmh / 3.6;
  const powerW = 0.5 * ROAD.rho * v * v * v * cd * ROAD.area;
  const joulesPer100km = powerW * (100000 / v);
  const litresPer100km = joulesPer100km / (ROAD.fuelMJ * 1e6 * ROAD.engineEff);
  const co2gPerKm = (litresPer100km / 100) * ROAD.co2PerLitre;
  return { powerKw: powerW / 1000, litresPer100km, co2gPerKm };
}

const BASELINE_KEY = 'aerolab-baseline';

function loadBaseline() {
  try {
    const raw = localStorage.getItem(BASELINE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function thumbnail(maskCanvas) {
  const w = 132;
  const h = 66;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2ead6';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0, w, h);
  return c.toDataURL('image/png');
}

const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Binds the "At road speed" and "Compare" rail blocks. */
export function createImpactPanel(store, { mask, labelFor }) {
  const $ = (id) => document.getElementById(id);
  const power = $('impact-power');
  const fuel = $('impact-fuel');
  const co2 = $('impact-co2');
  const pinButton = $('pin-baseline');
  const clearButton = $('clear-baseline');
  const body = $('compare-body');
  const thumb = $('baseline-thumb');
  const baselineName = $('baseline-name');
  const baselineCd = $('baseline-cd');
  const deltaValue = $('compare-delta');
  const deltaNote = $('compare-note');

  let baseline = loadBaseline();
  let lastSignature = '';

  const renderBaseline = () => {
    body.classList.toggle('has-baseline', Boolean(baseline));
    clearButton.hidden = !baseline;
    if (!baseline) return;
    thumb.src = baseline.thumb;
    baselineName.textContent = baseline.name;
    baselineCd.textContent = fmt(baseline.cd, 3);
  };

  pinButton.addEventListener('click', () => {
    const m = store.state.metrics;
    if (!(m.boundaryCells > 0) || !Number.isFinite(m.cd)) return;
    baseline = {
      cd: m.cd,
      cl: m.cl,
      name: labelFor(store.state),
      thumb: thumbnail(mask.canvas),
      at: Date.now(),
    };
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline));
    } catch {
      /* storage unavailable */
    }
    lastSignature = '';
    renderBaseline();
  });

  clearButton.addEventListener('click', () => {
    baseline = null;
    try {
      localStorage.removeItem(BASELINE_KEY);
    } catch {
      /* ignore */
    }
    lastSignature = '';
    renderBaseline();
  });

  renderBaseline();

  return {
    get baseline() {
      return baseline;
    },
    tick() {
      const m = store.state.metrics;
      const live = m.boundaryCells > 0 && Number.isFinite(m.cd) && m.cd > 0;
      const cd = live ? m.cd : NaN;
      const signature = `${cd.toFixed(4)}:${baseline?.at ?? 0}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      const impact = roadImpact(cd);
      power.textContent = impact ? fmt(impact.powerKw, 1) : '—';
      fuel.textContent = impact ? fmt(impact.litresPer100km, 1) : '—';
      co2.textContent = impact ? String(Math.round(impact.co2gPerKm)) : '—';
      pinButton.disabled = !live;

      if (!baseline) return;
      if (!impact) {
        deltaValue.textContent = '—';
        deltaValue.className = 'compare-delta';
        deltaNote.textContent = 'Shape something to compare against the pinned design.';
        return;
      }
      const ratio = (cd - baseline.cd) / Math.max(baseline.cd, 1e-6);
      const pct = Math.round(Math.abs(ratio) * 100);
      const base = roadImpact(baseline.cd);
      const litresPer10k = ((base?.litresPer100km ?? 0) - impact.litresPer100km) * 100;
      if (Math.abs(ratio) < 0.01) {
        deltaValue.textContent = '±0%';
        deltaValue.className = 'compare-delta';
        deltaNote.textContent = 'Same drag as the pinned design.';
      } else if (ratio < 0) {
        deltaValue.textContent = `−${pct}%`;
        deltaValue.className = 'compare-delta is-better';
        deltaNote.textContent = `drag · saves ${fmt(litresPer10k, 1)} L per 10,000 km`;
      } else {
        deltaValue.textContent = `+${pct}%`;
        deltaValue.className = 'compare-delta is-worse';
        deltaNote.textContent = `drag · burns ${fmt(-litresPer10k, 1)} L more per 10,000 km`;
      }
    },
  };
}
