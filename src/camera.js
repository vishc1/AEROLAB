/**
 * Camera silhouette pipeline (ported from Slipstream).
 * Click a colour in the live view -> hue-aware mask -> temporal smoothing,
 * largest component, hole fill -> fitted into the tunnel at 25% height.
 */
const VW = 240;
const VH = 160;

function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max ? delta / max : 0, v: max };
}

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb = [c, x, 0];
  if (h >= 60 && h < 120) rgb = [x, c, 0];
  else if (h >= 120 && h < 180) rgb = [0, c, x];
  else if (h >= 180 && h < 240) rgb = [0, x, c];
  else if (h >= 240 && h < 300) rgb = [x, 0, c];
  else if (h >= 300) rgb = [c, 0, x];
  return rgb.map((channel) => Math.round((channel + m) * 255));
}

function colorName(h, s) {
  if (s < 0.12) return 'neutral';
  if (h < 18 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 295) return 'purple';
  return 'pink';
}

export class CameraTracker {
  /**
   * @param {object} opts  { mask: MaskEditor, onMask(): called when mask changes }
   */
  constructor({ mask, onMask }) {
    this.mask = mask;
    this.onMask = onMask;
    this.$ = (id) => document.getElementById(id);
    this.video = this.$('cam-video');
    this.preview = this.$('cam-mask');
    this.previewCtx = this.preview.getContext('2d');
    this.feed = this.$('cam-feed');
    this.capture = document.createElement('canvas');
    this.capture.width = VW;
    this.capture.height = VH;
    this.captureCtx = this.capture.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.frozen = false;
    this.usable = false;
    this.selected = { r: 239, g: 107, b: 74 };
    this.lastUpdate = 0;
    this.confidence = null;
    this.bindEvents();
  }

  get active() {
    return !!this.stream;
  }

  setPrompt(message) {
    this.$('cam-prompt').textContent = message;
  }

  resetTracking() {
    this.confidence = null;
    this.usable = false;
  }

  setColor(r, g, b) {
    this.selected = { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    const hex = `#${[this.selected.r, this.selected.g, this.selected.b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')}`;
    this.$('cam-key').value = hex;
    this.$('cam-hex').textContent = hex.toUpperCase();
    this.resetTracking();
  }

  drawFrame() {
    const v = this.video;
    const sw0 = v.videoWidth || 640;
    const sh0 = v.videoHeight || 480;
    const target = VW / VH;
    let sx = 0;
    let sy = 0;
    let sw = sw0;
    let sh = sh0;
    if (sw0 / sh0 > target) {
      sw = sh0 * target;
      sx = (sw0 - sw) / 2;
    } else {
      sh = sw0 / target;
      sy = (sh0 - sh) / 2;
    }
    const ctx = this.captureCtx;
    ctx.clearRect(0, 0, VW, VH);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, sw, sh, -VW, 0, VW, VH);
    ctx.restore();
  }

  sampleAt(x, y) {
    if (!this.stream || this.video.readyState < 2) {
      this.setPrompt('Start the camera and wait for the live view');
      return;
    }
    this.drawFrame();
    const radius = 7;
    const left = Math.max(0, x - radius);
    const top = Math.max(0, y - radius);
    const width = Math.min(radius * 2 + 1, VW - left);
    const height = Math.min(radius * 2 + 1, VH - top);
    const data = this.captureCtx.getImageData(left, top, width, height).data;
    const pixels = [];
    for (let p = 0; p < data.length; p += 4) {
      pixels.push({ r: data[p], g: data[p + 1], b: data[p + 2], ...rgbToHsv(data[p], data[p + 1], data[p + 2]) });
    }
    const colorful = pixels.filter((px) => px.s > 0.18 && px.v > 0.06);
    let rgb;
    if (colorful.length > pixels.length * 0.2) {
      let sin = 0;
      let cos = 0;
      let sat = 0;
      let val = 0;
      let weight = 0;
      for (const px of colorful) {
        const w = px.s * px.s;
        sin += Math.sin((px.h * Math.PI) / 180) * w;
        cos += Math.cos((px.h * Math.PI) / 180) * w;
        sat += px.s * w;
        val += px.v * w;
        weight += w;
      }
      const hue = (((Math.atan2(sin, cos) * 180) / Math.PI) + 360) % 360;
      rgb = hsvToRgb(hue, sat / weight, val / weight);
    } else {
      const med = (key) => {
        const a = pixels.map((px) => px[key]).sort((m, n) => m - n);
        return a[Math.floor(a.length / 2)];
      };
      rgb = [med('r'), med('g'), med('b')];
    }
    this.setColor(...rgb);
    const hsv = rgbToHsv(...rgb);
    this.setPrompt(`${colorName(hsv.h, hsv.s).toUpperCase()} sampled — lime overlay is the isolated object`);
  }

  async toggleCamera() {
    const btn = this.$('cam-start');
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      btn.textContent = 'Start camera';
      this.$('cam-freeze').disabled = true;
      this.$('cam-state').textContent = 'OFFLINE';
      this.setPrompt('Start the camera to calibrate');
      this.setStatus('idle', 'Waiting for camera');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      this.video.srcObject = this.stream;
      btn.textContent = 'Stop camera';
      this.$('cam-freeze').disabled = false;
      this.frozen = false;
      this.$('cam-state').textContent = 'LIVE';
      this.setPrompt('Hold an object in view, then click it (or press Sample center)');
    } catch {
      btn.textContent = 'Camera blocked — try again';
      this.setPrompt('Allow camera access, then try again');
    }
  }

  setStatus(state, message) {
    const el = this.$('cam-status');
    el.dataset.state = state;
    el.querySelector('span').textContent = message;
  }

  setFrozen(frozen) {
    this.frozen = frozen;
    const btn = this.$('cam-freeze');
    btn.textContent = frozen ? 'Shape frozen ✓' : 'Freeze shape';
    btn.classList.toggle('is-frozen', frozen);
    this.$('cam-state').textContent = frozen ? 'FROZEN' : this.stream ? 'LIVE' : 'OFFLINE';
    this.setPrompt(frozen ? 'Shape locked — ready for a test run' : 'Live outline updating');
  }

  /** Called by the benchmark: refuse to test an unready camera outline. */
  prepareForTest() {
    if (!this.stream) {
      this.setPrompt('Start the camera before running a test');
      return false;
    }
    if (!this.frozen && !this.usable) {
      this.setPrompt('Finish calibration — the outline is not ready yet');
      return false;
    }
    if (!this.frozen) this.setFrozen(true);
    return true;
  }

  bindEvents() {
    const $ = this.$;
    $('cam-start').addEventListener('click', () => this.toggleCamera());
    $('cam-freeze').addEventListener('click', () => {
      if (!this.frozen && !this.usable) {
        this.setPrompt('Tune the colour until the outline says ready');
        return;
      }
      this.setFrozen(!this.frozen);
    });
    $('cam-key').addEventListener('input', () => {
      const v = $('cam-key').value;
      this.setColor(parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16));
    });
    $('cam-detect').addEventListener('change', () => {
      this.resetTracking();
      this.setPrompt($('cam-detect').value === 'object' ? 'Pick the object’s strongest colour' : 'Pick the clean backdrop colour');
    });
    $('cam-tol').addEventListener('input', () => {
      $('cam-tol-value').textContent = $('cam-tol').value;
      this.resetTracking();
    });
    $('cam-center').addEventListener('click', () => {
      if (!this.stream) this.setPrompt('Start the camera first');
      else this.sampleAt(VW / 2, VH / 2);
    });
    this.feed.addEventListener('click', (event) => {
      if (!this.stream || this.video.readyState < 2) return;
      const rect = this.feed.getBoundingClientRect();
      const x = Math.max(0, Math.min(VW - 1, Math.floor(((event.clientX - rect.left) / rect.width) * VW)));
      const y = Math.max(0, Math.min(VH - 1, Math.floor(((event.clientY - rect.top) / rect.height) * VH)));
      this.sampleAt(x, y);
    });
  }

  matches(r, g, b, range, sample) {
    if (sample.s > 0.18) {
      const px = rgbToHsv(r, g, b);
      const raw = Math.abs(px.h - sample.h);
      const gap = Math.min(raw, 360 - raw);
      return gap <= 4 + range * 0.31 && px.s >= Math.max(0.1, sample.s * 0.24) && px.v > 0.035;
    }
    const d = Math.sqrt(0.3 * (r - this.selected.r) ** 2 + 0.59 * (g - this.selected.g) ** 2 + 0.11 * (b - this.selected.b) ** 2);
    return d <= range;
  }

  /** Per-frame. Returns true if the obstacle mask was replaced. */
  update(now) {
    if (!this.stream || this.frozen || this.video.readyState < 2 || now - this.lastUpdate < 100) return false;
    this.lastUpdate = now;

    const W = this.mask.width;
    const H = this.mask.height;
    const size = W * H;
    if (!this.confidence || this.confidence.length !== size) this.confidence = new Float32Array(size);

    this.drawFrame();
    const d = this.captureCtx.getImageData(0, 0, VW, VH).data;
    const threshold = Number(this.$('cam-tol').value);
    const object = this.$('cam-detect').value === 'object';
    const sampleHsv = rgbToHsv(this.selected.r, this.selected.g, this.selected.b);
    const padL = Math.round(W * 0.05);
    const padR = Math.round(W * 0.06);
    const padY = Math.round(H * 0.03);

    const raw = new Uint8Array(size);
    for (let y = 0; y < H; y += 1) {
      const vy = Math.min(VH - 1, Math.floor((y / H) * VH));
      for (let x = 0; x < W; x += 1) {
        const vx = Math.min(VW - 1, Math.floor((x / W) * VW));
        const p = (vx + vy * VW) * 4;
        const match = this.matches(d[p], d[p + 1], d[p + 2], threshold, sampleHsv);
        if ((object ? match : !match) && x > padL && x < W - padR && y > padY && y < H - padY) raw[x + y * W] = 1;
      }
    }

    const stable = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      this.confidence[i] = this.confidence[i] * 0.68 + raw[i] * 0.32;
      stable[i] = this.confidence[i] > 0.46 ? 1 : 0;
    }
    const smooth = new Uint8Array(size);
    for (let y = 2; y < H - 2; y += 1) {
      for (let x = 2; x < W - 2; x += 1) {
        let n = 0;
        for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) n += stable[x + ox + (y + oy) * W];
        smooth[x + y * W] = n >= 4 ? 1 : 0;
      }
    }
    const clean = this.fillHoles(this.largest(smooth, W, H), W, H);
    this.updateQuality(clean, W, H);
    this.mask.setFromBinary(this.fit(clean, W, H));
    this.onMask?.();

    const pw = (this.preview.width = VW);
    const ph = (this.preview.height = VH);
    const overlay = this.previewCtx.createImageData(pw, ph);
    for (let py = 0; py < ph; py += 1) {
      for (let px = 0; px < pw; px += 1) {
        const gx = Math.min(W - 1, Math.floor((px / pw) * W));
        const gy = Math.min(H - 1, Math.floor((py / ph) * H));
        if (clean[gx + gy * W]) {
          const p = (px + py * pw) * 4;
          overlay.data[p] = 200;
          overlay.data[p + 1] = 255;
          overlay.data[p + 2] = 90;
          overlay.data[p + 3] = 170;
        }
      }
    }
    this.previewCtx.putImageData(overlay, 0, 0);
    return true;
  }

  largest(mask, W, H) {
    const size = W * H;
    const labels = new Int32Array(size);
    const queue = new Int32Array(size);
    const sizes = [0];
    let label = 0;
    for (let start = 0; start < size; start += 1) {
      if (!mask[start] || labels[start]) continue;
      label += 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      labels[start] = label;
      while (head < tail) {
        const i = queue[head++];
        const x = i % W;
        if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = label; queue[tail++] = i - 1; }
        if (x < W - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = label; queue[tail++] = i + 1; }
        if (i - W >= 0 && mask[i - W] && !labels[i - W]) { labels[i - W] = label; queue[tail++] = i - W; }
        if (i + W < size && mask[i + W] && !labels[i + W]) { labels[i + W] = label; queue[tail++] = i + W; }
      }
      sizes[label] = tail;
    }
    let winner = 0;
    for (let i = 1; i < sizes.length; i += 1) if (sizes[i] > (sizes[winner] || 0)) winner = i;
    const out = new Uint8Array(size);
    if ((sizes[winner] || 0) < 12) return out;
    for (let i = 0; i < size; i += 1) if (labels[i] === winner) out[i] = 1;
    return out;
  }

  fillHoles(mask, W, H) {
    const size = W * H;
    const outside = new Uint8Array(size);
    const queue = new Int32Array(size);
    let head = 0;
    let tail = 0;
    const add = (i) => {
      if (i >= 0 && i < size && !mask[i] && !outside[i]) { outside[i] = 1; queue[tail++] = i; }
    };
    for (let x = 0; x < W; x += 1) { add(x); add(x + (H - 1) * W); }
    for (let y = 0; y < H; y += 1) { add(y * W); add(W - 1 + y * W); }
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      if (x > 0) add(i - 1);
      if (x < W - 1) add(i + 1);
      add(i - W);
      add(i + W);
    }
    const filled = mask.slice();
    for (let i = 0; i < size; i += 1) if (!mask[i] && !outside[i]) filled[i] = 1;
    return filled;
  }

  /** Normalise to 25% of tunnel height, centred at 27% along the tunnel. */
  fit(mask, W, H) {
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (mask[x + y * W]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const out = new Uint8Array(W * H);
    if (maxX < minX) return out;
    const sw = maxX - minX + 1;
    const sh = maxY - minY + 1;
    const scale = Math.min((H * 0.25) / sh, (W * 0.22) / sw);
    const tw = Math.max(2, Math.round(sw * scale));
    const th = Math.max(2, Math.round(sh * scale));
    const left = Math.round(W * 0.27 - tw / 2);
    const top = Math.round(H * 0.5 - th / 2);
    for (let y = 0; y < th; y += 1) {
      for (let x = 0; x < tw; x += 1) {
        const sx = minX + Math.min(sw - 1, Math.floor((x / tw) * sw));
        const sy = minY + Math.min(sh - 1, Math.floor((y / th) * sh));
        if (mask[sx + sy * W]) out[left + x + (top + y) * W] = 1;
      }
    }
    return out;
  }

  updateQuality(mask, W, H) {
    let count = 0;
    let edge = 0;
    for (let y = 2; y < H - 2; y += 1) {
      for (let x = 2; x < W - 2; x += 1) {
        if (!mask[x + y * W]) continue;
        count += 1;
        if (x < W * 0.08 || x > W * 0.92 || y < H * 0.06 || y > H * 0.94) edge += 1;
      }
    }
    const coverage = count / (W * H);
    this.$('cam-coverage').textContent = `${Math.round(coverage * 100)}%`;
    let state = 'good';
    let message = 'Outline ready';
    if (coverage < 0.004) { state = 'bad'; message = 'No object found — raise tolerance'; }
    else if (coverage > 0.52) { state = 'bad'; message = 'Too much selected — lower tolerance'; }
    else if (edge / Math.max(1, count) > 0.18) { state = 'warn'; message = 'Selection touches edge — reframe it'; }
    else if (coverage < 0.018) { state = 'warn'; message = 'Very small object — move closer'; }
    this.usable = state !== 'bad';
    this.setStatus(state, message);
  }
}
