import './style.css';
import { createContext, FullscreenQuad } from './gl/utils.js';
import { MaskEditor } from './gl/mask.js';
import { FluidSim } from './gl/fluid.js';
import { ParticleSystem } from './gl/particles.js';
import { Renderer } from './gl/renderer.js';
import { Telemetry } from './telemetry.js';
import { createStore, computeRe, regimeFor, windToInlet } from './state.js';
import { createUI } from './ui.js';
import { Sim3D } from './sim3d.js';
import { CameraTracker } from './camera.js';
import { createLeaderboard } from './leaderboard.js';
import { SketchDock } from './sketch.js';
import { createDemo } from './demo.js';
import { liftToDrag } from './scoring.js';

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
let sim3d = null;
let camera = null;
let leaderboard = null;
let modelImporter = null;
let modelImporterLoading = null;
let sketchDock = null;
let autoName = null;
let exportPending = false;
let baseline = null;

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

function rebuild3d() {
  if (!sim3d || store.state.dim !== '3d') return;
  if (sketchDock) sim3d.setPlanform(sketchDock.plan);
  sim3d.setObstacle(mask.getCpuMask(), mask.width, mask.height, store.state.build);
}

function setDim(dim) {
  if (dim === store.state.dim) return;
  cancelBenchmark();
  store.patch({ dim });
  if (dim === '3d') {
    sim3d.resetFlow();
    rebuild3d();
  } else {
    clearFlow();
  }
  resetMetrics();
  ui?.syncStatic();
}

function setInput(input) {
  if (input === store.state.input) {
    if (input === 'camera' && !camera.active) camera.startCamera();
    if (input === 'model') return initModelImporter();
    return Promise.resolve();
  }
  const previousInput = store.state.input;
  cancelBenchmark();
  store.patch({ input });
  ui?.syncStatic();
  if (previousInput === 'model') modelImporter?.deactivate();
  if (input === 'camera') {
    mask.clear();
    mask.upload();
    clearFlow();
    camera.startCamera();
  }
  else if (camera.active || camera.starting) camera.stopCamera();
  if (input === 'model') {
    if (!modelImporter?.modelScene) {
      mask.clear();
      mask.upload();
      clearFlow();
    }
    return initModelImporter();
  }
  return Promise.resolve();
}

function initModelImporter() {
  if (modelImporter) return Promise.resolve(modelImporter);
  if (modelImporterLoading) return modelImporterLoading;
  const status = document.getElementById('model-status');
  status.dataset.state = 'loading';
  status.querySelector('span').textContent = 'Loading the 3D model lab…';
  modelImporterLoading = import('./model-import.js')
    .then(({ ModelImporter }) => {
      modelImporter = new ModelImporter({
        mask,
        onMask: () => {
          mask.upload();
          if (store.state.preset !== 'custom') store.patch({ preset: 'custom' });
          rebuild3d();
          ui?.syncStatic();
        },
        onFlowReset: clearFlow,
      });
      return modelImporter;
    })
    .catch((error) => {
      console.error(error);
      status.dataset.state = 'error';
      status.querySelector('span').textContent = 'The 3D model lab could not start on this browser';
      return null;
    })
    .finally(() => {
      modelImporterLoading = null;
    });
  return modelImporterLoading;
}

function setBuild(build) {
  store.patch({ build });
  cancelBenchmark();
  rebuild3d();
  resetMetrics();
  ui?.syncStatic();
}

function startBenchmark() {
  if (benchmark) return;
  if (store.state.input === 'camera' && !camera.prepareForTest()) return;
  if (store.state.input === 'model' && !modelImporter?.prepareForTest()) return;
  benchmark = { start: performance.now(), samples: [] };
  store.patch({ benchmark: { ...EMPTY_BENCHMARK, running: true } });
}

function clearFlow() {
  cancelBenchmark();
  fluid.resetFlow(windToInlet(store.state.windSpeed));
  fluid.mask.getCpuMask();
  particles.seed();
  telemetry.reset();
  if (store.state.dim === '3d') {
    sim3d.resetFlow();
    rebuild3d();
  }
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
  sim3d?.resize();
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
  rebuild3d();
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

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function setupReports() {
  document.getElementById('export-png').addEventListener('click', () => {
    exportPending = true;
  });
  document.getElementById('export-csv').addEventListener('click', () => {
    const s = store.state;
    const m = s.metrics;
    const row = [
      s.dim, s.preset, s.windSpeed, s.viscosity, m.re.toFixed(1), m.regime,
      m.cd.toFixed(4), m.cl.toFixed(4), m.fd.toFixed(4), m.fl.toFixed(4), liftToDrag(m.cd, m.cl).toFixed(3),
    ];
    const csv = 'dim,shape,wind_mps,viscosity,reynolds,regime,cd,cl,drag_n,lift_n,lift_to_drag\n' + row.join(',') + '\n';
    download(new Blob([csv], { type: 'text/csv' }), `aerolab-results-${Date.now()}.csv`);
  });
  const body = document.getElementById('compare-body');
  document.getElementById('pin-baseline').addEventListener('click', () => {
    const m = store.state.metrics;
    baseline = { cd: m.cd, cl: m.cl, ld: liftToDrag(m.cd, m.cl), dim: store.state.dim };
  });
  setInterval(() => {
    if (!baseline) return;
    const m = store.state.metrics;
    const ld = liftToDrag(m.cd, m.cl);
    const d = (now, then, lowerIsBetter, digits = 3) => {
      const diff = now - then;
      const better = lowerIsBetter ? diff < 0 : diff > 0;
      const cls = Math.abs(diff) < 1e-3 ? '' : better ? 'cmp-down' : 'cmp-up';
      return `<span class="${cls}">${diff >= 0 ? '+' : ''}${diff.toFixed(digits)}</span>`;
    };
    body.innerHTML =
      `<div class="cmp-row"><span>Drag Cd</span><span>${baseline.cd.toFixed(3)} → ${m.cd.toFixed(3)} ${d(m.cd, baseline.cd, true)}</span></div>` +
      `<div class="cmp-row"><span>Lift Cl</span><span>${baseline.cl.toFixed(3)} → ${m.cl.toFixed(3)} ${d(m.cl, baseline.cl, false)}</span></div>` +
      `<div class="cmp-row"><span>L/D</span><span>${baseline.ld.toFixed(2)} → ${ld.toFixed(2)} ${d(ld, baseline.ld, false, 2)}</span></div>`;
  }, 400);
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
  sim3d = new Sim3D(document.getElementById('gl3d-canvas'));
  leaderboard = createLeaderboard();
  camera = new CameraTracker({
    mask,
    onMask: () => {
      mask.upload();
      if (store.state.preset !== 'custom') {
        store.patch({ preset: 'custom' });
        ui?.syncStatic();
      }
      rebuild3d();
    },
    onLost: clearFlow,
  });
  sketchDock = new SketchDock({
    mask,
    store,
    sideCanvas: document.getElementById('side-canvas'),
    planCanvas: document.getElementById('plan-canvas'),
    onChange: () => {
      mask.upload();
      if (store.state.preset !== 'custom') store.patch({ preset: 'custom' });
      rebuild3d();
      ui?.syncStatic();
    },
  });
  document.querySelectorAll('[data-plan]').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('[data-plan]').forEach((x) => x.classList.toggle('is-active', x === b));
      sketchDock.applyPreset(b.dataset.plan);
    }),
  );
  const symBtn = document.getElementById('plan-sym');
  symBtn.addEventListener('click', () => {
    sketchDock.symmetry = !sketchDock.symmetry;
    symBtn.setAttribute('aria-pressed', String(sketchDock.symmetry));
  });
  document.getElementById('plan-clear').addEventListener('click', () => sketchDock.clearPlan());
  resizeCanvas();
  mask.bindInput(overlay, cursor, store);

  ui = createUI(store, {
    setResolution: applyResolution,
    selectPreset,
    clearMask,
    reset: resetSimulation,
    runBenchmark: startBenchmark,
    setDim,
    setInput,
    setBuild,
  });

  setupReports();
  createDemo({
    store,
    actions: {
      setDim,
      setInput,
      setBuild,
      selectPreset,
      runBenchmark: startBenchmark,
      syncUI: () => ui?.syncStatic(),
      setAutoName: (n) => {
        autoName = n;
      },
    },
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
    setDim,
    get sim3d() {
      return sim3d;
    },
    get camera() {
      return camera;
    },
    get modelImporter() {
      return modelImporter;
    },
  };

  let last = performance.now();
  let frameMs = 16.7;
  let fps = 60;
  let lastUi = 0;
  let lastStat = 0;
  let lastMetric = 0;

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

    if (s.input === 'camera') camera.update(now);

    if (s.dim === '3d') {
      if (s.running) {
        const t0 = performance.now();
        let n = 0;
        do {
          sim3d.step(s.windSpeed, s.viscosity);
          n += 1;
        } while (n < 4 && performance.now() - t0 < 9);
        sim3d.advect();
      }
      sim3d.resize();
      sim3d.vorticity = s.vorticity;
      sketchDock.drawSide();
      sim3d.render(null);
      if (now - lastMetric > 60) {
        lastMetric = now;
        const re = computeRe(s.windSpeed, s.viscosity);
        const area = sim3d.refLength * sim3d.refLength;
        const q = 0.5 * 1.2 * s.windSpeed * s.windSpeed * area;
        store.patch({
          metrics: {
            cd: sim3d.cd,
            cl: sim3d.cl,
            fd: sim3d.cd * q,
            fl: sim3d.cl * q,
            re,
            regime: regimeFor(re),
            refLength: sim3d.refLength,
            boundaryCells: sim3d.surface.length ? sim3d.links : 0,
            iterations: 0,
            history: sim3d.history.slice(),
          },
        });
      }
    } else {
      if (s.running) {
        fluid.step(dt, params);
        particles.update(dt, fluid);
        telemetry.maybeRequest(fluid, s, now);
      }
      telemetry.poll(fluid, store);
      renderer.vorticity = s.vorticity;
      renderer.render(fluid, particles, params);
    }

    if (exportPending) {
      exportPending = false;
      const src = s.dim === '3d' ? document.getElementById('gl3d-canvas') : canvas;
      src.toBlob((blob) => blob && download(blob, `aerolab-${s.dim}-${Date.now()}.png`), 'image/png');
    }

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
        leaderboard.record({ cd, cl, dim: s.dim.toUpperCase(), name: autoName || undefined });
        autoName = null;
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
