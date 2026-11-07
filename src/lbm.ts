export type Preset = 'circle' | 'card' | 'airfoil' | 'car' | 'clear';

const CX = new Int8Array([0, 1, 0, -1, 0, 1, -1, -1, 1]);
const CY = new Int8Array([0, 0, 1, 0, -1, 1, 1, -1, -1]);
const W = new Float32Array([4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36]);
const OPP = new Int8Array([0, 3, 4, 1, 2, 7, 8, 5, 6]);

export class LBM {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly obstacle: Uint8Array;
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly speed: Float32Array;
  readonly vort: Float32Array;
  readonly inlet = 0.08;
  readonly tau = 0.55;
  private readonly omega = 1 / this.tau;
  private f: Float32Array;
  private next: Float32Array;
  forceX = 0;
  forceY = 0;
  drag = 0;
  lift = 0;
  ticks = 0;
  recoveries = 0;
  lastMaskChanges = 0;
  lastFault = '';

  constructor(width = 300, height = 120) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.obstacle = new Uint8Array(this.size);
    this.ux = new Float32Array(this.size);
    this.uy = new Float32Array(this.size);
    this.speed = new Float32Array(this.size);
    this.vort = new Float32Array(this.size);
    this.f = new Float32Array(this.size * 9);
    this.next = new Float32Array(this.size * 9);
    this.reset('circle');
  }

  reset(preset?: Preset) {
    if (preset) this.setPreset(preset);
    this.initializeField(true);
    this.forceX = this.forceY = this.drag = this.lift = 0;
    this.ticks = 0;
    this.lastFault = '';
  }

  setPreset(preset: Preset) {
    this.obstacle.fill(0);
    if (preset === 'clear') return;
    const scale = this.height / 96;
    const cx = Math.floor(this.width * 0.27);
    const cy = Math.floor(this.height * 0.5);
    for (let y = 8; y < this.height - 8; y++) {
      for (let x = 12; x < this.width - 40; x++) {
        let solid = false;
        if (preset === 'circle') {
          const r = this.height * 0.125;
          solid = (x - cx) ** 2 + (y - cy) ** 2 < r * r;
        } else if (preset === 'card') {
          solid = Math.abs(x - cx) < Math.max(2, 2.2 * scale) && Math.abs(y - cy) < this.height * 0.13;
        } else if (preset === 'airfoil') {
          const chord = 36 * scale, dx = (x - (cx - chord * .4)) / chord;
          if (dx >= 0 && dx <= 1) {
            const thickness = 0.12 * chord * (0.2969 * Math.sqrt(dx) - 0.126 * dx - 0.3516 * dx ** 2 + 0.2843 * dx ** 3 - 0.1015 * dx ** 4) / 0.1;
            const camber = -3.2 * scale * (dx - 0.35);
            solid = Math.abs(y - cy - camber) < Math.max(1.2, thickness);
          }
        } else if (preset === 'car') {
          const nx = (x - cx) / (34 * scale), ny = (y - cy) / (16 * scale);
          solid = nx > -0.8 && nx < 1 && ny > -0.12 && ny < 0.48;
          solid ||= ((nx + 0.15) / 0.55) ** 2 + ((ny + 0.12) / 0.52) ** 2 < 1;
          solid &&= !((((nx + 0.45) / 0.17) ** 2 + ((ny - 0.48) / 0.25) ** 2 < 1) || (((nx - 0.58) / 0.17) ** 2 + ((ny - 0.48) / 0.25) ** 2 < 1));
        }
        if (solid) this.obstacle[x + y * this.width] = 1;
      }
    }
  }

  paint(gridX: number, gridY: number, radius: number, erase = false) {
    const r2 = radius * radius;
    for (let y = Math.max(8, gridY - radius); y <= Math.min(this.height - 9, gridY + radius); y++) {
      for (let x = Math.max(12, gridX - radius); x <= Math.min(this.width - 40, gridX + radius); x++) {
        if ((x - gridX) ** 2 + (y - gridY) ** 2 <= r2) this.obstacle[x + y * this.width] = erase ? 0 : 1;
      }
    }
  }

  setMask(mask: Uint8Array) {
    if (mask.length !== this.obstacle.length) return;
    let changes = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = x + y * this.width;
        const nextSolid = x < 12 || x > this.width - 40 || y < 8 || y > this.height - 9 ? 0 : mask[i];
        if (nextSolid === this.obstacle[i]) continue;
        changes++;
        this.obstacle[i] = nextSolid;
        if (nextSolid) {
          this.ux[i] = this.uy[i] = this.speed[i] = this.vort[i] = 0;
          for (let k = 0; k < 9; k++) { this.f[k * this.size + i] = 0; this.next[k * this.size + i] = 0; }
        } else {
          this.ux[i] = this.uy[i] = this.speed[i] = this.vort[i] = 0;
          for (let k = 0; k < 9; k++) {
            const eq = this.equilibrium(k, 1, 0, 0);
            this.f[k * this.size + i] = eq;
            this.next[k * this.size + i] = eq;
          }
        }
      }
    }
    this.lastMaskChanges = changes;
    if (changes) { this.drag *= .82; this.lift *= .82; }
  }

  step(iterations = 1) {
    for (let iteration = 0; iteration < iterations; iteration++) {
      this.next.fill(0);
      let fx = 0, fy = 0, invalidCells = 0;
      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 0; x < this.width; x++) {
          const i = x + y * this.width;
          if (this.obstacle[i]) continue;
          let rho = 0, momentumX = 0, momentumY = 0, invalid = false;
          for (let k = 0; k < 9; k++) {
            const value = this.f[k * this.size + i];
            if (!Number.isFinite(value)) { invalid = true; break; }
            rho += value; momentumX += value * CX[k]; momentumY += value * CY[k];
          }
          if (!Number.isFinite(rho) || !Number.isFinite(momentumX) || !Number.isFinite(momentumY) || rho < 0.1 || rho > 3) invalid = true;
          let vx = this.inlet, vy = 0;
          if (!invalid) {
            vx = momentumX / rho; vy = momentumY / rho;
            if (!Number.isFinite(vx) || !Number.isFinite(vy) || Math.abs(vx) > .35 || Math.abs(vy) > .35) invalid = true;
          }
          if (invalid) { invalidCells++; rho = 1; vx = this.inlet; vy = 0; }
          const velocity2 = vx * vx + vy * vy;
          for (let k = 0; k < 9; k++) {
            const current = invalid ? this.equilibrium(k, 1, vx, vy) : this.f[k * this.size + i];
            const dot = CX[k] * vx + CY[k] * vy;
            const eq = W[k] * rho * (1 + 3 * dot + 4.5 * dot * dot - 1.5 * velocity2);
            let post = current - this.omega * (current - eq);
            if (!Number.isFinite(post)) { post = this.equilibrium(k, 1, this.inlet, 0); invalidCells++; }
            const tx = x + CX[k];
            let ty = y + CY[k];
            if (ty <= 0) ty = this.height - 2;
            else if (ty >= this.height - 1) ty = 1;
            const target = tx + ty * this.width;
            if (this.obstacle[target]) {
              this.next[OPP[k] * this.size + i] += post;
              fx += 2 * post * CX[k]; fy += 2 * post * CY[k];
            } else if (tx >= 0 && tx < this.width) this.next[k * this.size + target] += post;
          }
        }
      }
      const swap = this.f; this.f = this.next; this.next = swap;
      this.applyBoundaries();
      if (invalidCells > Math.max(8, this.size * .002) || !Number.isFinite(fx) || !Number.isFinite(fy)) {
        this.recoverField(`step ${this.ticks}: ${invalidCells} invalid cells after ${this.lastMaskChanges} mask changes`);
        continue;
      }
      this.forceX = fx; this.forceY = fy;
      const span = Math.max(1, this.objectSpan());
      const normalizedDrag = Math.abs(fx) / span * 18, normalizedLift = -fy / span * 18;
      if (Number.isFinite(normalizedDrag) && Number.isFinite(normalizedLift)) {
        this.drag = this.drag * .96 + normalizedDrag * .04; this.lift = this.lift * .96 + normalizedLift * .04;
      } else this.recoverField(`step ${this.ticks}: non-finite force`);
      this.ticks++;
    }
    this.updateFields();
  }

  objectSpan() {
    let min = this.height, max = 0;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) if (this.obstacle[x + y * this.width]) { min = Math.min(min, y); max = Math.max(max, y); }
    return max >= min ? max - min + 1 : 1;
  }

  sampleVelocity(x: number, y: number) {
    const ix = Math.max(0, Math.min(this.width - 1, Math.round(x))), iy = Math.max(0, Math.min(this.height - 1, Math.round(y))), i = ix + iy * this.width;
    const vx = Number.isFinite(this.ux[i]) ? this.ux[i] : this.inlet, vy = Number.isFinite(this.uy[i]) ? this.uy[i] : 0;
    return [vx, vy] as const;
  }

  private equilibrium(k: number, rho: number, vx: number, vy: number) {
    const dot = CX[k] * vx + CY[k] * vy;
    return W[k] * rho * (1 + 3 * dot + 4.5 * dot * dot - 1.5 * (vx * vx + vy * vy));
  }

  private initializeField(perturb: boolean) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = x + y * this.width, vy = perturb && x > 4 ? (Math.random() - .5) * .0014 : 0, vx = this.obstacle[i] ? 0 : this.inlet;
        this.ux[i] = vx; this.uy[i] = this.obstacle[i] ? 0 : vy; this.speed[i] = Math.hypot(vx, vy); this.vort[i] = 0;
        for (let k = 0; k < 9; k++) {
          const value = this.obstacle[i] ? 0 : this.equilibrium(k, 1, vx, vy);
          this.f[k * this.size + i] = value; this.next[k * this.size + i] = value;
        }
      }
    }
  }

  private recoverField(reason: string) {
    this.recoveries++; this.lastFault = reason;
    console.warn(`[Slipstream] LBM recovered: ${reason}`);
    this.initializeField(true);
    this.forceX = this.forceY = this.drag = this.lift = 0;
  }

  private applyBoundaries() {
    for (let y = 1; y < this.height - 1; y++) {
      const left = y * this.width, right = this.width - 1 + y * this.width, beforeRight = right - 1;
      const crossFlow = .0035 * Math.sin(this.ticks * .02);
      for (let k = 0; k < 9; k++) {
        this.f[k * this.size + left] = this.equilibrium(k, 1, this.inlet, crossFlow);
        const out = this.f[k * this.size + beforeRight];
        this.f[k * this.size + right] = Number.isFinite(out) ? out : this.equilibrium(k, 1, this.inlet, 0);
      }
    }
  }

  private updateFields() {
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const i = x + y * this.width;
        if (this.obstacle[i]) { this.ux[i] = this.uy[i] = this.speed[i] = this.vort[i] = 0; continue; }
        let rho = 0, momentumX = 0, momentumY = 0;
        for (let k = 0; k < 9; k++) { const value = this.f[k * this.size + i]; rho += value; momentumX += value * CX[k]; momentumY += value * CY[k]; }
        let vx = momentumX / rho, vy = momentumY / rho;
        if (!Number.isFinite(rho) || rho < .1 || rho > 3 || !Number.isFinite(vx) || Math.abs(vx) > .4) vx = this.inlet;
        if (!Number.isFinite(vy) || Math.abs(vy) > .4) vy = 0;
        this.ux[i] = vx; this.uy[i] = vy; this.speed[i] = Math.hypot(vx, vy);
      }
    }
    for (let y = 2; y < this.height - 2; y++) {
      for (let x = 2; x < this.width - 2; x++) {
        const i = x + y * this.width, curl = (this.uy[i + 1] - this.uy[i - 1] - this.ux[i + this.width] + this.ux[i - this.width]) * .5;
        this.vort[i] = Number.isFinite(curl) ? curl : 0;
      }
    }
  }
}
