import {
  PARTICLE_CAPACITY,
  RESOLUTIONS,
  computeRe,
  formatRe,
  gridLabel,
  regimeFor,
} from './state.js';

const PRESET_META = {
  airfoil: { label: 'NACA 0012 · AoA 4.5°' },
  cylinder: { label: 'CYLINDER · VORTEX SHEDDING' },
  plate: { label: 'FLAT PLATE · NORMAL TO FLOW' },
  card: { label: 'TILTED CARD · LIFT & STALL' },
  car: { label: 'CAR PROFILE · BLUFF BODY' },
  custom: { label: 'CUSTOM BOUNDARY' },
};

function number(value, digits = 2) {
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return value.toFixed(digits);
}

function signed(value, digits = 3) {
  if (!Number.isFinite(value)) return (0).toFixed(digits);
  const text = Math.abs(value).toFixed(digits);
  return value < 0 ? `−${text}` : text;
}

function compact(value) {
  if (!Number.isFinite(value)) return '0.0';
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(1);
}

export function createUI(store, actions) {
  const $ = (id) => document.getElementById(id);

  const windSlider = $('wind-slider');
  const viscositySlider = $('viscosity-slider');
  const densitySlider = $('density-slider');
  const brushSlider = $('brush-slider');
  const resolutionSlider = $('resolution-slider');
  const windValue = $('wind-value');
  const viscosityValue = $('viscosity-value');
  const densityValue = $('density-value');
  const brushValue = $('brush-value');
  const resolutionValue = $('resolution-value');
  const reValue = $('re-value');
  const regimeChip = $('regime-chip');
  const livePill = $('live-pill');
  const liveLabel = $('live-label');
  const pauseOverlay = $('pause-overlay');
  const stageMode = $('stage-mode');
  const cdValue = $('cd-value');
  const cdTrend = $('cd-trend');
  const fdValue = $('fd-value');
  const flValue = $('fl-value');
  const clValue = $('cl-value');
  const ldValue = $('ld-value');
  const refLength = $('ref-length');
  const boundaryCount = $('boundary-count');
  const iterCount = $('iter-count');
  const hudWind = $('hud-wind');
  const hudParticles = $('hud-particles');
  const hudGrid = $('hud-grid');
  const hudIterations = $('hud-iterations');
  const footerPerf = $('footer-perf');
  const footerFps = $('footer-fps');
  const footerStatus = $('footer-status');
  const fpsTop = $('fps-top');
  const msTop = $('ms-top');
  const chart = $('cd-chart');
  const benchButton = $('run-benchmark');
  const benchLabel = $('bench-label');
  const benchProgress = $('bench-progress');
  const benchNote = $('bench-note');

  let lastCd = null;
  let chartDpr = 1;
  let chartWidth = 0;
  let chartHeight = 0;
  let chartSignature = '';

  const setRangeFill = (input) => {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const pct = ((value - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
  };

  const syncStatic = () => {
    const s = store.state;
    const particleCount = Math.round(PARTICLE_CAPACITY * s.particleDensity);
    windValue.innerHTML = `${s.windSpeed.toFixed(1)} <em>m/s</em>`;
    viscosityValue.innerHTML = `${s.viscosity.toFixed(3)} <em>m²/s</em>`;
    densityValue.textContent = particleCount.toLocaleString('en-US');
    brushValue.innerHTML = `${s.brush} <em>px</em>`;
    resolutionValue.textContent = gridLabel(s.resolution);
    hudWind.textContent = s.windSpeed.toFixed(1);
    hudParticles.textContent = (particleCount / 1000).toFixed(1);
    hudGrid.textContent = gridLabel(s.resolution);
    stageMode.textContent =
      (s.input === 'camera'
        ? 'LIVE CAMERA SHAPE'
        : s.input === 'model'
          ? 'BLENDER MODEL PROJECTION'
          : PRESET_META[s.preset]?.label ?? PRESET_META.custom.label) +
      (s.dim === '3d' ? ' · 3D' : '');
    const is3d = s.dim === '3d';
    document.body.classList.toggle('is-3d', is3d);
    document.body.classList.toggle('is-camera', s.input === 'camera');
    document.body.classList.toggle('is-model', s.input === 'model');
    $('gl3d-canvas').hidden = !is3d;
    $('build-chips').hidden = !is3d;
    $('camera-panel').hidden = s.input !== 'camera';
    $('model-panel').hidden = s.input !== 'model';
    $('tool-tabs').hidden = s.input !== 'draw';
    $('model-note').textContent = is3d
      ? '3D D3Q19 LATTICE-BOLTZMANN'
      : s.input === 'model'
        ? '2D PROJECTION FROM 3D MESH'
        : '2D MODEL · CREAM = SOLID';
    $('vort-toggle').setAttribute('aria-pressed', String(s.vorticity));
    document.querySelectorAll('[data-dim]').forEach((b) => b.classList.toggle('is-active', b.dataset.dim === s.dim));
    document.querySelectorAll('[data-input]').forEach((b) => b.classList.toggle('is-active', b.dataset.input === s.input));
    document.querySelectorAll('[data-build]').forEach((b) => b.classList.toggle('is-active', b.dataset.build === s.build));

    windSlider.value = String(s.windSpeed);
    viscositySlider.value = String(s.viscosity);
    densitySlider.value = String(Math.round(s.particleDensity * 100));
    brushSlider.value = String(s.brush);
    resolutionSlider.value = String(Math.max(0, RESOLUTIONS.indexOf(s.resolution)));

    for (const input of [windSlider, viscositySlider, densitySlider, brushSlider, resolutionSlider]) {
      setRangeFill(input);
    }

    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.preset === s.preset);
    });
    document.querySelectorAll('[data-tool]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.tool === s.tool);
    });

    document.body.classList.toggle('is-paused', !s.running);
    livePill.classList.toggle('is-paused', !s.running);
    liveLabel.textContent = s.running ? 'SIMULATING' : 'PAUSED';
    pauseOverlay.classList.toggle('is-visible', !s.running);
    footerStatus.textContent = s.running
      ? 'Pressure projection active'
      : 'Solver paused · state retained';
  };

  const syncRe = () => {
    const re = computeRe(store.state.windSpeed, store.state.viscosity);
    const regime = regimeFor(re);
    reValue.textContent = formatRe(re);
    regimeChip.textContent = regime;
    regimeChip.classList.toggle('is-laminar', regime === 'LAMINAR');
    regimeChip.classList.toggle('is-turbulent', regime === 'TURBULENT');
  };

  const drawChart = (history, currentCd) => {
    if (!chart) return;
    const rect = chart.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(40, rect.width);
    const height = Math.max(30, rect.height);
    const signature = `${Math.round(width * dpr)}:${Math.round(height * dpr)}:${history.length}:${currentCd.toFixed(4)}`;

    if (width !== chartWidth || height !== chartHeight || dpr !== chartDpr) {
      chartWidth = width;
      chartHeight = height;
      chartDpr = dpr;
      chart.width = Math.round(width * dpr);
      chart.height = Math.round(height * dpr);
    }
    if (signature === chartSignature) return;
    chartSignature = signature;

    const ctx = chart.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!history.length) {
      ctx.strokeStyle = 'rgba(217,255,63,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height - 10);
      ctx.lineTo(width, height - 10);
      ctx.stroke();
      return;
    }

    const data = history.length > 1 ? history : [currentCd, currentCd];
    const max = Math.max(0.08, ...data) * 1.18;
    const pad = 6;
    const plotW = width;
    const plotH = height - pad * 2;
    const step = plotW / Math.max(1, data.length - 1);

    ctx.beginPath();
    for (let i = 0; i < data.length; i += 1) {
      const x = i * step;
      const y = height - pad - (data[i] / max) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    const strokeGradient = ctx.createLinearGradient(0, 0, plotW, 0);
    strokeGradient.addColorStop(0, 'rgba(217,255,63,0.35)');
    strokeGradient.addColorStop(0.7, 'rgba(217,255,63,0.95)');
    strokeGradient.addColorStop(1, 'rgba(242,234,214,0.98)');
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = 1.3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.lineTo(plotW, height - pad);
    ctx.lineTo(0, height - pad);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, 'rgba(217,255,63,0.14)');
    fill.addColorStop(1, 'rgba(217,255,63,0)');
    ctx.fillStyle = fill;
    ctx.fill();

    const lastX = plotW;
    const lastY = height - pad - (data[data.length - 1] / max) * plotH;
    ctx.beginPath();
    ctx.arc(lastX - 2, lastY, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#f2ead6';
    ctx.shadowColor = 'rgba(217,255,63,0.85)';
    ctx.shadowBlur = 9;
    ctx.fill();
    ctx.shadowBlur = 0;
  };

  const renderBenchmark = () => {
    const bench = store.state.benchmark;
    if (!benchButton || !bench) return;

    const running = bench.running;
    const done = bench.done;
    benchButton.disabled = running;
    benchButton.classList.toggle('is-running', running);
    benchProgress.style.width = `${Math.round((bench.progress || 0) * 100)}%`;

    if (running) {
      const left = Math.max(0, 5 - (bench.progress || 0) * 5).toFixed(1);
      benchLabel.textContent = `Testing · ${left}s left`;
      benchNote.textContent = 'Averaging the pressure integral around the body.';
      benchNote.classList.remove('is-done');
    } else if (done) {
      benchLabel.textContent = 'Run another test';
      benchNote.textContent = `Cd ${signed(bench.cd, 3)} · Cl ${signed(bench.cl, 3)} — averaged over 5 s.`;
      benchNote.classList.add('is-done');
    } else {
      benchLabel.textContent = 'Run 5-second test';
      benchNote.textContent = 'Average pressure integral over five seconds.';
      benchNote.classList.remove('is-done');
    }
  };

  const renderMetrics = () => {
    const metrics = store.state.metrics;
    const s = store.state;
    const cd = metrics.cd || 0;
    const cl = metrics.cl || 0;
    const fd = metrics.fd || 0;
    const fl = metrics.fl || 0;
    const ld = Math.abs(cd) > 0.001 ? cl / cd : 0;

    cdValue.textContent = number(cd, 3);
    clValue.textContent = signed(cl, 3);
    fdValue.textContent = compact(fd);
    flValue.textContent = signed(fl, 1);
    ldValue.textContent = number(ld, 2);
    refLength.textContent = (metrics.refLength ?? 0).toFixed(3);
    boundaryCount.textContent = String(metrics.boundaryCells ?? 0);
    iterCount.textContent = String(metrics.iterations ?? 0);
    hudIterations.textContent = String(metrics.iterations ?? 0);

    if (lastCd !== null) {
      const delta = cd - lastCd;
      if (Math.abs(delta) < 0.0015) {
        cdTrend.textContent = 'steady load';
        cdTrend.className = 'cd-trend';
      } else {
        cdTrend.textContent = `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(4)} / sample`;
        cdTrend.className = `cd-trend ${delta > 0 ? 'is-up' : 'is-down'}`;
      }
    } else if (metrics.boundaryCells > 0) {
      cdTrend.textContent = 'surface integral online';
      cdTrend.className = 'cd-trend';
    }
    lastCd = cd;

    fpsTop.textContent = String(Math.round(s.fps));
    msTop.textContent = s.frameMs.toFixed(1);
    footerFps.textContent = `${Math.round(s.fps)} FPS`;
    footerPerf.textContent = `${s.frameMs.toFixed(1)} MS`;
    drawChart(metrics.history || [], cd);
    renderBenchmark();
  };

  // ---- inputs -------------------------------------------------------------
  windSlider.addEventListener('input', () => {
    const value = Number(windSlider.value);
    store.patch({ windSpeed: value });
    windValue.innerHTML = `${value.toFixed(1)} <em>m/s</em>`;
    hudWind.textContent = value.toFixed(1);
    setRangeFill(windSlider);
    syncRe();
  });

  viscositySlider.addEventListener('input', () => {
    const value = Number(viscositySlider.value);
    store.patch({ viscosity: value });
    viscosityValue.innerHTML = `${value.toFixed(3)} <em>m²/s</em>`;
    setRangeFill(viscositySlider);
    syncRe();
  });

  densitySlider.addEventListener('input', () => {
    const value = Number(densitySlider.value) / 100;
    store.patch({ particleDensity: value });
    const count = Math.round(PARTICLE_CAPACITY * value);
    densityValue.textContent = count.toLocaleString('en-US');
    hudParticles.textContent = (count / 1000).toFixed(1);
    setRangeFill(densitySlider);
  });

  brushSlider.addEventListener('input', () => {
    const value = Number(brushSlider.value);
    store.patch({ brush: value });
    brushValue.innerHTML = `${value} <em>px</em>`;
    setRangeFill(brushSlider);
  });

  resolutionSlider.addEventListener('input', () => {
    const size = RESOLUTIONS[Number(resolutionSlider.value)] ?? store.state.resolution;
    resolutionValue.textContent = gridLabel(size);
    setRangeFill(resolutionSlider);
  });

  resolutionSlider.addEventListener('change', () => {
    const size = RESOLUTIONS[Number(resolutionSlider.value)] ?? store.state.resolution;
    actions.setResolution(size);
  });

  document.querySelectorAll('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      actions.selectPreset(button.dataset.preset);
    });
  });

  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      store.patch({ tool: button.dataset.tool });
      document.querySelectorAll('[data-tool]').forEach((other) => {
        other.classList.toggle('is-active', other === button);
      });
    });
  });

  document.querySelectorAll('[data-dim]').forEach((b) => {
    b.addEventListener('click', () => actions.setDim(b.dataset.dim));
  });
  document.querySelectorAll('[data-input]').forEach((b) => {
    b.addEventListener('click', () => actions.setInput(b.dataset.input));
  });
  document.querySelectorAll('[data-build]').forEach((b) => {
    b.addEventListener('click', () => actions.setBuild(b.dataset.build));
  });
  $('vort-toggle').addEventListener('click', () => {
    store.patch({ vorticity: !store.state.vorticity });
    syncStatic();
  });
  $('clear-mask').addEventListener('click', () => actions.clearMask());
  $('reset-sim').addEventListener('click', () => actions.reset());
  $('toggle-run').addEventListener('click', () => {
    store.patch({ running: !store.state.running });
    syncStatic();
  });
  benchButton.addEventListener('click', () => {
    if (!store.state.benchmark.running) actions.runBenchmark?.();
  });

  // ---- docs modal ---------------------------------------------------------
  const modal = $('docs-modal');
  const openDocs = () => {
    modal.hidden = false;
    $('close-docs').focus();
  };
  const closeDocs = () => {
    modal.hidden = true;
  };
  $('open-docs').addEventListener('click', openDocs);
  $('close-docs').addEventListener('click', closeDocs);
  modal.querySelectorAll('[data-close-modal]').forEach((element) => {
    element.addEventListener('click', closeDocs);
  });

  window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.code === 'Space') {
      event.preventDefault();
      store.patch({ running: !store.state.running });
      syncStatic();
    }
    if (event.key === 'Escape' && !modal.hidden) closeDocs();
  });

  window.addEventListener('resize', () => {
    chartSignature = '';
  });

  syncStatic();
  syncRe();
  renderMetrics();

  return {
    tick() {
      renderMetrics();
    },
    syncStatic,
    syncRe,
  };
}
