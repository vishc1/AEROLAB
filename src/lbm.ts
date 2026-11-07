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
  private f: Float32Array;
  private next: Float32Array;
  private readonly inlet = 0.075;
  private readonly omega = 1 / 0.58;
  forceX = 0;
  forceY = 0;
  drag = 0;
  lift = 0;
  ticks = 0;

  constructor(width = 240, height = 96) {
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
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = x + y * this.width;
        this.ux[i] = this.inlet;
        this.uy[i] = 0;
        for (let k = 0; k < 9; k++) this.f[k * this.size + i] = this.equilibrium(k, 1, this.inlet, 0);
      }
    }
    this.next.set(this.f);
    this.forceX = this.forceY = this.drag = this.lift = 0;
    this.ticks = 0;
  }

  setPreset(preset: Preset) {
    this.obstacle.fill(0);
    if (preset === 'clear') return;
    const cx = Math.floor(this.width * 0.38);
    const cy = Math.floor(this.height * 0.5);
    for (let y = 2; y < this.height - 2; y++) {
      for (let x = 8; x < this.width - 8; x++) {
        let solid = false;
        if (preset === 'circle') {
          const r = this.height * 0.14;
          solid = (x - cx) ** 2 + (y - cy) ** 2 < r * r;
        } else if (preset === 'card') {
          solid = Math.abs(x - cx) < 3 && Math.abs(y - cy) < this.height * 0.25;
        } else if (preset === 'airfoil') {
          const dx = (x - (cx - 13)) / 33;
          if (dx >= 0 && dx <= 1) {
            const thickness = 0.12 * 33 * (0.2969 * Math.sqrt(dx) - 0.126 * dx - 0.3516 * dx ** 2 + 0.2843 * dx ** 3 - 0.1015 * dx ** 4) / 0.1;
            const camber = -3.5 * (dx - 0.35);
            solid = Math.abs(y - cy - camber) < Math.max(1.2, thickness);
          }
        } else if (preset === 'car') {
          const nx = (x - cx) / 34;
          const ny = (y - cy) / 16;
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
    for (let y = Math.max(2, gridY - radius); y <= Math.min(this.height - 3, gridY + radius); y++) {
      for (let x = Math.max(7, gridX - radius); x <= Math.min(this.width - 12, gridX + radius); x++) {
        if ((x - gridX) ** 2 + (y - gridY) ** 2 <= r2) this.obstacle[x + y * this.width] = erase ? 0 : 1;
      }
    }
  }

  setMask(mask: Uint8Array) {
    if (mask.length === this.obstacle.length) this.obstacle.set(mask);
  }

  step(iterations = 1) {
    for (let iteration = 0; iteration < iterations; iteration++) {
      this.next.fill(0);
      let fx = 0;
      let fy = 0;
      for (let y = 1; y < this.height - 1; y++) {
        for (let x = 1; x < this.width - 1; x++) {
          const i = x + y * this.width;
          if (this.obstacle[i]) continue;
          let rho = 0;
          let vx = 0;
          let vy = 0;
          for (let k = 0; k < 9; k++) {
            const value = this.f[k * this.size + i];
            rho += value;
            vx += value * CX[k];
            vy += value * CY[k];
          }
          if (!Number.isFinite(rho) || rho < 0.1 || rho > 3) rho = 1;
          vx /= rho;
          vy /= rho;
          const velocity2 = vx * vx + vy * vy;
          for (let k = 0; k < 9; k++) {
            const current = this.f[k * this.size + i];
            const dot = CX[k] * vx + CY[k] * vy;
            const eq = W[k] * rho * (1 + 3 * dot + 4.5 * dot * dot - 1.5 * velocity2);
            const post = current - this.omega * (current - eq);
            const tx = x + CX[k];
            const ty = y + CY[k];
            const target = tx + ty * this.width;
            if (ty <= 0 || ty >= this.height - 1 || this.obstacle[target]) {
              this.next[OPP[k] * this.size + i] += post;
              if (this.obstacle[target]) {
                fx += 2 * post * CX[k];
                fy += 2 * post * CY[k];
              }
            } else if (tx > 0 && tx < this.width) {
              this.next[k * this.size + target] += post;
            }
          }
        }
      }
      const swap = this.f;
      this.f = this.next;
      this.next = swap;
      this.applyBoundaries();
      this.forceX = fx;
      this.forceY = fy;
      const span = Math.max(1, this.objectSpan());
      const normalizedDrag = Math.abs(fx) / span * 18;
      const normalizedLift = -fy / span * 18;
      this.drag = this.drag * 0.94 + normalizedDrag * 0.06;
      this.lift = this.lift * 0.94 + normalizedLift * 0.06;
      this.ticks++;
    }
    this.updateFields();
  }

  objectSpan() {
    let min = this.height;
    let max = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) if (this.obstacle[x + y * this.width]) { min = Math.min(min, y); max = Math.max(max, y); }
    }
    return max >= min ? max - min + 1 : 1;
  }

  sampleVelocity(x: number, y: number) {
    const ix = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    const i = ix + iy * this.width;
    return [this.ux[i], this.uy[i]] as const;
  }

  private equilibrium(k: number, rho: number, vx: number, vy: number) {
    const dot = CX[k] * vx + CY[k] * vy;
    return W[k] * rho * (1 + 3 * dot + 4.5 * dot * dot - 1.5 * (vx * vx + vy * vy));
  }

  private applyBoundaries() {
    for (let y = 1; y < this.height - 1; y++) {
      const left = y * this.width;
      const right = this.width - 1 + y * this.width;
      const beforeRight = right - 1;
      for (let k = 0; k < 9; k++) {
        this.f[k * this.size + left] = this.equilibrium(k, 1, this.inlet, 0);
        this.f[k * this.size + right] = this.f[k * this.size + beforeRight];
      }
    }
  }

  private updateFields() {
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const i = x + y * this.width;
        if (this.obstacle[i]) { this.ux[i] = this.uy[i] = this.speed[i] = 0; continue; }
        let rho = 0, vx = 0, vy = 0;
        for (let k = 0; k < 9; k++) {
          const value = this.f[k * this.size + i];
          rho += value;
          vx += value * CX[k];
          vy += value * CY[k];
        }
        if (rho > 0.001) { vx /= rho; vy /= rho; }
        if (!Number.isFinite(vx) || Math.abs(vx) > 0.5) vx = this.inlet;
        if (!Number.isFinite(vy) || Math.abs(vy) > 0.5) vy = 0;
        this.ux[i] = vx;
        this.uy[i] = vy;
        this.speed[i] = Math.sqrt(vx * vx + vy * vy);
      }
    }
    for (let y = 2; y < this.height - 2; y++) {
      for (let x = 2; x < this.width - 2; x++) {
        const i = x + y * this.width;
        this.vort[i] = (this.uy[i + 1] - this.uy[i - 1] - this.ux[i + this.width] + this.ux[i - this.width]) * 0.5;
      }
    }
  }
}
