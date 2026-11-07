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
            <div class="camera-head"><span><i></i> COLOR LAB</span><b id="cameraState">OFFLINE</b></div>
            <div class="camera-feed" id="cameraFeed" title="Sample a color from the live camera">
              <video id="video" autoplay playsinline muted></video>
              <canvas id="maskPreview"></canvas>
              <span class="sample-reticle">+</span>
              <div class="feed-prompt" id="feedPrompt">Start the camera to calibrate</div>
            </div>
            <div class="calibration">
              <label>What should become solid?
                <select id="detectMode"><option value="object">The color I select</option><option value="backdrop">Everything except this color</option></select>
              </label>
              <div class="color-row">
                <label class="color-well" title="Choose a color"><input id="keyColor" type="color" value="#ef6b4a"><span id="colorHex">#EF6B4A</span></label>
                <button id="pickColorBtn"><span>⌖</span> Pick from video</button>
              </div>
              <label class="tolerance-label"><span>Color tolerance <b id="toleranceValue">42</b></span><input id="tolerance" type="range" min="8" max="120" value="42"></label>
              <div class="mask-status" id="maskStatus" data-state="idle"><i></i><span>Waiting for camera</span><b id="coverage">0%</b></div>
            </div>
            <div class="camera-steps"><span><b>1</b> Start</span><span><b>2</b> Pick color</span><span><b>3</b> Freeze</span></div>
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
        <div class="camera-controls" hidden><button id="cameraBtn">Start camera</button><span class="camera-help">Pick any object or backdrop color from the live view.</span><button id="freezeBtn" disabled>Freeze shape</button></div>
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
let selectedColor = { r: 239, g: 107, b: 74 };
let pickingColor = false;
let maskUsable = false;
const maskConfidence = new Float32Array(sim.size);
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
  if (mode === 'camera') sim.reset('clear');
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
const maskCtx = maskPreview.getContext('2d')!;
const captureCanvas = document.createElement('canvas');
captureCanvas.width = 240; captureCanvas.height = 160;
const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true })!;
const cameraBtn = document.querySelector<HTMLButtonElement>('#cameraBtn')!;
const freezeBtn = document.querySelector<HTMLButtonElement>('#freezeBtn')!;
const cameraFeed = document.querySelector<HTMLDivElement>('#cameraFeed')!;
const pickColorBtn = document.querySelector<HTMLButtonElement>('#pickColorBtn')!;
const keyColor = document.querySelector<HTMLInputElement>('#keyColor')!;
const detectMode = document.querySelector<HTMLSelectElement>('#detectMode')!;
const tolerance = document.querySelector<HTMLInputElement>('#tolerance')!;
const maskStatus = document.querySelector<HTMLDivElement>('#maskStatus')!;

function setFeedPrompt(message: string) { document.querySelector('#feedPrompt')!.textContent = message; }
function resetColorTracking() { maskConfidence.fill(0); maskUsable = false; }
function setSelectedColor(r: number, g: number, b: number) {
  selectedColor = { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  const hex = `#${[selectedColor.r, selectedColor.g, selectedColor.b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  keyColor.value = hex;
  document.querySelector('#colorHex')!.textContent = hex.toUpperCase();
  resetColorTracking();
}

cameraBtn.addEventListener('click', async () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; cameraBtn.textContent = 'Start camera'; freezeBtn.disabled = true;
    document.querySelector('#cameraState')!.textContent = 'OFFLINE'; setFeedPrompt('Start the camera to calibrate');
    maskStatus.dataset.state = 'idle'; maskStatus.querySelector('span')!.textContent = 'Waiting for camera'; return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = cameraStream; cameraBtn.textContent = 'Stop camera'; freezeBtn.disabled = false; cameraFrozen = false;
    document.querySelector('#cameraState')!.textContent = 'LIVE'; setFeedPrompt('Click “Pick from video,” then click your color');
  } catch { cameraBtn.textContent = 'Camera blocked — try again'; setFeedPrompt('Allow camera access, then try again'); }
});
freezeBtn.addEventListener('click', () => {
  if (!cameraFrozen && !maskUsable) { setFeedPrompt('Tune the color until the outline says ready'); cameraFeed.classList.add('needs-attention'); setTimeout(() => cameraFeed.classList.remove('needs-attention'), 700); return; }
  cameraFrozen = !cameraFrozen; freezeBtn.textContent = cameraFrozen ? 'Shape frozen ✓' : 'Freeze shape'; freezeBtn.classList.toggle('frozen', cameraFrozen);
  document.querySelector('#cameraState')!.textContent = cameraFrozen ? 'FROZEN' : 'LIVE';
  setFeedPrompt(cameraFrozen ? 'Shape locked—ready for a test run' : 'Live outline updating');
});

keyColor.addEventListener('input', () => {
  const value = keyColor.value;
  setSelectedColor(parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16));
});
detectMode.addEventListener('change', () => { resetColorTracking(); setFeedPrompt(detectMode.value === 'object' ? 'Pick the object’s strongest color' : 'Pick the clean backdrop color'); });
tolerance.addEventListener('input', () => { document.querySelector('#toleranceValue')!.textContent = tolerance.value; resetColorTracking(); });
pickColorBtn.addEventListener('click', () => {
  if (!cameraStream) { setFeedPrompt('Start the camera first'); return; }
  pickingColor = !pickingColor; cameraFeed.classList.toggle('sampling', pickingColor); pickColorBtn.classList.toggle('active', pickingColor);
  pickColorBtn.innerHTML = pickingColor ? '<span>⌖</span> Click the video…' : '<span>⌖</span> Pick from video';
  setFeedPrompt(pickingColor ? `Click the ${detectMode.value === 'object' ? 'object' : 'backdrop'} color you want` : 'Live outline updating');
});
cameraFeed.addEventListener('click', event => {
  if (!pickingColor || !cameraStream || video.readyState < 2) return;
  const rect = cameraFeed.getBoundingClientRect();
  const x = Math.max(0, Math.min(239, Math.floor((event.clientX - rect.left) / rect.width * 240)));
  const y = Math.max(0, Math.min(159, Math.floor((event.clientY - rect.top) / rect.height * 160)));
  captureCtx.save(); captureCtx.scale(-1, 1); captureCtx.drawImage(video, -240, 0, 240, 160); captureCtx.restore();
  const sample = captureCtx.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), Math.min(7, 240 - Math.max(0, x - 3)), Math.min(7, 160 - Math.max(0, y - 3))).data;
  const values: number[][] = [[], [], []];
  for (let p = 0; p < sample.length; p += 4) { values[0].push(sample[p]); values[1].push(sample[p + 1]); values[2].push(sample[p + 2]); }
  values.forEach(channel => channel.sort((a, b) => a - b));
  setSelectedColor(values[0][Math.floor(values[0].length / 2)], values[1][Math.floor(values[1].length / 2)], values[2][Math.floor(values[2].length / 2)]);
  pickingColor = false; cameraFeed.classList.remove('sampling'); pickColorBtn.classList.remove('active'); pickColorBtn.innerHTML = '<span>⌖</span> Pick from video'; setFeedPrompt('Color sampled—adjust tolerance if needed');
});

function keepLargestComponent(mask: Uint8Array) {
  const labels = new Int32Array(sim.size); const queue = new Int32Array(sim.size); const sizes = [0]; let label = 0;
  for (let start = 0; start < sim.size; start++) {
    if (!mask[start] || labels[start]) continue;
    label++; let head = 0, tail = 0; queue[tail++] = start; labels[start] = label;
    while (head < tail) {
      const i = queue[head++], x = i % sim.width, y = Math.floor(i / sim.width);
      const neighbors = [i - 1, i + 1, i - sim.width, i + sim.width];
      for (const n of neighbors) if (n >= 0 && n < sim.size && !labels[n] && mask[n] && Math.abs((n % sim.width) - x) + Math.abs(Math.floor(n / sim.width) - y) === 1) { labels[n] = label; queue[tail++] = n; }
    }
    sizes[label] = tail;
  }
  let winner = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > (sizes[winner] || 0)) winner = i;
  const output = new Uint8Array(sim.size); if ((sizes[winner] || 0) < 12) return output;
  for (let i = 0; i < sim.size; i++) if (labels[i] === winner) output[i] = 1;
  return output;
}

function updateMaskQuality(mask: Uint8Array) {
  let count = 0, edge = 0;
  for (let y = 2; y < sim.height - 2; y++) for (let x = 14; x < sim.width - 18; x++) if (mask[x + y * sim.width]) { count++; if (x < 19 || x > sim.width - 24 || y < 7 || y > sim.height - 8) edge++; }
  const coverageValue = count / ((sim.width - 32) * (sim.height - 4));
  document.querySelector('#coverage')!.textContent = `${Math.round(coverageValue * 100)}%`;
  let state = 'good', message = 'Outline ready';
  if (coverageValue < .004) { state = 'bad'; message = 'No object found—raise tolerance'; }
  else if (coverageValue > .52) { state = 'bad'; message = 'Too much selected—lower tolerance'; }
  else if (edge / Math.max(1, count) > .18) { state = 'warn'; message = 'Selection touches edge—reframe it'; }
  else if (coverageValue < .018) { state = 'warn'; message = 'Very small object—move closer'; }
  maskUsable = state !== 'bad'; maskStatus.dataset.state = state; maskStatus.querySelector('span')!.textContent = message;
}

function updateCameraMask(now: number) {
  if (!cameraStream || cameraFrozen || video.readyState < 2 || now - lastMaskUpdate < 100) return;
  lastMaskUpdate = now; maskPreview.width = 240; maskPreview.height = 160;
  captureCtx.save(); captureCtx.scale(-1, 1); captureCtx.drawImage(video, -240, 0, 240, 160); captureCtx.restore();
  const frame = captureCtx.getImageData(0, 0, 240, 160); const d = frame.data;
  const raw = new Uint8Array(sim.size); const threshold = Number(tolerance.value); const selectingObject = detectMode.value === 'object';
  for (let y = 0; y < sim.height; y++) for (let x = 0; x < sim.width; x++) {
    const vy = Math.floor(y / sim.height * 160); const p = (x + vy * 240) * 4; const r = d[p], g = d[p + 1], b = d[p + 2];
    const distance = Math.sqrt(.3 * (r - selectedColor.r) ** 2 + .59 * (g - selectedColor.g) ** 2 + .11 * (b - selectedColor.b) ** 2);
    const foreground = selectingObject ? distance <= threshold : distance > threshold;
    if (foreground && x > 14 && x < sim.width - 18 && y > 3 && y < sim.height - 4) raw[x + y * sim.width] = 1;
  }
  const stable = new Uint8Array(sim.size);
  for (let i = 0; i < sim.size; i++) { maskConfidence[i] = maskConfidence[i] * .68 + raw[i] * .32; stable[i] = maskConfidence[i] > .46 ? 1 : 0; }
  const smooth = new Uint8Array(sim.size);
  for (let y = 2; y < sim.height - 2; y++) for (let x = 15; x < sim.width - 18; x++) {
    let n = 0; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) n += stable[x + ox + (y + oy) * sim.width];
    smooth[x + y * sim.width] = n >= 4 ? 1 : 0;
  }
  const clean = keepLargestComponent(smooth);
  sim.setMask(clean);
  updateMaskQuality(clean);
  const overlay = maskCtx.createImageData(240, 160);
  for (let py = 0; py < 160; py++) for (let px = 0; px < 240; px++) {
    const gy = Math.min(sim.height - 1, Math.floor(py / 160 * sim.height)); const on = clean[px + gy * sim.width]; const p = (px + py * 240) * 4;
    if (on) { overlay.data[p] = 239; overlay.data[p + 1] = 255; overlay.data[p + 2] = 87; overlay.data[p + 3] = 178; }
  }
  maskCtx.putImageData(overlay, 0, 0);
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
  if (mode === 'camera' && !cameraStream) { setFeedPrompt('Start the camera before running a test'); cameraFeed.classList.add('needs-attention'); setTimeout(() => cameraFeed.classList.remove('needs-attention'), 700); return; }
  if (mode === 'camera' && !cameraFrozen && !maskUsable) { setFeedPrompt('Finish calibration—the outline is not ready yet'); cameraFeed.classList.add('needs-attention'); setTimeout(() => cameraFeed.classList.remove('needs-attention'), 700); return; }
  if (cameraStream && !cameraFrozen) { cameraFrozen = true; freezeBtn.textContent = 'Shape frozen ✓'; freezeBtn.classList.add('frozen'); document.querySelector('#cameraState')!.textContent = 'FROZEN'; }
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
