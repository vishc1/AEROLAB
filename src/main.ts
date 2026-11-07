import './style.css';
import { LBM, type Preset } from './lbm';
import { hsvToRgb, matchesColor, rgbToHsv } from './color';
import { mapCameraYToTunnel } from './tracking';

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
          <div class="scale"><b>↺ BLUE</b><label>VORTICITY / SWIRL</label><b>RED ↻</b></div>
          <div class="draw-hint" id="drawHint">DRAW A SHAPE · RIGHT-DRAG TO ERASE</div>
          <div class="camera-panel" id="cameraPanel" hidden>
            <div class="camera-head"><span><i></i> COLOR LAB</span><b id="cameraState">OFFLINE</b></div>
            <div class="camera-feed" id="cameraFeed" title="Sample a color from the live camera">
              <video id="video" autoplay playsinline muted></video>
              <canvas id="maskPreview"></canvas>
              <span class="sample-reticle"><i></i><b>HOLD COLOR HERE</b></span>
              <div class="feed-prompt" id="feedPrompt">Start the camera to calibrate</div>
            </div>
            <div class="calibration">
              <label>What should become solid?
                <select id="detectMode"><option value="object">The color I select</option><option value="backdrop">Everything except this color</option></select>
              </label>
              <div class="color-row">
                <label class="color-well" title="Choose a color"><input id="keyColor" type="color" value="#ef6b4a"><span id="colorHex">#EF6B4A</span></label>
                <button id="pickColorBtn"><span>⌖</span> Sample center</button>
              </div>
              <label class="tolerance-label"><span>Color range <b id="toleranceValue">28</b></span><input id="tolerance" type="range" min="8" max="100" value="28"></label>
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
      <div class="steps"><article><span>01</span><h3>Make a silhouette</h3><p>Draw with your mouse or use a webcam against a clean backdrop.</p></article><article><span>02</span><h3>Move the air</h3><p>A D2Q9 lattice Boltzmann solver updates 36,000 fluid cells in real time.</p></article><article><span>03</span><h3>Measure the force</h3><p>Momentum exchange estimates drag and lift, then averages out the wobble.</p></article></div>
    </section>
  </main>
  <dialog id="aboutDialog"><button id="closeAbout" aria-label="Close">×</button><p class="eyebrow">About the model</p><h2>A tiny, honest wind tunnel.</h2><p>Slipstream uses a two-dimensional lattice Boltzmann simulation. It captures useful relative behavior—bluff shapes create broad wakes, streamlined shapes reduce drag, and angled surfaces generate lift.</p><p>It does not predict full-scale, three-dimensional aerodynamics. Treat the numbers as a fair design game, not engineering certification.</p></dialog>
  <footer><span>SLIPSTREAM / EXPERIMENT 001</span><span>BUILD WITH YOUR HANDS. LEARN BY FEEL.</span></footer>
`;

const sim = new LBM(300, 120);
const canvas = document.querySelector<HTMLCanvasElement>('#tunnel')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
const fieldCanvas = document.createElement('canvas');
fieldCanvas.width = sim.width; fieldCanvas.height = sim.height;
const fieldCtx = fieldCanvas.getContext('2d')!;
const image = fieldCtx.createImageData(sim.width, sim.height);
const smokeCanvas = document.createElement('canvas');
smokeCanvas.width = sim.width; smokeCanvas.height = sim.height;
const smokeCtx = smokeCanvas.getContext('2d')!;
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
let maskUsable = false;
let validMaskFrames = 0;
let lastValidMaskAt = 0;
let objectTracked = false;
let trackedCoverage = 0;
let trackedTunnelCenterY = sim.height * .5;
const maskConfidence = new Float32Array(sim.size);
let captureStart = 0;
let captureSamples: { drag: number; lift: number }[] = [];
let frameCount = 0;
let fpsTime = performance.now();
let lastTime = performance.now();
let shownRecoveries = 0;

for (let i = 0; i < 360; i++) particles.push(spawnParticle(Math.random() * sim.width));

function spawnParticle(x = 2): Particle {
  const lanes = Math.max(1, Math.floor((sim.height - 16) / 6));
  const y = 8 + Math.floor(Math.random() * lanes) * 6 + (Math.random() - .5) * .7;
  return { x, y, px: x, py: y, age: Math.random() * 260 };
}

function colorMap(value: number, vorticity: number) {
  const flow = Math.max(0, Math.min(1, value / .14));
  const swirl = Math.max(-1, Math.min(1, vorticity / .009));
  const intensity = Math.pow(Math.abs(swirl), .7);
  let r = 4 + flow * 8, g = 12 + flow * 22, b = 18 + flow * 26;
  if (swirl > 0) { r += 236 * intensity; g += 66 * intensity; b += 14 * intensity; }
  else { r += 14 * intensity; g += 88 * intensity; b += 230 * intensity; }
  return [Math.min(255, Math.round(r)), Math.min(255, Math.round(g)), Math.min(255, Math.round(b))];
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
  smokeCtx.globalCompositeOperation = 'destination-out'; smokeCtx.fillStyle = 'rgba(0,0,0,.045)'; smokeCtx.fillRect(0, 0, sim.width, sim.height);
  smokeCtx.globalCompositeOperation = 'source-over'; smokeCtx.lineWidth = .52;
  for (const p of particles) {
    p.px = p.x; p.py = p.y;
    const [vx, vy] = sim.sampleVelocity(p.x, p.y);
    p.x += vx * 8.5; p.y += vy * 8.5; p.age++;
    const ix = Math.round(p.x), iy = Math.round(p.y);
    if (p.x >= sim.width - 2 || p.y < 2 || p.y > sim.height - 2 || p.age > 420 || sim.obstacle[ix + iy * sim.width]) Object.assign(p, spawnParticle());
    smokeCtx.strokeStyle = `rgba(203,255,230,${.16 + (p.age % 30) / 115})`;
    smokeCtx.beginPath(); smokeCtx.moveTo(p.px, p.py); smokeCtx.lineTo(p.x, p.y); smokeCtx.stroke();
  }
  ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .92; ctx.drawImage(smokeCanvas, 0, 0, canvas.width, canvas.height); ctx.restore();
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
  if (mode === 'camera') { sim.reset('clear'); void startCamera(); }
  else if (cameraStream) stopCamera();
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
function resetColorTracking() { maskConfidence.fill(0); maskUsable = false; validMaskFrames = 0; lastValidMaskAt = 0; }
function clearCameraObject(message = 'No matching object—tunnel cleared') {
  if (objectTracked) { sim.reset('clear'); smokeCtx.clearRect(0, 0, smokeCanvas.width, smokeCanvas.height); }
  objectTracked = false; trackedCoverage = 0; trackedTunnelCenterY = sim.height * .5; validMaskFrames = 0; maskUsable = false;
  maskCtx.clearRect(0, 0, maskPreview.width, maskPreview.height);
  if (cameraStream) { document.querySelector('#cameraState')!.textContent = 'SEARCHING'; setFeedPrompt(message); }
}
function setSelectedColor(r: number, g: number, b: number) {
  selectedColor = { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
  const hex = `#${[selectedColor.r, selectedColor.g, selectedColor.b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  keyColor.value = hex;
  document.querySelector('#colorHex')!.textContent = hex.toUpperCase();
  resetColorTracking();
}

function drawVideoFrame() {
  const targetWidth = 240, targetHeight = 160, sourceWidth = video.videoWidth || 640, sourceHeight = video.videoHeight || 480;
  const targetRatio = targetWidth / targetHeight, sourceRatio = sourceWidth / sourceHeight;
  let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
  if (sourceRatio > targetRatio) { sw = sourceHeight * targetRatio; sx = (sourceWidth - sw) / 2; }
  else { sh = sourceWidth / targetRatio; sy = (sourceHeight - sh) / 2; }
  captureCtx.clearRect(0, 0, targetWidth, targetHeight);
  captureCtx.save(); captureCtx.scale(-1, 1); captureCtx.drawImage(video, sx, sy, sw, sh, -targetWidth, 0, targetWidth, targetHeight); captureCtx.restore();
}

function colorName(h: number, saturation: number) {
  if (saturation < .12) return 'neutral';
  if (h < 18 || h >= 345) return 'red'; if (h < 45) return 'orange'; if (h < 70) return 'yellow';
  if (h < 165) return 'green'; if (h < 195) return 'cyan'; if (h < 255) return 'blue'; if (h < 295) return 'purple'; return 'pink';
}

function sampleColorAt(x: number, y: number) {
  if (!cameraStream || video.readyState < 2) { setFeedPrompt('Start the camera and wait for the live view'); return; }
  drawVideoFrame();
  const radius = 7, left = Math.max(0, x - radius), top = Math.max(0, y - radius), width = Math.min(radius * 2 + 1, 240 - left), height = Math.min(radius * 2 + 1, 160 - top);
  const data = captureCtx.getImageData(left, top, width, height).data;
  const pixels: Array<{ r: number; g: number; b: number; h: number; s: number; v: number }> = [];
  for (let p = 0; p < data.length; p += 4) { const hsv = rgbToHsv(data[p], data[p + 1], data[p + 2]); pixels.push({ r: data[p], g: data[p + 1], b: data[p + 2], ...hsv }); }
  const colorful = pixels.filter(pixel => pixel.s > .18 && pixel.v > .06);
  let red: number, green: number, blue: number;
  if (colorful.length > pixels.length * .2) {
    let sin = 0, cos = 0, saturation = 0, value = 0, weight = 0;
    for (const pixel of colorful) { const w = pixel.s * pixel.s; sin += Math.sin(pixel.h * Math.PI / 180) * w; cos += Math.cos(pixel.h * Math.PI / 180) * w; saturation += pixel.s * w; value += pixel.v * w; weight += w; }
    const hue = (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360; [red, green, blue] = hsvToRgb(hue, saturation / weight, value / weight);
  } else {
    const channels = [pixels.map(p => p.r), pixels.map(p => p.g), pixels.map(p => p.b)]; channels.forEach(channel => channel.sort((a, b) => a - b));
    [red, green, blue] = channels.map(channel => channel[Math.floor(channel.length / 2)]);
  }
  setSelectedColor(red, green, blue);
  const selected = rgbToHsv(red, green, blue); setFeedPrompt(`${colorName(selected.h, selected.s).toUpperCase()} sampled—lime overlay is the isolated phone`);
  cameraFeed.classList.remove('sampled'); void cameraFeed.offsetWidth; cameraFeed.classList.add('sampled');
  setTimeout(() => cameraFeed.classList.remove('sampled'), 700);
}

async function startCamera() {
  if (cameraStream) return;
  cameraBtn.textContent = 'Starting…'; document.querySelector('#cameraState')!.textContent = 'CONNECTING'; setFeedPrompt('Requesting camera access…');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    video.srcObject = cameraStream; cameraBtn.textContent = 'Stop camera'; freezeBtn.disabled = false; cameraFrozen = false;
    document.querySelector('#cameraState')!.textContent = 'LIVE'; setFeedPrompt('Hold the phone in the target, then press “Sample center”');
  } catch { cameraBtn.textContent = 'Camera blocked — try again'; setFeedPrompt('Allow camera access, then try again'); }
}
function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null; video.srcObject = null; cameraBtn.textContent = 'Start camera'; freezeBtn.disabled = true;
  clearCameraObject();
  document.querySelector('#cameraState')!.textContent = 'OFFLINE'; setFeedPrompt('Camera stopped—select Camera to restart');
  maskStatus.dataset.state = 'idle'; maskStatus.querySelector('span')!.textContent = 'Waiting for camera';
}
cameraBtn.addEventListener('click', () => { if (cameraStream) stopCamera(); else void startCamera(); });
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
  sampleColorAt(120, 80);
});
cameraFeed.addEventListener('click', event => {
  if (!cameraStream || video.readyState < 2) return;
  const rect = cameraFeed.getBoundingClientRect();
  const x = Math.max(0, Math.min(239, Math.floor((event.clientX - rect.left) / rect.width * 240)));
  const y = Math.max(0, Math.min(159, Math.floor((event.clientY - rect.top) / rect.height * 160)));
  sampleColorAt(x, y);
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

function fillSilhouetteHoles(mask: Uint8Array) {
  const outside = new Uint8Array(sim.size), queue = new Int32Array(sim.size); let head = 0, tail = 0;
  const add = (i: number) => { if (i >= 0 && i < sim.size && !mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < sim.width; x++) { add(x); add(x + (sim.height - 1) * sim.width); }
  for (let y = 0; y < sim.height; y++) { add(y * sim.width); add(sim.width - 1 + y * sim.width); }
  while (head < tail) {
    const i = queue[head++], x = i % sim.width;
    if (x > 0) add(i - 1); if (x < sim.width - 1) add(i + 1); add(i - sim.width); add(i + sim.width);
  }
  const filled = mask.slice(); for (let i = 0; i < sim.size; i++) if (!mask[i] && !outside[i]) filled[i] = 1;
  return filled;
}

function fitMaskToTunnel(mask: Uint8Array) {
  let minX = sim.width, minY = sim.height, maxX = -1, maxY = -1;
  for (let y = 0; y < sim.height; y++) for (let x = 0; x < sim.width; x++) if (mask[x + y * sim.width]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const fitted = new Uint8Array(sim.size);
  if (maxX < minX || maxY < minY) return fitted;
  const sourceWidth = maxX - minX + 1, sourceHeight = maxY - minY + 1;
  const scale = Math.min((sim.height * .25) / sourceHeight, (sim.width * .22) / sourceWidth);
  const targetWidth = Math.max(2, Math.round(sourceWidth * scale)), targetHeight = Math.max(2, Math.round(sourceHeight * scale));
  const sourceCenterY = (minY + maxY) * .5;
  const mappedCenterY = mapCameraYToTunnel(sourceCenterY, sim.height, targetHeight, sim.height, 10);
  trackedTunnelCenterY = objectTracked ? trackedTunnelCenterY * .65 + mappedCenterY * .35 : mappedCenterY;
  const left = Math.round(sim.width * .27 - targetWidth / 2), top = Math.round(trackedTunnelCenterY - targetHeight / 2);
  for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
    const sourceX = minX + Math.min(sourceWidth - 1, Math.floor(x / targetWidth * sourceWidth));
    const sourceY = minY + Math.min(sourceHeight - 1, Math.floor(y / targetHeight * sourceHeight));
    if (mask[sourceX + sourceY * sim.width]) fitted[left + x + (top + y) * sim.width] = 1;
  }
  return fitted;
}

function updateMaskQuality(mask: Uint8Array) {
  let count = 0, edge = 0;
  for (let y = 2; y < sim.height - 2; y++) for (let x = 14; x < sim.width - 18; x++) if (mask[x + y * sim.width]) { count++; if (x < 19 || x > sim.width - 24 || y < 7 || y > sim.height - 8) edge++; }
  const coverageValue = count / ((sim.width - 32) * (sim.height - 4));
  document.querySelector('#coverage')!.textContent = `${Math.round(coverageValue * 100)}%`;
  let state = 'good', message = 'Outline ready';
  if (coverageValue < .008) { state = 'bad'; message = 'No stable object found'; }
  else if (coverageValue > .52) { state = 'bad'; message = 'Too much selected—lower color range'; }
  else if (edge / Math.max(1, count) > .18) { state = 'warn'; message = 'Selection touches edge—reframe it'; }
  else if (coverageValue < .02) { state = 'warn'; message = 'Small object—move closer for accuracy'; }
  maskUsable = state !== 'bad'; maskStatus.dataset.state = state; maskStatus.querySelector('span')!.textContent = message;
  return { usable: maskUsable, coverage: coverageValue };
}

function updateCameraMask(now: number) {
  if (!cameraStream || cameraFrozen || video.readyState < 2 || now - lastMaskUpdate < 100) return;
  lastMaskUpdate = now; maskPreview.width = 240; maskPreview.height = 160;
  drawVideoFrame();
  const frame = captureCtx.getImageData(0, 0, 240, 160); const d = frame.data;
  const raw = new Uint8Array(sim.size); const threshold = Number(tolerance.value); const selectingObject = detectMode.value === 'object'; const sampleHsv = rgbToHsv(selectedColor.r, selectedColor.g, selectedColor.b);
  for (let y = 0; y < sim.height; y++) for (let x = 0; x < sim.width; x++) {
    const videoX = Math.min(239, Math.floor(x / sim.width * 240)), videoY = Math.min(159, Math.floor(y / sim.height * 160));
    const p = (videoX + videoY * 240) * 4, r = d[p], g = d[p + 1], b = d[p + 2];
    const colorMatch = matchesColor(r, g, b, selectedColor, threshold, sampleHsv); const foreground = selectingObject ? colorMatch : !colorMatch;
    if (foreground && x > 14 && x < sim.width - 18 && y > 3 && y < sim.height - 4) raw[x + y * sim.width] = 1;
  }
  const stable = new Uint8Array(sim.size);
  for (let i = 0; i < sim.size; i++) { maskConfidence[i] = maskConfidence[i] * .68 + raw[i] * .32; stable[i] = maskConfidence[i] > .46 ? 1 : 0; }
  const smooth = new Uint8Array(sim.size);
  for (let y = 2; y < sim.height - 2; y++) for (let x = 15; x < sim.width - 18; x++) {
    let n = 0; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) n += stable[x + ox + (y + oy) * sim.width];
    smooth[x + y * sim.width] = n >= 4 ? 1 : 0;
  }
  const clean = fillSilhouetteHoles(keepLargestComponent(smooth));
  const quality = updateMaskQuality(clean);
  const sizeConsistent = !objectTracked || quality.coverage >= trackedCoverage * .4;
  const validCandidate = quality.usable && sizeConsistent;
  if (validCandidate) {
    validMaskFrames++;
    if (validMaskFrames >= 3) {
      sim.setMask(fitMaskToTunnel(clean));
      trackedCoverage = objectTracked ? trackedCoverage * .8 + quality.coverage * .2 : quality.coverage;
      objectTracked = true; lastValidMaskAt = now;
      document.querySelector('#cameraState')!.textContent = 'TRACKING';
      setFeedPrompt('Object isolated—move it up or down, then freeze');
    }
  } else {
    validMaskFrames = 0;
    if (!sizeConsistent) { maskStatus.dataset.state = 'bad'; maskStatus.querySelector('span')!.textContent = 'Object lost—ignoring smaller color noise'; }
    if (objectTracked && now - lastValidMaskAt > 450) clearCameraObject();
    else if (!objectTracked) document.querySelector('#cameraState')!.textContent = 'SEARCHING';
  }
  const previewMask = validCandidate ? clean : new Uint8Array(sim.size);
  const overlay = maskCtx.createImageData(240, 160);
  for (let py = 0; py < 160; py++) for (let px = 0; px < 240; px++) {
    const gx = Math.min(sim.width - 1, Math.floor(px / 240 * sim.width)), gy = Math.min(sim.height - 1, Math.floor(py / 160 * sim.height)); const on = previewMask[gx + gy * sim.width]; const p = (px + py * 240) * 4;
    if (on) { overlay.data[p] = 239; overlay.data[p + 1] = 255; overlay.data[p + 2] = 87; overlay.data[p + 3] = 178; }
  }
  maskCtx.putImageData(overlay, 0, 0);
}

function efficiency(drag: number, lift: number) { return Number.isFinite(drag) && Number.isFinite(lift) ? Math.max(0, Math.min(100, 100 - drag * 24 + Math.min(8, Math.abs(lift) * 3))) : 0; }
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
  const stable = captureSamples.slice(Math.floor(captureSamples.length * .35)).filter(sample => Number.isFinite(sample.drag) && Number.isFinite(sample.lift));
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
  const safeDrag = Number.isFinite(sim.drag) ? sim.drag : 0, safeLift = Number.isFinite(sim.lift) ? sim.lift : 0;
  dragEl.textContent = safeDrag.toFixed(3);
  liftEl.textContent = `${safeLift >= 0 ? '+' : ''}${safeLift.toFixed(3)}`;
  history.push(safeDrag); if (history.length > 180) history.shift(); drawChart();
  if (captureStart) {
    const elapsed = (now - captureStart) / 1000; captureSamples.push({ drag: safeDrag, lift: safeLift });
    document.querySelector('#countdown strong')!.textContent = Math.max(0, 5 - elapsed).toFixed(1);
    if (elapsed >= 5) finishCapture();
  }
  frameCount++;
  if (sim.recoveries > shownRecoveries) { shownRecoveries = sim.recoveries; fpsEl.textContent = 'FIELD RECOVERED'; }
  else if (now - fpsTime > 1000) { fpsEl.textContent = `${Math.round(frameCount * 1000 / (now - fpsTime))} FPS`; frameCount = 0; fpsTime = now; }
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resizeCanvas); resizeCanvas(); renderLeaderboard(); requestAnimationFrame(loop);
