import './style.css';
import { LBM, type Preset } from './lbm';

type Score = { id: number; name: string; drag: number; lift: number; efficiency: number; date: string; insight: string };
type Particle = { x: number; y: number; px: number; py: number; age: number };

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Slipstream home"><span class="brand-mark"><i></i><i></i><i></i></span><span>SLIPSTREAM</span></a>
    <div class="status"><span class="pulse"></span> D2Q9 ENGINE <b>LIVE</b></div>
    <button class="icon-button" id="aboutBtn" aria-label="About this simulation">?</button>
  </header>
  <main>
    <section class="hero-copy">
      <div><p class="eyebrow">A wind tunnel for your hands</p><h1>Build it. Hold it up.<br><em>See the air move.</em></h1></div>
      <p class="intro">Turn paper, clay, or whatever is on your desk into a live aerodynamics experiment. Lower drag wins.</p>
    </section>
    <section class="lab-shell">
      <div class="lab-toolbar">
        <div class="mode-tabs" role="tablist">
          <button class="mode-tab active" data-mode="draw"><span>01</span> Draw</button>
          <button class="mode-tab" data-mode="camera"><span>02</span> Camera</button>
        </div>
        <div class="preset-row">
          <span>QUICK SHAPES</span>
          <button data-preset="circle">Round</button><button data-preset="card">Card</button><button data-preset="airfoil">Airfoil</button><button data-preset="car">Car</button>
        </div>
        <div class="sim-indicator"><span></span> SIMULATING <b id="fps">-- FPS</b></div>
      </div>
      <div class="lab-grid">
        <div class="tunnel-wrap">
          <canvas id="tunnel" aria-label="Interactive wind tunnel. Drag to draw a solid shape."></canvas>
          <div class="tunnel-label inlet">AIR IN <span>→</span></div>
          <div class="tunnel-label outlet">OPEN OUTLET</div>
          <div class="scale"><span></span><label>FLOW SPEED</label><span></span></div>
          <div class="draw-hint" id="drawHint">DRAW A SHAPE · RIGHT-DRAG TO ERASE</div>
          <div class="camera-panel" id="cameraPanel" hidden>
            <video id="video" autoplay playsinline muted></video>
            <canvas id="maskPreview"></canvas>
            <div class="camera-copy"><b>Camera outline</b><span>Use a bright, plain backdrop.</span></div>
          </div>
          <div class="countdown" id="countdown" hidden><span>TEST RUN</span><strong>5.0</strong><small>Keep your shape steady</small></div>
        </div>
        <aside class="readouts">
          <div class="metric drag-metric"><span>RELATIVE DRAG</span><strong id="dragValue">0.000</strong><small><i id="dragTrend">●</i> lower is better</small></div>
          <div class="metric"><span>RELATIVE LIFT</span><strong id="liftValue">+0.000</strong><small>↑ upward force</small></div>
          <div class="mini-chart"><canvas id="chart"></canvas><span>FORCE HISTORY · 8 SEC</span></div>
          <div class="honesty"><b>2D MODEL</b><p>Relative comparison at low airspeed—not a real-world drag coefficient.</p></div>
        </aside>
      </div>
      <div class="controlbar">
        <div class="brush-controls"><button id="clearBtn">Clear</button><label>Brush <input id="brush" type="range" min="2" max="12" value="6"></label><button id="resetBtn">Reset flow</button></div>
        <div class="camera-controls" hidden><button id="cameraBtn">Start camera</button><label>Backdrop <select id="backdrop"><option value="white">White / bright</option><option value="green">Green</option></select></label><button id="freezeBtn" disabled>Freeze shape</button></div>
        <button class="capture" id="captureBtn"><span>◎</span> RUN 5-SECOND TEST</button>
      </div>
    </section>
    <section class="results-section">
      <div class="section-heading"><div><p class="eyebrow">Design challenge</p><h2>Workshop leaderboard</h2></div><p>Every run is normalized by object height, so tiny objects don't get a free pass.</p></div>
      <div class="results-grid">
        <div class="leaderboard" id="leaderboard"></div>
        <div class="coach-card" id="coachCard">
          <span class="coach-icon">✦</span><p class="eyebrow">Flow coach</p><h3>Run a test to get your design notes.</h3><p>Your score will appear here with a plain-English explanation of the wake, drag, and lift.</p>
        </div>
      </div>
    </section>
    <section class="how-it-works">
      <p class="eyebrow">Under the hood</p><h2>Real fluid physics,<br><em>running in your browser.</em></h2>
      <div class="steps"><article><span>01</span><h3>Make a silhouette</h3><p>Draw with your mouse or use a webcam against a clean backdrop.</p></article><article><span>02</span><h3>Move the air</h3><p>A D2Q9 lattice Boltzmann solver updates 23,040 fluid cells in real time.</p></article><article><span>03</span><h3>Measure the force</h3><p>Momentum exchange estimates drag and lift, then averages out the wobble.</p></article></div>
    </section>
  </main>
  <dialog id="aboutDialog"><button id="closeAbout" aria-label="Close">×</button><p class="eyebrow">About the model</p><h2>A tiny, honest wind tunnel.</h2><p>Slipstream uses a two-dimensional lattice Boltzmann simulation. It captures useful relative behavior—bluff shapes create broad wakes, streamlined shapes reduce drag, and angled surfaces generate lift.</p><p>It does not predict full-scale, three-dimensional aerodynamics. Treat the numbers as a fair design game, not engineering certification.</p></dialog>
  <footer><span>SLIPSTREAM / EXPERIMENT 001</span><span>BUILD WITH YOUR HANDS. LEARN BY FEEL.</span></footer>
`;

const sim = new LBM(240, 96);
const canvas = document.querySelector<HTMLCanvasElement>('#tunnel')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const fieldCanvas = document.createElement('canvas');
fieldCanvas.width = sim.width; fieldCanvas.height = sim.height;
const fieldCtx = fieldCanvas.getContext('2d')!;
const image = fieldCtx.createImageData(sim.width, sim.height);
const dragEl = document.querySelector('#dragValue')!;
const liftEl = document.querySelector('#liftValue')!;
const fpsEl = document.querySelector('#fps')!;
const chart = document.querySelector<HTMLCanvasElement>('#chart')!;
const chartCtx = chart.getContext('2d')!;
const particles: Particle[] = [];
const history: number[] = [];
let mode: 'draw' | 'camera' = 'draw';
let painting = false;
let erase = false;
let brush = 6;
let cameraStream: MediaStream | null = null;
let cameraFrozen = false;
let lastMaskUpdate = 0;
let captureStart = 0;
let captureSamples: { drag: number; lift: number }[] = [];
let frameCount = 0;
let fpsTime = performance.now();
let lastTime = performance.now();

for (let i = 0; i < 620; i++) particles.push(spawnParticle(Math.random() * sim.width));

function spawnParticle(x = 2): Particle {
  const y = 4 + Math.random() * (sim.height - 8);
  return { x, y, px: x, py: y, age: Math.random() * 260 };
}

function colorMap(value: number, vorticity: number) {
  const t = Math.max(0, Math.min(1, value / 0.15));
  const r = Math.round(5 + 14 * t + Math.max(0, vorticity) * 1300);
  const g = Math.round(17 + 110 * t + Math.abs(vorticity) * 500);
  const b = Math.round(18 + 165 * t + Math.max(0, -vorticity) * 1600);
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  chart.width = Math.round(chart.clientWidth * dpr);
  chart.height = Math.round(chart.clientHeight * dpr);
}

function renderField() {
  const pixels = image.data;
  for (let i = 0; i < sim.size; i++) {
    const p = i * 4;
    if (sim.obstacle[i]) {
      pixels[p] = 242; pixels[p + 1] = 240; pixels[p + 2] = 223; pixels[p + 3] = 255;
    } else {
      const [r, g, b] = colorMap(sim.speed[i], sim.vort[i]);
      pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
    }
  }
  fieldCtx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fieldCanvas, 0, 0, canvas.width, canvas.height);
  const sx = canvas.width / sim.width, sy = canvas.height / sim.height;
  ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
  for (const p of particles) {
    p.px = p.x; p.py = p.y;
    const [vx, vy] = sim.sampleVelocity(p.x, p.y);
    p.x += vx * 8.5; p.y += vy * 8.5; p.age++;
    const ix = Math.round(p.x), iy = Math.round(p.y);
    if (p.x >= sim.width - 2 || p.y < 2 || p.y > sim.height - 2 || p.age > 420 || sim.obstacle[ix + iy * sim.width]) Object.assign(p, spawnParticle());
    ctx.strokeStyle = `rgba(207,255,232,${0.16 + (p.age % 30) / 150})`;
    ctx.beginPath(); ctx.moveTo(p.px * sx, p.py * sy); ctx.lineTo(p.x * sx, p.y * sy); ctx.stroke();
  }
}

function drawChart() {
  const w = chart.width, h = chart.height;
  chartCtx.clearRect(0, 0, w, h);
  chartCtx.strokeStyle = 'rgba(255,255,255,.08)'; chartCtx.lineWidth = 1;
  for (let y = 0; y < 4; y++) { chartCtx.beginPath(); chartCtx.moveTo(0, y * h / 3); chartCtx.lineTo(w, y * h / 3); chartCtx.stroke(); }
  if (history.length < 2) return;
  const max = Math.max(0.5, ...history);
  chartCtx.strokeStyle = '#f1ff59'; chartCtx.lineWidth = 2 * (window.devicePixelRatio || 1); chartCtx.beginPath();
  history.forEach((value, i) => { const x = i / 179 * w; const y = h - value / max * h * .82 - h * .08; i ? chartCtx.lineTo(x, y) : chartCtx.moveTo(x, y); });
  chartCtx.stroke();
}

function pointerToGrid(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return [Math.floor((event.clientX - rect.left) / rect.width * sim.width), Math.floor((event.clientY - rect.top) / rect.height * sim.height)] as const;
}

function paint(event: PointerEvent) {
  if (mode !== 'draw') return;
  const [x, y] = pointerToGrid(event); sim.paint(x, y, brush, erase); sim.reset();
}

canvas.addEventListener('pointerdown', e => { painting = true; erase = e.button === 2 || e.altKey; canvas.setPointerCapture(e.pointerId); paint(e); });
canvas.addEventListener('pointermove', e => { if (painting) paint(e); });
canvas.addEventListener('pointerup', () => painting = false);
canvas.addEventListener('pointercancel', () => painting = false);
canvas.addEventListener('contextmenu', e => e.preventDefault());

document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => {
  sim.reset(button.dataset.preset as Preset);
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('selected', b === button));
}));

document.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode as typeof mode;
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === button));
  document.querySelector<HTMLElement>('.brush-controls')!.hidden = mode !== 'draw';
  document.querySelector<HTMLElement>('.camera-controls')!.hidden = mode !== 'camera';
  document.querySelector<HTMLElement>('#cameraPanel')!.hidden = mode !== 'camera';
  document.querySelector<HTMLElement>('#drawHint')!.hidden = mode !== 'draw';
}));

document.querySelector<HTMLInputElement>('#brush')!.addEventListener('input', e => brush = Number((e.target as HTMLInputElement).value));
document.querySelector('#clearBtn')!.addEventListener('click', () => sim.reset('clear'));
document.querySelector('#resetBtn')!.addEventListener('click', () => sim.reset());

const video = document.querySelector<HTMLVideoElement>('#video')!;
const maskPreview = document.querySelector<HTMLCanvasElement>('#maskPreview')!;
const maskCtx = maskPreview.getContext('2d', { willReadFrequently: true })!;
const cameraBtn = document.querySelector<HTMLButtonElement>('#cameraBtn')!;
const freezeBtn = document.querySelector<HTMLButtonElement>('#freezeBtn')!;
cameraBtn.addEventListener('click', async () => {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; cameraBtn.textContent = 'Start camera'; freezeBtn.disabled = true; return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = cameraStream; cameraBtn.textContent = 'Stop camera'; freezeBtn.disabled = false; cameraFrozen = false;
  } catch { cameraBtn.textContent = 'Camera blocked — try again'; }
});
freezeBtn.addEventListener('click', () => { cameraFrozen = !cameraFrozen; freezeBtn.textContent = cameraFrozen ? 'Unfreeze shape' : 'Freeze shape'; freezeBtn.classList.toggle('frozen', cameraFrozen); });

function updateCameraMask(now: number) {
  if (!cameraStream || cameraFrozen || video.readyState < 2 || now - lastMaskUpdate < 100) return;
  lastMaskUpdate = now; maskPreview.width = 240; maskPreview.height = 160;
  maskCtx.save(); maskCtx.scale(-1, 1); maskCtx.drawImage(video, -240, 0, 240, 160); maskCtx.restore();
  const frame = maskCtx.getImageData(0, 0, 240, 160); const d = frame.data;
  const raw = new Uint8Array(sim.size); const green = document.querySelector<HTMLSelectElement>('#backdrop')!.value === 'green';
  for (let y = 0; y < sim.height; y++) for (let x = 0; x < sim.width; x++) {
    const vy = Math.floor(y / sim.height * 160); const p = (x + vy * 240) * 4; const r = d[p], g = d[p + 1], b = d[p + 2];
    const foreground = green ? !(g > r * 1.28 && g > b * 1.18 && g > 70) : (r + g + b) / 3 < 185;
    if (foreground && x > 14 && x < sim.width - 18 && y > 3 && y < sim.height - 4) raw[x + y * sim.width] = 1;
  }
  const clean = new Uint8Array(sim.size);
  for (let y = 2; y < sim.height - 2; y++) for (let x = 15; x < sim.width - 18; x++) {
    let n = 0; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) n += raw[x + ox + (y + oy) * sim.width];
    clean[x + y * sim.width] = n >= 5 ? 1 : 0;
  }
  sim.setMask(clean);
  for (let p = 0; p < d.length; p += 4) { const on = raw[(p / 4) % 240 + Math.floor((p / 4) / 240) * sim.width] ?? 0; if (on) { d[p] = 241; d[p + 1] = 255; d[p + 2] = 89; } d[p + 3] = 255; }
  maskCtx.putImageData(frame, 0, 0);
}

function efficiency(drag: number, lift: number) { return Math.max(0, Math.min(100, 100 - drag * 24 + Math.min(8, Math.abs(lift) * 3))); }
function explain(drag: number, lift: number) {
  const wake = drag < .7 ? 'The narrow wake suggests the air is rejoining cleanly behind your shape.' : drag < 1.4 ? 'The wake is controlled, but the blunt regions are still shedding visible vortices.' : 'A broad, turbulent wake is carrying momentum away from the object.';
  const force = Math.abs(lift) < .12 ? 'It is nearly lift-neutral; tilt or curve a surface to redirect more air.' : lift > 0 ? 'The pressure imbalance is producing useful upward lift.' : 'The current angle is producing downforce; flip the tilt to reverse it.';
  return `${wake} ${force}`;
}

function getScores(): Score[] { try { return JSON.parse(localStorage.getItem('slipstream-scores') || '[]'); } catch { return []; } }
function saveScore(score: Score) { const scores = [...getScores(), score].sort((a, b) => b.efficiency - a.efficiency).slice(0, 8); localStorage.setItem('slipstream-scores', JSON.stringify(scores)); renderLeaderboard(); }
function renderLeaderboard() {
  const scores = getScores(); const box = document.querySelector('#leaderboard')!;
  if (!scores.length) { box.innerHTML = `<div class="empty-board"><span>NO RUNS YET</span><h3>Your workshop is waiting.</h3><p>Shape something, let the flow settle, and run a five-second test.</p></div>`; return; }
  box.innerHTML = `<div class="board-head"><span>RANK / DESIGN</span><span>DRAG</span><span>SCORE</span></div>` + scores.map((s, i) => `<div class="board-row"><b>${String(i + 1).padStart(2, '0')}</b><span><strong>${escapeHtml(s.name)}</strong><small>${s.date}</small></span><code>${s.drag.toFixed(3)}</code><em>${s.efficiency.toFixed(0)}</em></div>`).join('');
}
function escapeHtml(value: string) { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }

document.querySelector('#captureBtn')!.addEventListener('click', () => {
  if (captureStart) return;
  if (cameraStream && !cameraFrozen) { cameraFrozen = true; freezeBtn.textContent = 'Unfreeze shape'; freezeBtn.classList.add('frozen'); }
  captureStart = performance.now(); captureSamples = [];
  document.querySelector<HTMLElement>('#countdown')!.hidden = false;
  document.querySelector<HTMLButtonElement>('#captureBtn')!.disabled = true;
});

function finishCapture() {
  captureStart = 0; document.querySelector<HTMLElement>('#countdown')!.hidden = true; document.querySelector<HTMLButtonElement>('#captureBtn')!.disabled = false;
  const stable = captureSamples.slice(Math.floor(captureSamples.length * .35));
  const drag = stable.reduce((n, s) => n + s.drag, 0) / Math.max(1, stable.length);
  const lift = stable.reduce((n, s) => n + s.lift, 0) / Math.max(1, stable.length);
  const score = efficiency(drag, lift); const insight = explain(drag, lift);
  const name = window.prompt('Name this design for the leaderboard:', `Prototype ${getScores().length + 1}`)?.trim() || `Prototype ${getScores().length + 1}`;
  saveScore({ id: Date.now(), name, drag, lift, efficiency: score, date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), insight });
  document.querySelector('#coachCard')!.innerHTML = `<span class="coach-icon">✦</span><p class="eyebrow">Flow coach · latest run</p><div class="score-badge">${score.toFixed(0)}<small>/100</small></div><h3>${escapeHtml(name)}</h3><p>${insight}</p>`;
}

const about = document.querySelector<HTMLDialogElement>('#aboutDialog')!;
document.querySelector('#aboutBtn')!.addEventListener('click', () => about.showModal());
document.querySelector('#closeAbout')!.addEventListener('click', () => about.close());
about.addEventListener('click', e => { if (e.target === about) about.close(); });

function loop(now: number) {
  const delta = now - lastTime; lastTime = now;
  updateCameraMask(now);
  sim.step(delta < 24 ? 2 : 1);
  renderField();
  dragEl.textContent = sim.drag.toFixed(3);
  liftEl.textContent = `${sim.lift >= 0 ? '+' : ''}${sim.lift.toFixed(3)}`;
  history.push(sim.drag); if (history.length > 180) history.shift(); drawChart();
  if (captureStart) {
    const elapsed = (now - captureStart) / 1000; captureSamples.push({ drag: sim.drag, lift: sim.lift });
    document.querySelector('#countdown strong')!.textContent = Math.max(0, 5 - elapsed).toFixed(1);
    if (elapsed >= 5) finishCapture();
  }
  frameCount++;
  if (now - fpsTime > 1000) { fpsEl.textContent = `${Math.round(frameCount * 1000 / (now - fpsTime))} FPS`; frameCount = 0; fpsTime = now; }
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resizeCanvas); resizeCanvas(); renderLeaderboard(); requestAnimationFrame(loop);
