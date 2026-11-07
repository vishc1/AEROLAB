/**
 * 3D wind tunnel: D3Q19 lattice-Boltzmann solver (BGK, half-way bounce-back)
 * with a dependency-free perspective renderer on a 2D canvas.
 *
 * The obstacle is lifted from the 2D silhouette the user already drew:
 *   wing    – extruded across a partial span (finite wing, tip vortices)
 *   wall    – extruded wall to wall (the 2D case, for comparison)
 *   revolve – spun about the tunnel axis (cylinder -> sphere, car -> bullet)
 */
const NX = 72;
const NY = 36;
const NZ = 36;
const N = NX * NY * NZ;

const C = [
  [0, 0, 0],
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0],
  [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
  [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1],
];
const W = [1 / 3, ...Array(6).fill(1 / 18), ...Array(12).fill(1 / 36)];
const OPP = C.map((_, i) => (i === 0 ? 0 : i % 2 === 1 ? i + 1 : i - 1));
const CX = Int8Array.from(C, (c) => c[0]);
const CY = Int8Array.from(C, (c) => c[1]);
const CZ = Int8Array.from(C, (c) => c[2]);
const OFFSET = Int32Array.from(C, (c) => c[0] + c[1] * NX + c[2] * NX * NY);

const idx = (x, y, z) => x + y * NX + z * NX * NY;

function feq(i, rho, ux, uy, uz) {
  const cu = 3 * (CX[i] * ux + CY[i] * uy + CZ[i] * uz);
  return W[i] * rho * (1 + cu + 0.5 * cu * cu - 1.5 * (ux * ux + uy * uy + uz * uz));
}

const TRAIL = 12;
const PARTICLES = 2600;
const BUCKETS = 7;
const BUCKET_COLORS = [
  '40,90,170', '38,120,200', '36,160,215', '70,200,225', '150,225,225', '225,235,215', '255,244,200',
];

export class Sim3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.f = new Float32Array(19 * N);
    this.g = new Float32Array(19 * N);
    this.solid = new Uint8Array(N);
    this.ux = new Float32Array(N);
    this.uy = new Float32Array(N);
    this.uz = new Float32Array(N);
    this.surface = [];
    this.frontal = 1;
    this.links = 0;
    this.inlet = 0.09;
    this.tau = 0.62;
    this.cd = 0;
    this.cl = 0;
    this.cs = 0;
    this.samples = 0;
    this.history = [];
    this.time = 0;
    this.recoveries = 0;
    this.yaw = -0.62;
    this.pitch = 0.32;
    this.dist = 150;
    this.mode = 'wing';

    this.px = new Float32Array(PARTICLES * TRAIL * 3);
    this.age = new Float32Array(PARTICLES);
    this.seedParticles();
    this.resetFlow();
    this.bindInput();
  }

  // ---- solver -------------------------------------------------------------
  resetFlow() {
    const u = this.inlet;
    for (let i = 0; i < 19; i += 1) {
      const e = feq(i, 1, u, 0, 0);
      this.f.fill(e, i * N, (i + 1) * N);
    }
    this.ux.fill(u);
    this.uy.fill(0);
    this.uz.fill(0);
    this.cd = 0;
    this.cl = 0;
    this.cs = 0;
    this.samples = 0;
    this.history = [];
  }

  /** Lift the 2D mask (bottom-up, w*h) into the voxel grid. */
  setObstacle(mask2d, w, h, mode = this.mode) {
    this.mode = mode;
    const prev = this.solid.slice();
    this.solid.fill(0);

    const sample = (x, y) => {
      // Box-average the 2D mask over the voxel's footprint.
      const x0 = Math.floor((x / NX) * w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) / NX) * w));
      const y0 = Math.floor((y / NY) * h);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) / NY) * h));
      let n = 0;
      let t = 0;
      for (let yy = y0; yy < y1 && yy < h; yy += 1) {
        for (let xx = x0; xx < x1 && xx < w; xx += 1) {
          n += mask2d[yy * w + xx];
          t += 1;
        }
      }
      return t ? n / t : 0;
    };

    const cover = new Float32Array(NX * NY);
    for (let y = 0; y < NY; y += 1) for (let x = 0; x < NX; x += 1) cover[x + y * NX] = sample(x, y);

    const zc = (NZ - 1) / 2;
    const yc = (NY - 1) / 2;
    const halfSpan = this.mode === 'wing' ? NZ * 0.3 : NZ;
    for (let z = 0; z < NZ; z += 1) {
      for (let y = 0; y < NY; y += 1) {
        for (let x = 2; x < NX - 2; x += 1) {
          let on = false;
          if (this.mode === 'revolve') {
            // Profile radius -> use the vertical offset from the body's own centreline.
            const r = Math.hypot(y - yc, z - zc);
            const ry = Math.round(yc + r);
            const ry2 = Math.round(yc - r);
            const c1 = ry >= 0 && ry < NY ? cover[x + ry * NX] : 0;
            const c2 = ry2 >= 0 && ry2 < NY ? cover[x + ry2 * NX] : 0;
            on = Math.max(c1, c2) >= 0.5 && r <= NY / 2 - 1;
          } else {
            on = cover[x + y * NX] >= 0.5 && Math.abs(z - zc) <= halfSpan;
          }
          if (on && y > 0 && y < NY - 1 && z > 0 && z < NZ - 1) this.solid[idx(x, y, z)] = 1;
        }
      }
    }

    // Cells freed by a changed obstacle restart from the free stream.
    for (let i = 0; i < N; i += 1) {
      if (prev[i] && !this.solid[i]) {
        for (let k = 0; k < 19; k += 1) this.f[k * N + i] = feq(k, 1, this.inlet, 0, 0);
      }
    }
    this.analyseGeometry();
    this.cd = 0;
    this.cl = 0;
    this.samples = 0;
    this.history = [];
  }

  analyseGeometry() {
    const col = new Uint8Array(NY * NZ);
    this.surface = [];
    let minX = NX;
    let maxX = 0;
    let minY = NY;
    let maxY = 0;
    for (let z = 0; z < NZ; z += 1) {
      for (let y = 0; y < NY; y += 1) {
        for (let x = 0; x < NX; x += 1) {
          const i = idx(x, y, z);
          if (!this.solid[i]) continue;
          col[y + z * NY] = 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          let nx = 0;
          let ny = 0;
          let nz = 0;
          let open = 0;
          for (let k = 1; k <= 6; k += 1) {
            const xx = x + CX[k];
            const yy = y + CY[k];
            const zz = z + CZ[k];
            const inside = xx >= 0 && xx < NX && yy >= 0 && yy < NY && zz >= 0 && zz < NZ;
            if (!inside || !this.solid[idx(xx, yy, zz)]) {
              nx += CX[k];
              ny += CY[k];
              nz += CZ[k];
              open += 1;
            }
          }
          if (open) {
            const len = Math.hypot(nx, ny, nz) || 1;
            this.surface.push([x, y, z, nx / len, ny / len, nz / len]);
          }
        }
      }
    }
    this.frontal = Math.max(1, col.reduce((a, b) => a + b, 0));
    this.refLength = this.surface.length ? Math.max(maxX - minX + 1, maxY - minY + 1) / NY : 0.6;
  }

  tauFor(viscosity) {
    return 0.56 + ((viscosity - 0.004) / 0.196) * 0.36;
  }

  step(wind, viscosity) {
    const inlet = 0.06 + ((wind - 2) / 28) * 0.05;
    if (Math.abs(inlet - this.inlet) > 1e-5) this.inlet = inlet;
    this.tau = this.tauFor(viscosity);
    const omega = 1 / this.tau;
    const f = this.f;
    const g = this.g;
    const solid = this.solid;
    const { ux, uy, uz } = this;
    const U = this.inlet;

    // Collide.
    for (let i = 0; i < N; i += 1) {
      if (solid[i]) continue;
      let rho = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let k = 0; k < 19; k += 1) {
        const v = f[k * N + i];
        rho += v;
        mx += v * CX[k];
        my += v * CY[k];
        mz += v * CZ[k];
      }
      let vx = mx / rho;
      let vy = my / rho;
      let vz = mz / rho;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > 0.35) {
        const s = 0.35 / sp;
        vx *= s;
        vy *= s;
        vz *= s;
      }
      ux[i] = vx;
      uy[i] = vy;
      uz[i] = vz;
      const usq = 1.5 * (vx * vx + vy * vy + vz * vz);
      for (let k = 0; k < 19; k += 1) {
        const cu = 3 * (CX[k] * vx + CY[k] * vy + CZ[k] * vz);
        const eq = W[k] * rho * (1 + cu + 0.5 * cu * cu - usq);
        f[k * N + i] += omega * (eq - f[k * N + i]);
      }
    }

    // Stream (pull) with half-way bounce-back and momentum exchange.
    let fx = 0;
    let fy = 0;
    let links = 0;
    const far = new Float32Array(19);
    for (let k = 0; k < 19; k += 1) far[k] = feq(k, 1, U, 0, 0);

    for (let z = 0; z < NZ; z += 1) {
      for (let y = 0; y < NY; y += 1) {
        for (let x = 0; x < NX; x += 1) {
          const i = x + y * NX + z * NX * NY;
          if (solid[i]) continue;
          for (let k = 0; k < 19; k += 1) {
            const sx = x - CX[k];
            const sy = y - CY[k];
            const sz = z - CZ[k];
            let value;
            if (sx < 0 || sy < 0 || sz < 0 || sy >= NY || sz >= NZ || sx >= NX) {
              value = far[k];
            } else {
              const s = i - OFFSET[k];
              if (solid[s]) {
                const o = OPP[k];
                value = f[o * N + i];
                const q = 2 * value;
                fx += q * CX[o];
                fy += q * CY[o];
                links += 1;
              } else {
                value = f[k * N + s];
              }
            }
            g[k * N + i] = value;
          }
        }
      }
    }

    // Inlet: fixed free stream. Outlet: zero-gradient.
    for (let z = 0; z < NZ; z += 1) {
      for (let y = 0; y < NY; y += 1) {
        const a = idx(0, y, z);
        const b = idx(NX - 1, y, z);
        const c = idx(NX - 2, y, z);
        for (let k = 0; k < 19; k += 1) {
          g[k * N + a] = far[k];
          g[k * N + b] = g[k * N + c];
        }
      }
    }

    this.f = g;
    this.g = f;
    this.links = links;
    this.time += 1;

    const q = 0.5 * U * U * this.frontal;
    const rawCd = fx / q;
    const rawCl = fy / q;
    if (!Number.isFinite(rawCd) || !Number.isFinite(f[N >> 1]) || !Number.isFinite(this.f[N >> 1])) {
      this.recoveries += 1;
      this.resetFlow();
      return;
    }
    const a = this.samples < 3 ? 0.7 : 0.05;
    this.cd += (rawCd - this.cd) * a;
    this.cl += (rawCl - this.cl) * a;
    this.samples += 1;
    if (this.samples % 6 === 0) {
      this.history.push(this.cd);
      if (this.history.length > 140) this.history.shift();
    }
  }

  // ---- tracers ------------------------------------------------------------
  spawn(p, anywhere) {
    const x = anywhere ? Math.random() * (NX - 4) + 1 : 1 + Math.random() * 1.5;
    const y = 1.5 + Math.random() * (NY - 3);
    const z = 1.5 + Math.random() * (NZ - 3);
    for (let t = 0; t < TRAIL; t += 1) {
      const o = (p * TRAIL + t) * 3;
      this.px[o] = x;
      this.px[o + 1] = y;
      this.px[o + 2] = z;
    }
    this.age[p] = Math.random() * 200;
  }

  seedParticles() {
    for (let p = 0; p < PARTICLES; p += 1) this.spawn(p, true);
  }

  advect(k = 3.2) {
    for (let p = 0; p < PARTICLES; p += 1) {
      const base = p * TRAIL * 3;
      // shift trail
      this.px.copyWithin(base + 3, base, base + (TRAIL - 1) * 3);
      let x = this.px[base + 3];
      let y = this.px[base + 4];
      let z = this.px[base + 5];
      const ix = Math.max(0, Math.min(NX - 1, Math.round(x)));
      const iy = Math.max(0, Math.min(NY - 1, Math.round(y)));
      const iz = Math.max(0, Math.min(NZ - 1, Math.round(z)));
      const i = idx(ix, iy, iz);
      x += this.ux[i] * k;
      y += this.uy[i] * k;
      z += this.uz[i] * k;
      this.age[p] += 1;
      if (x > NX - 2 || x < 0 || y < 0.5 || y > NY - 1.5 || z < 0.5 || z > NZ - 1.5 || this.age[p] > 420 || this.solid[idx(Math.round(x), Math.round(y), Math.round(z))]) {
        this.spawn(p, false);
      } else {
        this.px[base] = x;
        this.px[base + 1] = y;
        this.px[base + 2] = z;
      }
    }
  }

  // ---- rendering ----------------------------------------------------------
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  project(x, y, z) {
    // centre, rotate, perspective
    const cx = x - NX / 2;
    const cy = y - NY / 2;
    const cz = z - NZ / 2;
    const cyaw = Math.cos(this.yaw);
    const syaw = Math.sin(this.yaw);
    const x1 = cx * cyaw + cz * syaw;
    const z1 = -cx * syaw + cz * cyaw;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const y2 = cy * cp - z1 * sp;
    const z2 = cy * sp + z1 * cp;
    const depth = this.dist + z2;
    const s = (this.scale * this.dist) / Math.max(depth, 10);
    return [this.canvas.width / 2 + x1 * s, this.canvas.height / 2 - y2 * s, depth, s];
  }

  rotateNormal(nx, ny, nz) {
    const cyaw = Math.cos(this.yaw);
    const syaw = Math.sin(this.yaw);
    const x1 = nx * cyaw + nz * syaw;
    const z1 = -nx * syaw + nz * cyaw;
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return [x1, ny * cp - z1 * sp, ny * sp + z1 * cp];
  }

  render(profile) {
    const { ctx, canvas } = this;
    const W2 = canvas.width;
    const H2 = canvas.height;
    this.scale = (W2 / NX) * 0.82;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const bg = ctx.createLinearGradient(0, 0, 0, H2);
    bg.addColorStop(0, '#07151d');
    bg.addColorStop(1, '#030b11');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W2, H2);

    // Tunnel wireframe + floor grid.
    ctx.lineWidth = dpr;
    const corners = [];
    for (const x of [0, NX - 1]) for (const y of [0, NY - 1]) for (const z of [0, NZ - 1]) corners.push([x, y, z]);
    const pc = corners.map((c) => this.project(...c));
    ctx.strokeStyle = 'rgba(120,190,205,0.22)';
    ctx.beginPath();
    for (let a = 0; a < 8; a += 1) {
      for (let b = a + 1; b < 8; b += 1) {
        const diff = (corners[a][0] !== corners[b][0]) + (corners[a][1] !== corners[b][1]) + (corners[a][2] !== corners[b][2]);
        if (diff === 1) {
          ctx.moveTo(pc[a][0], pc[a][1]);
          ctx.lineTo(pc[b][0], pc[b][1]);
        }
      }
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,190,205,0.08)';
    ctx.beginPath();
    for (let x = 0; x <= NX - 1; x += 9) {
      const a = this.project(x, 0, 0);
      const b = this.project(x, 0, NZ - 1);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    for (let z = 0; z <= NZ - 1; z += 9) {
      const a = this.project(0, 0, z);
      const b = this.project(NX - 1, 0, z);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();

    // Split draw order: tracers behind the body first, then the body, then the rest.
    const bodyDepth = this.bodyDepth();
    const buckets = Array.from({ length: BUCKETS }, () => []);
    const U = this.inlet;
    for (let p = 0; p < PARTICLES; p += 1) {
      const base = p * TRAIL * 3;
      const ix = Math.max(0, Math.min(NX - 1, Math.round(this.px[base])));
      const iy = Math.max(0, Math.min(NY - 1, Math.round(this.px[base + 1])));
      const iz = Math.max(0, Math.min(NZ - 1, Math.round(this.px[base + 2])));
      const i = idx(ix, iy, iz);
      const sp = Math.hypot(this.ux[i], this.uy[i], this.uz[i]) / U;
      const b = Math.max(0, Math.min(BUCKETS - 1, Math.floor((sp - 0.15) * 4.2)));
      buckets[b].push(p);
    }
    const drawTrails = (behind) => {
      ctx.lineCap = 'round';
      for (let b = 0; b < BUCKETS; b += 1) {
        ctx.strokeStyle = `rgba(${BUCKET_COLORS[b]},${behind ? 0.35 : 0.75})`;
        ctx.lineWidth = (0.7 + b * 0.12) * dpr;
        ctx.beginPath();
        let any = false;
        for (const p of buckets[b]) {
          const base = p * TRAIL * 3;
          const head = this.project(this.px[base], this.px[base + 1], this.px[base + 2]);
          const isBehind = head[2] > bodyDepth;
          if (isBehind !== behind) continue;
          ctx.moveTo(head[0], head[1]);
          for (let t = 1; t < TRAIL; t += 1) {
            const o = base + t * 3;
            const q = this.project(this.px[o], this.px[o + 1], this.px[o + 2]);
            ctx.lineTo(q[0], q[1]);
          }
          any = true;
        }
        if (any) ctx.stroke();
      }
    };
    drawTrails(true);

    // Body: painter's-sorted voxel faces.
    if (this.surface.length) {
      const items = this.surface.map((v) => {
        const pr = this.project(v[0], v[1], v[2]);
        return [pr, v];
      });
      items.sort((a, b) => b[0][2] - a[0][2]);
      for (const [pr, v] of items) {
        const n = this.rotateNormal(v[3], v[4], v[5]);
        const lit = Math.max(0, n[0] * -0.35 + n[1] * 0.75 + n[2] * -0.55);
        const shade = 0.28 + 0.72 * Math.min(1, lit);
        const size = pr[3] * 1.18;
        ctx.fillStyle = `rgb(${Math.round(212 * shade)},${Math.round(196 * shade)},${Math.round(158 * shade)})`;
        ctx.fillRect(pr[0] - size / 2, pr[1] - size / 2, size, size);
      }
    }
    drawTrails(false);

    // Inset: the 2D profile the body was lifted from.
    if (profile) {
      const iw = Math.round(118 * dpr);
      const ih = Math.round(59 * dpr);
      const ix = Math.round(14 * dpr);
      const iy = H2 - ih - Math.round(14 * dpr);
      ctx.fillStyle = 'rgba(4,14,20,0.8)';
      ctx.fillRect(ix - 4 * dpr, iy - 16 * dpr, iw + 8 * dpr, ih + 20 * dpr);
      ctx.drawImage(profile, ix, iy, iw, ih);
      ctx.strokeStyle = 'rgba(120,190,205,0.4)';
      ctx.strokeRect(ix, iy, iw, ih);
      ctx.fillStyle = 'rgba(160,210,220,0.8)';
      ctx.font = `${9 * dpr}px ui-monospace, monospace`;
      ctx.fillText(`PROFILE · ${this.mode.toUpperCase()}`, ix, iy - 5 * dpr);
    }
  }

  bodyDepth() {
    if (!this.surface.length) return Infinity;
    const v = this.surface[this.surface.length >> 1];
    return this.project(v[0], v[1], v[2])[2];
  }

  bindInput() {
    let drag = null;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - drag.x) * 0.008;
      this.pitch = Math.max(-1.2, Math.min(1.3, this.pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(70, Math.min(300, this.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    c.addEventListener('dblclick', () => {
      this.yaw = -0.62;
      this.pitch = 0.32;
      this.dist = 150;
    });
  }

  get grid() {
    return `${NX} × ${NY} × ${NZ}`;
  }
}
