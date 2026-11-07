import './style.css';
import { createContext, FullscreenQuad } from './gl/utils.js';
import { MaskEditor } from './gl/mask.js';
import { FluidSim } from './gl/fluid.js';
import { ParticleSystem } from './gl/particles.js';
import { Renderer } from './gl/renderer.js';
import { Telemetry } from './telemetry.js';
import { createStore, computeRe, regimeFor, windToInlet } from './state.js';
import { createUI } from './ui.js';

const store = createStore();

const canvas = document.getElementById('gl-canvas');
const overlay = document.getElementById('input-overlay');
const stage = document.getElementById('stage');
const cursor = document.getElementById('brush-cursor');
const errorOverlay = document.getElementById('error-overlay');
const errorTitle = document.getElementById('error-title');
const errorText = document.getElementById('error-text');

let ui = null;
let fluid = null;
let particles = null;
let renderer = null;
let mask = null;
let telemetry = null;
let quad = null;
let gl = null;
let benchmark = null;

const EMPTY_BENCHMARK = { running: false, done: false, progress: 0, cd: 0, cl: 0 };

function showError(title, error) {
  console.error(error);
  errorOverlay.hidden = false;
  errorTitle.textContent = title;
  errorText.textContent = error?.message || String(error);
}

function resetMetrics() {
  const s = store.state;
  const re = computeRe(s.windSpeed, s.viscosity);
  store.patch({
    metrics: {
      cd: 0,
      cl: 0,
      fd: 0,
      fl: 0,
      re,
      regime: regimeFor(re),
      refLength: mask?.refLength || 0.62,
      boundaryCells: 0,
      iterations: fluid?.iterations || 38,
      history: [],
    },
  });
}

function cancelBenchmark() {
  benchmark = null;
  const b = store.state.benchmark;
  if (b.running || b.done) store.patch({ benchmark: { ...EMPTY_BENCHMARK } });
}

function startBenchmark() {
  if (benchmark) return;
  benchmark = { start: performance.now(), samples: [] };
  store.patch({ benchmark: { ...EMPTY_BENCHMARK, running: true } });
}

function clearFlow() {
  cancelBenchmark();
  fluid.resetFlow(windToInlet(store.state.windSpeed));
  fluid.mask.getCpuMask();
  particles.seed();
  telemetry.reset();
  resetMetrics();
}

function resizeCanvas() {
  if (!gl) return;
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round(rect.width * dpr));
  const height = Math.max(2, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  renderer.resize();
}

function applyResolution(size) {
  if (!fluid || size === fluid.size) return;
  cancelBenchmark();
  store.patch({ resolution: size });
  mask.resize(size);
  fluid.resize(size);
  telemetry.resize(size);
  particles.seed();
  fluid.resetFlow(windToInlet(store.state.windSpeed));
  fluid.mask.getCpuMask();
  telemetry.reset();
  resetMetrics();
  ui?.syncStatic();
}

function selectPreset(name) {
  store.patch({ preset: name, tool: 'draw' });
  if (name === 'custom') {
    mask.clear();
  } else {
    mask.drawPreset(name);
  }
  mask.upload();
  clearFlow();
  ui?.syncStatic();
}

function clearMask() {
  store.patch({ preset: 'custom' });
  mask.clear();
  mask.upload();
  clearFlow();
  ui?.syncStatic();
}

function resetSimulation() {
  clearFlow();
  ui?.syncStatic();
}

function init() {
  gl = createContext(canvas);
  quad = new FullscreenQuad(gl);

  mask = new MaskEditor(gl, store.state.resolution);
  mask.drawPreset('airfoil');
  mask.upload();

  fluid = new FluidSim(gl, quad, mask);
  fluid.resetFlow(windToInlet(store.state.windSpeed));
  particles = new ParticleSystem(gl, quad);
  renderer = new Renderer(gl, quad);
  telemetry = new Telemetry(gl);
  telemetry.configure(fluid.size);

  resizeCanvas();
  mask.bindInput(overlay, cursor, store);

  ui = createUI(store, {
    setResolution: applyResolution,
    selectPreset,
    clearMask,
    reset: resetSimulation,
    runBenchmark: startBenchmark,
  });

  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(stage);
  window.addEventListener('resize', resizeCanvas);

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    showError(
      'WebGL context lost',
      new Error('The GPU reset the rendering context. Reload the page to restart the solver.'),
    );
  });

  // Public debug handle — useful for demos, profiling and the console.
  window.__AEROLAB__ = {
    store,
    get fluid() {
      return fluid;
    },
    get particles() {
      return particles;
    },
    get mask() {
      return mask;
    },
    get telemetry() {
      return telemetry;
    },
    setResolution: applyResolution,
    selectPreset,
    runBenchmark: startBenchmark,
  };

  let last = performance.now();
  let frameMs = 16.7;
  let fps = 60;
  let lastUi = 0;
  let lastStat = 0;

  const frame = (now) => {
    requestAnimationFrame(frame);

    const rawSeconds = Math.max(0.0001, (now - last) / 1000);
    last = now;
    const dt = Math.min(Math.max(rawSeconds, 1 / 240), 1 / 30);
    const s = store.state;
    const inlet = windToInlet(s.windSpeed);

    const params = {
      inlet,
      windSpeed: s.windSpeed,
      viscosity: s.viscosity,
      iterations: fluid.iterations,
      density: s.particleDensity,
      trailTime: 0.09,
    };

    if (s.running) {
      fluid.step(dt, params);
      particles.update(dt, fluid);
      telemetry.maybeRequest(fluid, s, now);
    }

    telemetry.poll(fluid, store);
    renderer.render(fluid, particles, params);

    frameMs += (rawSeconds * 1000 - frameMs) * 0.08;
    fps += (1000 / Math.max(frameMs, 0.1) - fps) * 0.08;

    if (benchmark) {
      const metrics = store.state.metrics;
      if (s.running && metrics.boundaryCells > 0 && Number.isFinite(metrics.cd)) {
        benchmark.samples.push([metrics.cd, metrics.cl]);
      }
      const progress = Math.min(1, (now - benchmark.start) / 5000);
      if (progress >= 1) {
        const count = Math.max(1, benchmark.samples.length);
        const cd = benchmark.samples.reduce((sum, v) => sum + v[0], 0) / count;
        const cl = benchmark.samples.reduce((sum, v) => sum + v[1], 0) / count;
        store.patch({
          benchmark: { running: false, done: true, progress: 1, cd, cl },
        });
        benchmark = null;
      } else {
        store.patch({
          benchmark: { running: true, done: false, progress, cd: 0, cl: 0 },
        });
      }
    }

    if (now - lastStat > 220) {
      store.patch({ fps, frameMs });
      lastStat = now;
    }

    if (now - lastUi > 50) {
      ui.tick();
      lastUi = now;
    }
  };

  requestAnimationFrame(frame);
}

try {
  init();
} catch (error) {
  showError('The GPU solver could not start', error);
}
