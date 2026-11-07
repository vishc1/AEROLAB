export const PARTICLE_CAPACITY = 256 * 256;

/** `size` is the vertical grid resolution; the test section is 2:1. */
export const RESOLUTIONS = [128, 192, 256];

export const WIND_MIN = 2;
export const WIND_MAX = 30;
export const VISCOSITY_MIN = 0.004;
export const VISCOSITY_MAX = 0.2;

/** Physical slider (m/s) -> solver inlet speed in domain units / second. */
export function windToInlet(wind) {
  const t = (wind - WIND_MIN) / (WIND_MAX - WIND_MIN);
  return 0.16 + Math.max(0, Math.min(1, t)) * 0.44;
}

export function computeRe(wind, viscosity) {
  return (wind * 1.0) / Math.max(viscosity, 0.0001);
}

export function formatRe(re) {
  if (re >= 10000) return `${(re / 1000).toFixed(1)}k`;
  if (re >= 1000) return `${(re / 1000).toFixed(2)}k`;
  return `${Math.round(re)}`;
}

export function regimeFor(re) {
  if (re < 180) return 'LAMINAR';
  if (re < 1200) return 'TRANSITIONAL';
  return 'TURBULENT';
}

export function gridLabel(size) {
  return `${size * 2} × ${size}`;
}

export class Store {
  constructor(initial) {
    this.state = { ...initial };
    this.listeners = new Map();
  }

  patch(partial) {
    const changed = [];
    for (const [key, value] of Object.entries(partial)) {
      if (this.state[key] !== value) {
        this.state[key] = value;
        changed.push(key);
      }
    }
    for (const key of changed) {
      const listeners = this.listeners.get(key);
      if (!listeners) continue;
      for (const listener of listeners) listener(this.state[key], this.state);
    }
    return changed;
  }

  subscribe(key, listener) {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    return () => this.listeners.get(key)?.delete(listener);
  }
}

const initialRe = computeRe(18, 0.026);

export function createStore() {
  return new Store({
    windSpeed: 18,
    viscosity: 0.026,
    particleDensity: 0.86,
    pointSize: 1.55,
    resolution: 192,
    brush: 14,
    tool: 'draw',
    preset: 'airfoil',
    running: true,
    fps: 60,
    frameMs: 16.7,
    metrics: {
      cd: 0,
      cl: 0,
      fd: 0,
      fl: 0,
      re: initialRe,
      regime: regimeFor(initialRe),
      refLength: 0.62,
      boundaryCells: 0,
      iterations: 38,
      history: [],
    },
    benchmark: {
      running: false,
      done: false,
      progress: 0,
      cd: 0,
      cl: 0,
    },
  });
}
