/**
 * 3D sketch dock: draw the SIDE profile and the TOP planform right next to the
 * 3D view. The solid is the intersection of the two silhouettes (a visual hull),
 * so a swept or tapered wing is just two quick sketches.
 */
import { GRID } from './sim3d.js';

const { NX, NZ } = GRID;

const PRESETS = {
  // span (fraction of half-width), lead/trail = how fast the chord window closes toward the tip
  straight: { span: 0.6, lead: 0, trail: 0 },
  tapered: { span: 0.72, lead: 0.28, trail: 0.5 },
  swept: { span: 0.72, lead: 0.62, trail: 0.62 },
  delta: { span: 0.8, lead: 0.92, trail: 0 },
  ellipse: { span: 0.62, ellipse: true },
};

export class SketchDock {
  constructor({ mask, store, sideCanvas, planCanvas, onChange }) {
    this.mask = mask;
    this.store = store;
    this.side = sideCanvas;
    this.planView = planCanvas;
    this.onChange = onChange;
    this.symmetry = true;
    this.preset = 'straight';

    this.planView.width = NX * 3;
    this.planView.height = NZ * 3;
    this.buf = document.createElement('canvas');
    this.buf.width = NX;
    this.buf.height = NZ;
    this.bufCtx = this.buf.getContext('2d', { willReadFrequently: true });
    this.plan = new Uint8Array(NX * NZ);
    this.applyPreset('straight', false);

    this.bindSide();
    this.bindPlan();
  }

  // ---- planform -----------------------------------------------------------
  applyPreset(name, notify = true) {
    const p = PRESETS[name];
    if (!p) return;
    this.preset = name;
    const ctx = this.bufCtx;
    const img = ctx.createImageData(NX, NZ);
    for (let z = 0; z < NZ; z += 1) {
      for (let x = 0; x < NX; x += 1) {
        const u = x / (NX - 1);
        const v = Math.abs((z - (NZ - 1) / 2) / ((NZ - 1) / 2));
        let on;
        if (p.ellipse) on = v <= p.span * Math.sqrt(Math.max(0, 1 - ((u - 0.5) / 0.5) ** 2));
        else on = v <= p.span && u >= p.lead * v && u <= 1 - p.trail * v * 0.5;
        const o = (x + z * NX) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = on ? 255 : 0;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.commitPlan(notify);
  }

  clearPlan() {
    this.bufCtx.fillStyle = '#000';
    this.bufCtx.fillRect(0, 0, NX, NZ);
    this.preset = 'custom';
    this.commitPlan(true);
  }

  commitPlan(notify = true) {
    const data = this.bufCtx.getImageData(0, 0, NX, NZ).data;
    for (let i = 0; i < NX * NZ; i += 1) this.plan[i] = data[i * 4] > 127 ? 1 : 0;
    this.drawPlan();
    if (notify) this.onChange?.('plan');
  }

  drawPlan() {
    const c = this.planView.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#071820';
    c.fillRect(0, 0, this.planView.width, this.planView.height);
    c.drawImage(this.buf, 0, 0, this.planView.width, this.planView.height);
    // centreline + flow arrow
    c.strokeStyle = 'rgba(120,190,205,0.35)';
    c.setLineDash([4, 4]);
    c.beginPath();
    c.moveTo(0, this.planView.height / 2);
    c.lineTo(this.planView.width, this.planView.height / 2);
    c.stroke();
    c.setLineDash([]);
  }

  bindPlan() {
    const view = this.planView;
    let last = null;
    let erase = false;
    let timer = 0;
    const pos = (e) => {
      const r = view.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * NX, z: ((e.clientY - r.top) / r.height) * NZ };
    };
    const line = (a, b) => {
      const ctx = this.bufCtx;
      ctx.strokeStyle = erase ? '#000' : '#fff';
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = Math.max(2, this.store.state.brush * 0.28) * 2;
      ctx.lineCap = 'round';
      const mirror = (zv) => NZ - 1 - zv;
      const draw = (x0, z0, x1, z1) => {
        ctx.beginPath();
        ctx.moveTo(x0, z0);
        ctx.lineTo(x1, z1);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x1, z1, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      };
      draw(a.x, a.z, b.x, b.z);
      if (this.symmetry) draw(a.x, mirror(a.z), b.x, mirror(b.z));
    };
    view.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      erase = this.store.state.tool === 'erase' || e.button === 2 || e.shiftKey;
      last = pos(e);
      view.setPointerCapture(e.pointerId);
      line(last, last);
      this.preset = 'custom';
      this.commitPlan(false);
    });
    view.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pos(e);
      line(last, p);
      last = p;
      this.commitPlan(false);
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          this.onChange?.('plan');
        }, 160);
      }
    });
    const end = () => {
      if (!last) return;
      last = null;
      this.commitPlan(true);
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- side profile (writes into the shared 2D mask) ----------------------
  /** Mirror the live mask into the dock. Cheap; called when the dock is visible. */
  drawSide() {
    const m = this.mask;
    if (this.side.width !== m.width) this.side.width = m.width;
    if (this.side.height !== m.height) this.side.height = m.height;
    const c = this.side.getContext('2d');
    c.fillStyle = '#071820';
    c.fillRect(0, 0, this.side.width, this.side.height);
    c.drawImage(m.canvas, 0, 0);
  }

  bindSide() {
    const view = this.side;
    let last = null;
    let erase = false;
    let timer = 0;
    const pos = (e) => {
      const r = view.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };
    const stroke = (a, b) => {
      const radius = Math.max(1.5, (this.store.state.brush / 520) * this.mask.width);
      this.mask.stroke(a.x, a.y, b.x, b.y, radius, erase);
    };
    view.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      erase = this.store.state.tool === 'erase' || e.button === 2 || e.shiftKey;
      last = pos(e);
      view.setPointerCapture(e.pointerId);
      stroke(last, last);
      this.drawSide();
    });
    view.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pos(e);
      stroke(last, p);
      last = p;
      this.drawSide();
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          this.onChange?.('side');
        }, 160);
      }
    });
    const end = () => {
      if (!last) return;
      last = null;
      this.onChange?.('side');
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    view.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
